import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from './metrics-data.mjs';
import { compareMetrics } from './metrics-delta.mjs';

const stamp = '2026-01-01T00:00:00Z';
const a = (id, name, download_count) => ({ id, name, download_count, created_at: stamp, updated_at: stamp });
const snap = assets => summarize({ stargazers_count: 1 }, [
  { id: 1, tag_name: 'v1.0.0', published_at: stamp, draft: false, prerelease: false, assets },
], 1);

test('counter movement is separated from newly listed and removed installer assets', () => {
  const before = snap([a(1, 'app.exe', 8), a(2, 'old.dmg', 5), a(3, 'latest.yml', 40)]);
  const after = snap([a(1, 'app.exe', 10), a(4, 'new.dmg', 7), a(3, 'latest.yml', 45)]);
  const d = compareMetrics(before, after);
  assert.equal(d.installerDelta, 4);
  assert.equal(d.retainedInstallerDelta, 2);
  assert.equal(d.enteredInstallerDownloads, 7);
  assert.equal(d.leftInstallerDownloads, 5);
  assert.equal(d.allAssetDelta, 9);
  assert.equal(d.changes.find(x => x.assetId === 3).installerContributionDelta, 0);
  assert.equal(d.changes.find(x => x.assetId === 4).counterDelta, null);
});

test('counter corrections and valid zero remain negative instead of being clamped', () => {
  const d = compareMetrics(snap([a(1, 'app.exe', 8)]), snap([a(1, 'app.exe', 0)]));
  assert.equal(d.installerDelta, -8);
  assert.equal(d.retainedInstallerDelta, -8);
  assert.equal(d.changes[0].counterDelta, -8);
});

test('renamed or reclassified assets are reconciled by ID without inventing downloads', () => {
  const d = compareMetrics(snap([a(1, 'payload.zip', 8), a(2, 'old.exe', 4)]),
    snap([a(1, 'payload.exe', 8), a(2, 'renamed.exe', 4)]));
  assert.equal(d.installerDelta, 8);
  assert.equal(d.enteredInstallerDownloads, 8);
  assert.equal(d.retainedInstallerDelta, 0);
  assert.equal(d.changes[0].counterDelta, 0);
  assert.equal(d.changes[1].installerContributionDelta, 0);
});

test('changed definitions and an initial observation cannot imply period growth', () => {
  const current = snap([a(1, 'app.exe', 8)]);
  assert.equal(compareMetrics(null, current).installerDelta, null);
  assert.equal(compareMetrics({ ...current, methodology: 'older-definition' }, current).installerDelta, null);
  assert.equal(compareMetrics(current, current).installerDelta, 0);
  assert.deepEqual(compareMetrics(current, current).changes, []);
});

test('a corrupt prior total, duplicate ID or classification fails comparison', () => {
  const current = snap([a(1, 'app.exe', 8)]);
  assert.throws(() => compareMetrics({ ...current, installerDownloads: 7 }, current), /totals/);
  const duplicate = structuredClone(current);
  duplicate.releases[0].assets.push(duplicate.releases[0].assets[0]);
  assert.throws(() => compareMetrics(duplicate, current), /asset/);
  const wrongKind = structuredClone(current);
  wrongKind.releases[0].assets[0].kind = 'other';
  assert.throws(() => compareMetrics(wrongKind, current), /asset/);
});
