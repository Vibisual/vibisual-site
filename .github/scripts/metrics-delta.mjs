import { assetKind } from './metrics-data.mjs';

function index(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== 2 || !Array.isArray(snapshot.releases)) {
    throw new Error('Invalid comparison snapshot');
  }
  const assets = new Map();
  const releases = new Set();
  let installers = 0;
  let all = 0;
  for (const release of snapshot.releases) {
    if (!Number.isSafeInteger(release.id) || release.id < 0 || releases.has(release.id)
        || typeof release.tag !== 'string' || !Array.isArray(release.assets)) {
      throw new Error('Invalid comparison release');
    }
    releases.add(release.id);
    for (const asset of release.assets) {
      if (!Number.isSafeInteger(asset.id) || asset.id < 0 || assets.has(asset.id)
          || !Number.isSafeInteger(asset.downloadCount) || asset.downloadCount < 0
          || asset.kind !== assetKind(asset.name)) {
        throw new Error('Invalid comparison asset');
      }
      assets.set(asset.id, { ...asset, releaseId: release.id, tag: release.tag });
      all += asset.downloadCount;
      if (asset.kind === 'installer') installers += asset.downloadCount;
    }
  }
  if (!Number.isSafeInteger(installers) || !Number.isSafeInteger(all)
      || installers !== snapshot.installerDownloads || all !== snapshot.allAssetDownloads) {
    throw new Error('Comparison snapshot totals do not match its assets');
  }
  return assets;
}

export function compareMetrics(previous, current) {
  const after = index(current);
  if (!previous) return { basis: 'first-recorded-observation', installerDelta: null, changes: [] };
  const before = index(previous);
  if (previous.methodology !== current.methodology) {
    return { basis: 'methodology-changed', installerDelta: null, changes: [] };
  }
  let retainedInstallerDelta = 0;
  let enteredInstallerDownloads = 0;
  let leftInstallerDownloads = 0;
  const changes = [];
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b)) {
    const old = before.get(id);
    const next = after.get(id);
    const wasInstaller = old?.kind === 'installer';
    const isInstaller = next?.kind === 'installer';
    const oldContribution = wasInstaller ? old.downloadCount : 0;
    const newContribution = isInstaller ? next.downloadCount : 0;
    if (wasInstaller && isInstaller) retainedInstallerDelta += newContribution - oldContribution;
    else if (isInstaller) enteredInstallerDownloads += newContribution;
    else if (wasInstaller) leftInstallerDownloads += oldContribution;
    if (old && next && old.downloadCount === next.downloadCount && old.name === next.name
        && old.releaseId === next.releaseId && old.tag === next.tag) continue;
    changes.push({
      assetId: id,
      change: !old ? 'added' : !next ? 'removed' : 'changed',
      before: old ? { releaseId: old.releaseId, tag: old.tag, name: old.name, kind: old.kind, downloadCount: old.downloadCount } : null,
      after: next ? { releaseId: next.releaseId, tag: next.tag, name: next.name, kind: next.kind, downloadCount: next.downloadCount } : null,
      // A new or removed asset has no observed counter-to-counter increment.
      counterDelta: old && next ? next.downloadCount - old.downloadCount : null,
      installerContributionDelta: newContribution - oldContribution,
    });
  }
  const installerDelta = current.installerDownloads - previous.installerDownloads;
  if (installerDelta !== retainedInstallerDelta + enteredInstallerDownloads - leftInstallerDownloads) {
    throw new Error('Installer changes do not reconcile');
  }
  return {
    basis: 'same-methodology-asset-ids',
    previousInstallerDownloads: previous.installerDownloads,
    currentInstallerDownloads: current.installerDownloads,
    installerDelta,
    retainedInstallerDelta,
    enteredInstallerDownloads,
    leftInstallerDownloads,
    allAssetDelta: current.allAssetDownloads - previous.allAssetDownloads,
    changes,
  };
}
