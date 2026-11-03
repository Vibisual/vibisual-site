import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { compareMetrics } from './metrics-delta.mjs';
import { readVisitorLatest } from './visitor-snapshot.mjs';

const root = resolve(process.argv[2] ?? '.');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const load = reference => {
  assert.match(reference.snapshot, /^\/metrics\/(?:visitors\/)?snapshots\/[0-9TZ.-]+\.json$/);
  const bytes = readFileSync(join(root, reference.snapshot.slice(1)));
  assert.equal(hash(bytes), reference.evidenceSha256);
  const record = JSON.parse(bytes);
  assert.equal(record.asOf, reference.asOf);
  return record;
};

const stats = JSON.parse(readFileSync(join(root, 'stats.json'), 'utf8'));
const current = load(stats);
compareMetrics(null, current);
assert.equal(stats.schemaVersion, 2);
assert.equal(stats.methodology, current.methodology);
assert.equal(stats.installerDownloads, current.installerDownloads);
assert.equal(stats.allAssetDownloads, current.allAssetDownloads);
assert.equal(stats.stars, current.stars);
assert.equal(stats.verifiedInstallations, null);
assert.equal(stats.activeUsers, null);
assert.deepEqual(stats.release, current.release);
const { observationVersion, asOf, collectionStartedAt, previousObservation, comparison, ...raw } = current;
assert.equal(hash(JSON.stringify(raw)), stats.dataSha256);
if (stats.observationVersion === 1) {
  assert.equal(observationVersion, 1);
  assert.deepEqual(previousObservation, stats.previousObservation);
  const previous = previousObservation ? load(previousObservation) : null;
  assert.deepEqual(comparison, compareMetrics(previous, current));
  const { changes, ...summary } = comparison;
  assert.deepEqual(stats.downloadChange, summary);
}

const visitor = await readVisitorLatest({ rootDir: root });
if (visitor?.previous) {
  const previous = load(visitor.previous);
  assert.equal(previous.counterValue, visitor.previous.counterValue);
  assert.equal(visitor.changeFromPrevious, visitor.counterValue - previous.counterValue);
}
console.log(JSON.stringify({
  ok: true,
  github: { installerDownloads: stats.installerDownloads, asOf: stats.asOf,
    change: stats.downloadChange?.installerDelta ?? null, snapshot: stats.snapshot },
  website: visitor ? { counterValue: visitor.counterValue, asOf: visitor.asOf,
    change: visitor.changeFromPrevious, snapshot: visitor.snapshot, verifiedPeople: null }
    : { status: 'not-recorded', verifiedPeople: null },
}, null, 2));
