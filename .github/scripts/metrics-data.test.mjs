import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize, readAllReleases } from './metrics-data.mjs';

const asset = (id, name, download_count) => ({ id, name, download_count, created_at: '2026-11-02T00:00:00Z', updated_at: '2026-11-02T00:00:00Z' });
const release = (id, assets, extra = {}) => ({ id, tag_name: `v0.0.${id}`, draft: false, prerelease: false, published_at: `2026-11-0${id}T00:00:00Z`, assets, ...extra });

test('raw installer downloads include bots/CI without an invented baseline, and unknown people stay null', () => {
  const result = summarize({ stargazers_count: 1 }, [release(1, [
    asset(1, 'app-setup.exe', 200), asset(2, 'app.dmg', 10), asset(3, 'app.AppImage', 2),
    asset(4, 'app.deb', 3), asset(5, 'app.rpm', 4), asset(6, 'latest.yml', 900),
    asset(7, 'app.exe.blockmap', 80), asset(8, 'app-mac.zip', 20), asset(9, 'SHA256SUMS.txt', 10),
  ])], 1);
  assert.equal(result.installerDownloads, 219);
  assert.equal(result.allAssetDownloads, 1229);
  assert.equal(result.verifiedInstallations, null);
  assert.equal(result.activeUsers, null);
  assert.equal('installs' in result, false);
  assert.equal(result.releases[0].assets.length, 9);
});

test('drafts are excluded, public previews counted, GitHub designated stable release selected', () => {
  const result = summarize({ stargazers_count: 0 }, [
    release(3, [asset(3, 'new.exe', 999)], { draft: true }),
    release(2, [asset(2, 'preview.exe', 7)], { prerelease: true }),
    release(1, [asset(1, 'stable-setup.exe', 0)]),
  ], 1);
  assert.equal(result.installerDownloads, 7);
  assert.equal(result.release.tag, 'v0.0.1');
  assert.equal(result.releases.length, 2);
});

test('invalid counters and partial/duplicated pages fail instead of publishing a misleading total', async () => {
  for (const n of [undefined, null, '4', -1, NaN, 1.5, Infinity]) {
    assert.throws(() => summarize({ stargazers_count: 1 }, [release(1, [asset(1, 'app.exe', n)])]));
  }
  assert.throws(() => summarize({ stargazers_count: 1 }, [release(1, []), release(1, [])]));
  assert.throws(() => summarize({ stargazers_count: 1 }, [release(1, [asset(1, 'a.exe', 1), asset(1, 'b.exe', 2)])]));
  await assert.rejects(readAllReleases(async () => ({ message: 'rate limited' })));
  await assert.rejects(readAllReleases(async () => Array(100).fill({})), /incomplete/);
});

test('all release pages are read and deleted asset counters are not forced upward', async () => {
  const paths = [];
  const pages = [Array.from({ length: 100 }, (_, i) => ({ id: i })), [{ id: 100 }]];
  const list = await readAllReleases(async (path) => { paths.push(path); return pages.shift(); });
  assert.equal(list.length, 101);
  assert.match(paths[1], /page=2$/);
  const before = summarize({ stargazers_count: 0 }, [release(1, [asset(1, 'a.exe', 5), asset(2, 'b.exe', 8)])], 1);
  const after = summarize({ stargazers_count: 0 }, [release(1, [asset(1, 'a.exe', 5)])], 1);
  assert.equal(before.installerDownloads, 13);
  assert.equal(after.installerDownloads, 5);
});


test('a later old-version publication cannot override the GitHub latest designation', () => {
  const releases = [release(1, [asset(1, 'current-setup.exe', 2)]), release(2, [asset(2, 'older-patch-setup.exe', 1)])];
  assert.equal(summarize({ stargazers_count: 1 }, releases, 1).release.tag, 'v0.0.1');
  assert.throws(() => summarize({ stargazers_count: 1 }, releases, 999), /Latest release/);
  assert.throws(() => summarize({ stargazers_count: 1 }, releases, null), /Latest release/);
  assert.equal(summarize({ stargazers_count: 0 }, [], null).release.tag, null);
});
