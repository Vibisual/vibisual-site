import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { compareMetrics } from './metrics-delta.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const snapshotName = /^\/metrics\/snapshots\/[0-9TZ.-]+\.json$/;

export function atomicText(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temporary, 'wx');
    writeFileSync(fd, text, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, file);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

export function prepareMetricsRecord({ outputPath, observed, collectionStartedAt, asOf = new Date().toISOString() }) {
  if (!Number.isFinite(Date.parse(asOf)) || !Number.isFinite(Date.parse(collectionStartedAt))
      || Date.parse(asOf) < Date.parse(collectionStartedAt)) throw new Error('Invalid observation time');
  compareMetrics(null, observed);
  const dataSha256 = hash(JSON.stringify(observed));
  let previous = null;
  let previousEvidence = null;
  if (existsSync(outputPath)) {
    previous = JSON.parse(readFileSync(outputPath, 'utf8'));
    if (previous.schemaVersion !== 2 || !snapshotName.test(previous.snapshot)
        || !Number.isFinite(Date.parse(previous.asOf))) throw new Error('Invalid previous metrics pointer');
    const bytes = readFileSync(join(dirname(outputPath), previous.snapshot.slice(1)));
    if (hash(bytes) !== previous.evidenceSha256) throw new Error('Previous metrics evidence hash mismatch');
    previousEvidence = JSON.parse(bytes);
    if (previousEvidence.asOf !== previous.asOf || previousEvidence.methodology !== previous.methodology
        || previousEvidence.installerDownloads !== previous.installerDownloads
        || previousEvidence.allAssetDownloads !== previous.allAssetDownloads
        || previousEvidence.stars !== previous.stars) throw new Error('Previous metrics pointer differs from evidence');
    const { observationVersion, collectionStartedAt: priorStart, asOf: priorTime,
      previousObservation, comparison, ...recordedObservation } = previousEvidence;
    if (hash(JSON.stringify(recordedObservation)) !== previous.dataSha256
        || JSON.stringify(previous.release) !== JSON.stringify(previousEvidence.release)
        || previous.source !== previousEvidence.source) throw new Error('Previous metrics data hash or metadata mismatch');
    if (previous.observationVersion === 1
        && (observationVersion !== 1 || !comparison
          || JSON.stringify(previous.downloadChange) !== JSON.stringify({ ...comparison, changes: undefined })
          || JSON.stringify(previous.previousObservation) !== JSON.stringify(previousObservation))) {
      throw new Error('Previous metrics comparison differs from evidence');
    }
    compareMetrics(null, previousEvidence);
    if (Date.parse(asOf) < Date.parse(previous.asOf)) throw new Error('Observation predates previous metrics');
    if (previous.observationVersion === 1 && previous.dataSha256 === dataSha256
        && previous.asOf.slice(0, 10) === asOf.slice(0, 10)) return previous;
  }
  const comparison = compareMetrics(previousEvidence, observed);
  const previousObservation = previous ? {
    snapshot: previous.snapshot, evidenceSha256: previous.evidenceSha256, asOf: previous.asOf,
  } : null;
  const evidence = JSON.stringify({
    ...observed, observationVersion: 1, collectionStartedAt, asOf, previousObservation, comparison,
  }, null, 2) + '\n';
  const evidenceSha256 = hash(evidence);
  const snapshot = `/metrics/snapshots/${asOf.replaceAll(':', '-')}.json`;
  const evidencePath = join(dirname(outputPath), snapshot.slice(1));
  mkdirSync(dirname(evidencePath), { recursive: true });
  if (existsSync(evidencePath)) {
    if (readFileSync(evidencePath, 'utf8') !== evidence) throw new Error('Immutable snapshot timestamp collision');
  } else writeFileSync(evidencePath, evidence, { flag: 'wx' });
  return {
    schemaVersion: 2, observationVersion: 1,
    methodology: observed.methodology,
    stars: observed.stars,
    installerDownloads: observed.installerDownloads,
    allAssetDownloads: observed.allAssetDownloads,
    verifiedInstallations: null,
    activeUsers: null,
    asOf,
    source: observed.source,
    methodologyUrl: '/metrics/',
    snapshot, evidenceSha256, dataSha256, previousObservation,
    downloadChange: { ...comparison, changes: undefined },
    release: observed.release,
  };
}

export function writeMetricsRecord(outputPath, stats) {
  const next = JSON.stringify(stats, null, 2) + '\n';
  const previous = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '';
  if (next === previous) return false;
  atomicText(outputPath, next);
  return true;
}
