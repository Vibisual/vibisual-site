import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { summarize } from './metrics-data.mjs';
import { prepareMetricsRecord, writeMetricsRecord } from './metrics-record.mjs';

const observed = count => summarize({ stargazers_count: 0 }, [{
  id: 1, tag_name: 'v1.0.0', draft: false, prerelease: false, published_at: '2026-01-01T00:00:00Z',
  assets: [{ id: 2, name: 'app.exe', download_count: count, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }],
}], 1);
const home = () => { const dir = mkdtempSync(join(tmpdir(), 'vibisual-observation-')); return { dir, outputPath: join(dir, 'stats.json') }; };
const record = (fixture, n, asOf) => prepareMetricsRecord({ ...fixture, observed: observed(n), collectionStartedAt: asOf, asOf });

test('observations retain immutable predecessors and exactly reconcile counter changes', () => {
  const fixture = home();
  const first = record(fixture, 7, '2026-01-01T00:00:00.000Z');
  writeMetricsRecord(fixture.outputPath, first);
  const firstBytes = readFileSync(join(fixture.dir, first.snapshot.slice(1)));
  const next = record(fixture, 9, '2026-01-01T00:10:00.000Z');
  assert.equal(next.downloadChange.installerDelta, 2);
  assert.equal(next.previousObservation.evidenceSha256, first.evidenceSha256);
  assert.deepEqual(readFileSync(join(fixture.dir, first.snapshot.slice(1))), firstBytes);
  writeMetricsRecord(fixture.outputPath, next);
  const bytes = readFileSync(join(fixture.dir, next.snapshot.slice(1)));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), next.evidenceSha256);
  assert.equal(JSON.parse(bytes).comparison.changes[0].counterDelta, 2);
  assert.equal(readdirSync(fixture.dir).filter(x => x.endsWith('.tmp')).length, 0);
});

test('unchanged same-day data retains the original observation; a new day records a new one', () => {
  const fixture = home();
  const first = record(fixture, 7, '2026-01-01T00:00:00.000Z');
  writeMetricsRecord(fixture.outputPath, first);
  const bytes = readFileSync(fixture.outputPath);
  const same = record(fixture, 7, '2026-01-01T00:10:00.000Z');
  assert.equal(writeMetricsRecord(fixture.outputPath, same), false);
  assert.deepEqual(readFileSync(fixture.outputPath), bytes);
  const next = record(fixture, 7, '2026-01-02T00:00:00.000Z');
  assert.equal(next.downloadChange.installerDelta, 0);
  assert.notEqual(next.snapshot, first.snapshot);
});

test('an unverified previous pointer or corrupt snapshot cannot be replaced', () => {
  for (const corruption of ['total', 'dataHash', 'comparison', 'snapshot']) {
    const fixture = home();
    const first = record(fixture, 7, '2026-01-01T00:00:00.000Z');
    writeMetricsRecord(fixture.outputPath, first);
    if (corruption === 'total') writeFileSync(fixture.outputPath, JSON.stringify({ ...first, installerDownloads: 8 }));
    else if (corruption === 'dataHash') writeFileSync(fixture.outputPath, JSON.stringify({ ...first, dataSha256: '0'.repeat(64) }));
    else if (corruption === 'comparison') writeFileSync(fixture.outputPath, JSON.stringify({ ...first, downloadChange: { installerDelta: 8 } }));
    else writeFileSync(join(fixture.dir, first.snapshot.slice(1)), '{}');
    const previous = readFileSync(fixture.outputPath);
    assert.throws(() => record(fixture, 9, '2026-01-01T00:10:00.000Z'), /Previous/);
    assert.deepEqual(readFileSync(fixture.outputPath), previous);
  }
});

test('old schema-2 snapshots gain comparisons without resetting their value or history', () => {
  const fixture = home();
  const first = record(fixture, 7, '2026-01-01T00:00:00.000Z');
  const legacy = { ...first }; delete legacy.observationVersion;
  writeMetricsRecord(fixture.outputPath, legacy);
  const next = record(fixture, 7, '2026-01-01T00:10:00.000Z');
  assert.equal(next.installerDownloads, 7);
  assert.equal(next.downloadChange.installerDelta, 0);
  assert.equal(next.previousObservation.snapshot, first.snapshot);
});

test('out-of-order observations do not overwrite the latest recorded value', () => {
  const fixture = home();
  const first = record(fixture, 7, '2026-01-01T01:00:00.000Z');
  writeMetricsRecord(fixture.outputPath, first);
  assert.throws(() => record(fixture, 9, '2026-01-01T00:59:00.000Z'), /predates/);
});
