import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  VISITOR_SOURCE, VISITOR_METHOD, visitorResponse, visitorHash, visitorResponseHash,
  visitorSnapshotPath, verifyVisitorLatest,
} from './visitor-data.mjs';
import {
  VISITOR_TIMEOUT_MS, VISITOR_LATEST, fetchVisitorObservation, recordVisitorObservation,
  readVisitorLatest, runVisitorSnapshot,
} from './visitor-snapshot.mjs';

const FIRST = '2026-04-01T10:00:00.000Z';
const LATER = '2026-04-01T11:00:00.000Z';
const NEXT_DAY = '2026-04-02T01:00:00.000Z';
const response = (value, extra = {}, headers = {}) => new Response(JSON.stringify({ value, ...extra }), {
  headers: { 'content-type': 'application/json', ...headers },
});
const observation = (value, asOf = FIRST) => ({
  sourceResponse: { value }, sourceHeaders: {}, collectionStartedAt: asOf, asOf,
});

async function directory(t) {
  const rootDir = await fs.mkdtemp(join(tmpdir(), 'vibisual-visitor-test-'));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  return rootDir;
}

async function recorded(t, value = 9) {
  const rootDir = await directory(t);
  const result = await recordVisitorObservation(observation(value), { rootDir });
  return { rootDir, latest: result.latest };
}

test('aggregate capture uses only the fixed read-only endpoint and excludes unexpected response data', async () => {
  const calls = [];
  const times = [new Date(FIRST), new Date(LATER)];
  const value = await fetchVisitorObservation({
    now: () => times.shift(),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(9, { requestIp: 'not-retained', person: { name: 'not-retained' } }, {
        date: 'Wed, 01 Apr 2026 10:00:00 GMT', etag: 'W/"d-AbC123"',
        'set-cookie': 'never-retained', 'x-request-id': 'never-retained',
      });
    },
  });
  assert.equal(VISITOR_TIMEOUT_MS, 8000);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, VISITOR_SOURCE);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.credentials, 'omit');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.deepEqual(calls[0].options.headers, { Accept: 'application/json' });
  assert.deepEqual(value, {
    sourceResponse: { value: 9 }, sourceHeaders: { httpDate: FIRST, etag: 'W/"d-AbC123"' },
    collectionStartedAt: FIRST, asOf: LATER,
  });
});

test('counts require nonnegative safe integers, including a valid zero', () => {
  for (const value of [undefined, null, '9', -1, NaN, 1.5, Infinity, true, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => visitorResponse({ value }), /invalid-response/);
  }
  for (const value of [null, [], 9, '9']) assert.throws(() => visitorResponse(value), /invalid-response/);
  assert.deepEqual(visitorResponse({ value: 0 }), { value: 0 });
});

test('first observation preserves only an aggregate snapshot and an independently verifiable pointer', async (t) => {
  const rootDir = await directory(t);
  const result = await runVisitorSnapshot({ rootDir, now: () => FIRST, log: () => {},
    fetchImpl: async () => response(9, { identifier: 'not-retained' }, {
      'x-forwarded-for': 'not-retained', 'set-cookie': 'not-retained',
    }),
  });
  assert.equal(result.status, 'written');
  const pointer = JSON.parse(await fs.readFile(join(rootDir, VISITOR_LATEST), 'utf8'));
  const bytes = await fs.readFile(join(rootDir, pointer.snapshot.slice(1)));
  const snapshot = JSON.parse(bytes);
  assert.equal(pointer.counterValue, 9);
  assert.equal(pointer.methodology, VISITOR_METHOD);
  assert.equal(pointer.previous, null);
  assert.equal(pointer.changeFromPrevious, null);
  assert.equal(pointer.caveats.publicWritableCounter, true);
  assert.equal(pointer.caveats.verifiedPeople, null);
  assert.equal(pointer.caveats.automatedRequests, null);
  assert.deepEqual(snapshot.sourceResponse, { value: 9 });
  assert.deepEqual(snapshot.sourceHeaders, {});
  assert.equal(snapshot.sourceResponseSha256, visitorHash('{"value":9}'));
  assert.equal(pointer.evidenceSha256, visitorHash(bytes));
  assert.doesNotMatch(bytes.toString('utf8'), /not-retained|identifier|set-cookie/);
  assert.deepEqual(verifyVisitorLatest(pointer, bytes), pointer);
});

test('unchanged values within one UTC day preserve exact pointer bytes and asOf without writes', async (t) => {
  const { rootDir, latest } = await recorded(t);
  const before = await fs.readFile(join(rootDir, VISITOR_LATEST));
  let writes = 0;
  const injected = { ...fs, open: async () => { writes += 1; throw new Error('unexpected write'); } };
  for (const asOf of [FIRST, LATER]) {
    const result = await recordVisitorObservation(observation(9, asOf), { rootDir, fs: injected });
    assert.equal(result.status, 'unchanged');
    assert.deepEqual(result.latest, latest);
  }
  assert.equal(writes, 0);
  assert.deepEqual(await fs.readFile(join(rootDir, VISITOR_LATEST)), before);
});

test('the next UTC day records the same value with the previous snapshot hash and zero delta', async (t) => {
  const { rootDir, latest } = await recorded(t);
  const result = await recordVisitorObservation(observation(9, NEXT_DAY), { rootDir });
  assert.equal(result.status, 'written');
  assert.equal(result.latest.asOf, NEXT_DAY);
  assert.equal(result.latest.changeFromPrevious, 0);
  assert.deepEqual(result.latest.previous, {
    snapshot: latest.snapshot, evidenceSha256: latest.evidenceSha256,
    asOf: FIRST, counterValue: 9,
  });
  assert.equal((await fs.readdir(join(rootDir, 'metrics/visitors/snapshots'))).length, 2);
  assert.deepEqual(await readVisitorLatest({ rootDir }), result.latest);
});

test('a valid decrease to zero is recorded without a floor or invented visitor growth', async (t) => {
  const { rootDir } = await recorded(t, 9);
  const result = await recordVisitorObservation(observation(0, LATER), { rootDir });
  assert.equal(result.latest.counterValue, 0);
  assert.equal(result.latest.changeFromPrevious, -9);
  assert.equal(result.latest.previous.counterValue, 9);
  assert.deepEqual(await readVisitorLatest({ rootDir }), result.latest);
});

test('network, HTTP, malformed and invalid aggregate failures retain prior bytes and timestamp', async (t) => {
  const { rootDir, latest } = await recorded(t);
  const before = await fs.readFile(join(rootDir, VISITOR_LATEST));
  const failures = [
    async () => { throw new Error('not-retained-private-error'); },
    async () => new Response('not-retained-private-error', { status: 503 }),
    async () => new Response('{not-retained-private-error'),
    async () => response('9'),
    async () => response(-1),
    async () => new Response(' '.repeat(1025)),
  ];
  for (const fetchImpl of failures) {
    const logs = [];
    const result = await runVisitorSnapshot({ rootDir, fetchImpl, now: () => LATER, log: line => logs.push(line) });
    assert.equal(result.status, 'failed');
    assert.doesNotMatch(logs.join('\n'), /private-error/);
    assert.deepEqual(await fs.readFile(join(rootDir, VISITOR_LATEST)), before);
    assert.equal((await readVisitorLatest({ rootDir })).asOf, latest.asOf);
  }
});

test('first-capture failure creates no zero placeholder or snapshot directory', async (t) => {
  const rootDir = await directory(t);
  const result = await runVisitorSnapshot({ rootDir, log: () => {},
    fetchImpl: async () => response(null), now: () => FIRST,
  });
  assert.equal(result.status, 'failed');
  assert.deepEqual(await fs.readdir(rootDir), []);
});

test('request deadline aborts even a stalled injected fetch and preserves existing evidence', async (t) => {
  const { rootDir } = await recorded(t);
  const before = await fs.readFile(join(rootDir, VISITOR_LATEST));
  let signal;
  const result = await runVisitorSnapshot({ rootDir, now: () => LATER, log: () => {}, timeoutMs: 5,
    fetchImpl: async (_url, options) => {
      signal = options.signal;
      return new Promise(() => {});
    },
  });
  assert.equal(result.error, 'request-timeout');
  assert.equal(signal.aborted, true);
  assert.deepEqual(await fs.readFile(join(rootDir, VISITOR_LATEST)), before);
});

test('inconsistent archived source values and hashes cannot be used as a previous observation', async (t) => {
  const { rootDir, latest } = await recorded(t);
  const archive = join(rootDir, latest.snapshot.slice(1));
  const content = JSON.parse(await fs.readFile(archive, 'utf8'));
  content.sourceResponse.value = 10;
  content.sourceResponseSha256 = visitorResponseHash(content.sourceResponse);
  const bytes = JSON.stringify(content, null, 2) + '\n';
  await fs.writeFile(archive, bytes);
  const altered = { ...latest, evidenceSha256: visitorHash(bytes), sourceResponseSha256: content.sourceResponseSha256 };
  await fs.writeFile(join(rootDir, VISITOR_LATEST), JSON.stringify(altered));
  const before = await fs.readFile(join(rootDir, VISITOR_LATEST));
  const result = await runVisitorSnapshot({ rootDir, log: () => {},
    fetchImpl: async () => response(11), now: () => LATER,
  });
  assert.equal(result.error, 'previous-evidence-invalid');
  assert.deepEqual(await fs.readFile(join(rootDir, VISITOR_LATEST)), before);
});

test('a pointer rename failure retains the old pointer and writes immutable evidence using wx', async (t) => {
  const { rootDir } = await recorded(t);
  const before = await fs.readFile(join(rootDir, VISITOR_LATEST));
  const writes = [];
  const injected = { ...fs,
    open: async (path, flags) => { writes.push({ path, flags }); return fs.open(path, flags); },
    rename: async () => { throw new Error('disk failure'); },
  };
  const result = await runVisitorSnapshot({ rootDir, fs: injected, log: () => {},
    fetchImpl: async () => response(10), now: () => LATER,
  });
  assert.equal(result.error, 'write-failed');
  assert.equal(writes.length, 2);
  assert.ok(writes.every(call => call.flags === 'wx'));
  assert.deepEqual(await fs.readFile(join(rootDir, VISITOR_LATEST)), before);
  assert.deepEqual((await fs.readdir(join(rootDir, 'metrics/visitors'))).sort(), ['latest.json', 'snapshots']);
});

test('archive name collisions never overwrite existing bytes or publish a different pointer', async (t) => {
  const { rootDir } = await recorded(t);
  const before = await fs.readFile(join(rootDir, VISITOR_LATEST));
  const archive = join(rootDir, visitorSnapshotPath(LATER).slice(1));
  await fs.writeFile(archive, 'existing-evidence');
  const result = await runVisitorSnapshot({ rootDir, now: () => LATER, log: () => {},
    fetchImpl: async () => response(10),
  });
  assert.equal(result.status, 'failed');
  assert.equal(await fs.readFile(archive, 'utf8'), 'existing-evidence');
  assert.deepEqual(await fs.readFile(join(rootDir, VISITOR_LATEST)), before);
});

test('temporary-name collisions preserve another write and existing pointer', async (t) => {
  const { rootDir } = await recorded(t);
  const before = await fs.readFile(join(rootDir, VISITOR_LATEST));
  const tempPath = join(rootDir, dirname(VISITOR_LATEST), '.latest-existing.tmp');
  await fs.writeFile(tempPath, 'other-write');
  await assert.rejects(recordVisitorObservation(observation(10, LATER), { rootDir, temporaryId: () => 'existing' }));
  assert.equal(await fs.readFile(tempPath, 'utf8'), 'other-write');
  assert.deepEqual(await fs.readFile(join(rootDir, VISITOR_LATEST)), before);
});

test('a partial temporary-file write is cleaned without changing the published pointer', async (t) => {
  const { rootDir } = await recorded(t);
  const before = await fs.readFile(join(rootDir, VISITOR_LATEST));
  const injected = { ...fs,
    open: async (path, flags) => {
      const handle = await fs.open(path, flags);
      if (!path.endsWith('.tmp')) return handle;
      return {
        writeFile: async () => { await handle.writeFile('partial'); throw new Error('disk full'); },
        sync: () => handle.sync(), close: () => handle.close(),
      };
    },
  };
  const result = await runVisitorSnapshot({ rootDir, fs: injected, log: () => {},
    now: () => LATER, fetchImpl: async () => response(10),
  });
  assert.equal(result.error, 'write-failed');
  assert.deepEqual(await fs.readFile(join(rootDir, VISITOR_LATEST)), before);
  assert.deepEqual((await fs.readdir(join(rootDir, 'metrics/visitors'))).sort(), ['latest.json', 'snapshots']);
});

test('the command exits successfully on upstream failure so unrelated collection can continue', async (t) => {
  const rootDir = await directory(t);
  const script = fileURLToPath(new URL('./visitor-snapshot.mjs', import.meta.url));
  const setup = 'globalThis.fetch = async () => { throw new Error("offline"); };';
  const child = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(setup)}`, script], {
    cwd: rootDir, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /visitor snapshot skipped \(request-failed\)/);
  assert.deepEqual(await fs.readdir(rootDir), []);
});
