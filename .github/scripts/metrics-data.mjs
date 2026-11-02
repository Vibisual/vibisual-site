// Public counters are observations, not evidence of a human installation.
export const REPO = 'Vibisual/vibisual';
export const METHOD = 'github-installer-downloads-v2';

function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`Invalid ${label}`);
  return value;
}

export function assetKind(name) {
  if (typeof name !== 'string' || !name) throw new Error('Invalid asset name');
  if (/\.(exe|dmg|appimage|deb|rpm)$/i.test(name)) return 'installer';
  if (/\.ya?ml$/i.test(name)) return 'update-metadata';
  if (/\.blockmap$/i.test(name)) return 'update-blockmap';
  if (/\.zip$/i.test(name)) return 'archive';
  return 'other';
}

export async function readAllReleases(api) {
  const releases = [];
  for (let page = 1; page <= 100; page++) {
    const batch = await api(`/repos/${REPO}/releases?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('Invalid releases response');
    releases.push(...batch);
    if (batch.length < 100) return releases;
  }
  throw new Error('Release pagination incomplete; previous statistics retained');
}

export function summarize(repo, releases, latestReleaseId) {
  const stars = count(repo.stargazers_count, 'star count');
  if (!Array.isArray(releases)) throw new Error('Invalid releases');
  const releaseIds = new Set();
  const assetIds = new Set();
  const records = [];
  let installerDownloads = 0;
  let allAssetDownloads = 0;
  for (const rel of releases) {
    if (typeof rel.draft !== 'boolean' || typeof rel.prerelease !== 'boolean') throw new Error('Missing release status');
    if (rel.draft) continue;
    count(rel.id, 'release id');
    if (releaseIds.has(rel.id)) throw new Error('Duplicate release; pagination changed during observation');
    releaseIds.add(rel.id);
    if (typeof rel.tag_name !== 'string' || !rel.tag_name || !Array.isArray(rel.assets)) throw new Error('Invalid release data');
    timestamp(rel.published_at, 'release publication date');
    const assets = rel.assets.map((a) => {
      count(a.id, 'asset id');
      if (assetIds.has(a.id)) throw new Error('Duplicate asset');
      assetIds.add(a.id);
      const downloads = count(a.download_count, 'download count');
      const kind = assetKind(a.name);
      allAssetDownloads = count(allAssetDownloads + downloads, 'aggregate download count');
      if (kind === 'installer') installerDownloads = count(installerDownloads + downloads, 'installer total');
      return { id: a.id, name: a.name, kind, downloadCount: downloads,
        createdAt: timestamp(a.created_at, 'asset creation date'), updatedAt: timestamp(a.updated_at, 'asset update date') };
    }).sort((a, b) => a.id - b.id);
    records.push({ id: rel.id, tag: rel.tag_name, prerelease: rel.prerelease, publishedAt: rel.published_at, assets });
  }
  records.sort((a, b) => a.id - b.id);
  // GitHub can designate an older release as latest. Do not infer it from dates.
  const latest = releases.find((r) => r.id === latestReleaseId);
  if (latest ? latest.draft || latest.prerelease : latestReleaseId != null || records.some((r) => !r.prerelease)) {
    throw new Error('Latest release does not match the complete public stable release list');
  }
  const names = latest?.assets.map((a) => a.name) ?? [];
  return {
    schemaVersion: 2,
    methodology: METHOD,
    stars,
    installerDownloads,
    allAssetDownloads,
    verifiedInstallations: null,
    activeUsers: null,
    source: `https://api.github.com/repos/${REPO}/releases?per_page=100`,
    apiVersion: '2022-11-28',
    releases: records,
    release: {
      tag: latest?.tag_name ?? null,
      win: names.filter((n) => n.endsWith('-setup.exe')),
      mac: names.filter((n) => n.endsWith('.dmg')).sort((a, b) => Number(b.includes('arm64')) - Number(a.includes('arm64'))),
      linux: names.filter((n) => /\.(AppImage|deb|rpm)$/.test(n)),
    },
  };
}
