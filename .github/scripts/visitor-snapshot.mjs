import * as fileSystem from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  VISITOR_SOURCE, VisitorDataError, visitorHash, visitorResponse, visitorSourceHeaders,
  visitorTimestamp, makeVisitorEvidence, makeVisitorLatest, validateVisitorPointer, verifyVisitorLatest,
} from './visitor-data.mjs';

export const VISITOR_TIMEOUT_MS = 8000;
export const VISITOR_LATEST = 'metrics/visitors/latest.json';

export async function fetchVisitorObservation({ fetchImpl = globalThis.fetch, now = () => new Date(),
  timeoutMs = VISITOR_TIMEOUT_MS } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > VISITOR_TIMEOUT_MS) {
    throw new VisitorDataError('invalid-timeout');
  }
  const collectionStartedAt = visitorTimestamp(now());
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new VisitorDataError('request-timeout'));
    }, timeoutMs);
  });
  const request = (async () => {
    const response = await fetchImpl(VISITOR_SOURCE, {
      method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
      headers: { Accept: 'application/json' }, signal: controller.signal,
    });
    if (!response.ok) throw new VisitorDataError('upstream-error');
    const text = await response.text();
    if (text.length > 1024) throw new VisitorDataError('invalid-response');
    let json;
    try { json = JSON.parse(text); } catch { throw new VisitorDataError('invalid-response'); }
    return {
      sourceResponse: visitorResponse(json),
      sourceHeaders: visitorSourceHeaders(response.headers),
      collectionStartedAt,
      asOf: visitorTimestamp(now()),
    };
  })();
  try { return await Promise.race([request, timeout]); }
  catch (error) {
    throw error instanceof VisitorDataError ? error : new VisitorDataError('request-failed');
  } finally { clearTimeout(timer); }
}

export async function readVisitorLatest({ rootDir = process.cwd(), fs = fileSystem } = {}) {
  let text;
  try { text = await fs.readFile(join(rootDir, VISITOR_LATEST), 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new VisitorDataError('previous-evidence-invalid');
  }
  try {
    const latest = validateVisitorPointer(JSON.parse(text));
    const bytes = await fs.readFile(join(rootDir, latest.snapshot.slice(1)));
    return verifyVisitorLatest(latest, bytes);
  } catch { throw new VisitorDataError('previous-evidence-invalid'); }
}

async function writeExclusive(path, bytes, fs) {
  const handle = await fs.open(path, 'wx');
  try {
    await handle.writeFile(bytes, 'utf8');
    await handle.sync();
    await handle.close();
  } catch (error) {
    try { await handle.close(); } catch { /* preserve the write failure */ }
    try { await fs.unlink(path); } catch { /* only a file created by this write is eligible */ }
    throw error;
  }
}

export async function recordVisitorObservation(observation, { rootDir = process.cwd(), fs = fileSystem,
  temporaryId = () => randomUUID() } = {}) {
  const previous = await readVisitorLatest({ rootDir, fs });
  const observed = makeVisitorEvidence(observation);
  if (previous?.counterValue === observed.counterValue
    && previous.asOf.slice(0, 10) === observed.asOf.slice(0, 10)) {
    return { status: 'unchanged', latest: previous };
  }
  const evidence = previous ? makeVisitorEvidence(observation, previous) : observed;
  const bytes = JSON.stringify(evidence, null, 2) + '\n';
  const latest = makeVisitorLatest(evidence, visitorHash(bytes));
  const archivePath = join(rootDir, latest.snapshot.slice(1));
  const latestPath = join(rootDir, VISITOR_LATEST);
  await fs.mkdir(dirname(archivePath), { recursive: true });
  try { await writeExclusive(archivePath, bytes, fs); }
  catch (error) {
    // A retry after a pointer-write failure may reuse the exact same immutable bytes.
    if (error.code !== 'EEXIST' || visitorHash(await fs.readFile(archivePath)) !== latest.evidenceSha256) throw error;
  }
  const id = temporaryId();
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]+$/.test(id)) throw new VisitorDataError('write-failed');
  const tempPath = join(dirname(latestPath), `.latest-${id}.tmp`);
  let tempCreated = false;
  try {
    await writeExclusive(tempPath, JSON.stringify(latest, null, 2) + '\n', fs);
    tempCreated = true;
    await fs.rename(tempPath, latestPath);
  } finally {
    if (tempCreated) {
      try { await fs.unlink(tempPath); } catch { /* rename already removed it, or leave failure for the caller */ }
    }
  }
  return { status: 'written', latest };
}

export async function runVisitorSnapshot({ log = console.log, ...options } = {}) {
  try {
    const observation = await fetchVisitorObservation(options);
    const result = await recordVisitorObservation(observation, options);
    log(`visitor snapshot ${result.status}: count=${result.latest.counterValue} recorded=${result.latest.asOf}`);
    return result;
  } catch (error) {
    const code = error instanceof VisitorDataError ? error.code : 'write-failed';
    // Optional aggregate collection must not interrupt the GitHub download snapshot job.
    log(`visitor snapshot skipped (${code}); previous observation retained`);
    return { status: 'failed', error: code };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runVisitorSnapshot();
}
