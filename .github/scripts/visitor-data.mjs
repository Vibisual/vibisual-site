import { createHash } from 'node:crypto';

export const VISITOR_SOURCE = 'https://abacus.jasoncameron.dev/get/vibisual-pro/site-total';
export const VISITOR_METHOD = 'abacus-browser-marker-v2';
export const VISITOR_CAVEATS = Object.freeze({
  publicWritableCounter: true,
  verifiedPeople: null,
  automatedRequests: null,
  description: 'An external publicly writable aggregate counter. Browser markers reduce repeated increments; unique people and automated requests are not verified.',
});

const HASH = /^[a-f0-9]{64}$/;
const SNAPSHOT = /^\/metrics\/visitors\/snapshots\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.json$/;
const ETAG = /^(?:W\/)?"[A-Za-z0-9_+/-]{1,120}={0,2}"$/;

export class VisitorDataError extends Error {
  constructor(code) {
    super(code);
    this.name = 'VisitorDataError';
    this.code = code;
  }
}

function requireValue(condition, code = 'invalid-evidence') {
  if (!condition) throw new VisitorDataError(code);
}

export function visitorTimestamp(value) {
  const result = value instanceof Date ? value.toISOString() : value;
  requireValue(typeof result === 'string' && Number.isFinite(Date.parse(result))
    && new Date(result).toISOString() === result, 'invalid-timestamp');
  return result;
}

export function visitorResponse(input) {
  requireValue(input && typeof input === 'object' && !Array.isArray(input)
    && Number.isSafeInteger(input.value) && input.value >= 0, 'invalid-response');
  // Preserve only the public aggregate, never unexpected upstream fields.
  return { value: input.value };
}

export function visitorHash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function visitorResponseHash(input) {
  return visitorHash(JSON.stringify(visitorResponse(input)));
}

export function visitorSourceHeaders(headers) {
  const kept = {};
  const httpDate = headers?.get?.('date');
  if (typeof httpDate === 'string' && httpDate.length <= 64 && Number.isFinite(Date.parse(httpDate))) {
    kept.httpDate = new Date(httpDate).toISOString();
  }
  const etag = headers?.get?.('etag');
  if (typeof etag === 'string' && ETAG.test(etag)) kept.etag = etag;
  return kept;
}

export function visitorSnapshotPath(asOf) {
  return `/metrics/visitors/snapshots/${visitorTimestamp(asOf).replaceAll(':', '-')}.json`;
}

function validatePrevious(previous, asOf, counterValue, delta) {
  if (previous === null) {
    requireValue(delta === null);
    return;
  }
  requireValue(previous && typeof previous === 'object' && !Array.isArray(previous));
  requireValue(SNAPSHOT.test(previous.snapshot) && HASH.test(previous.evidenceSha256));
  requireValue(previous.snapshot === visitorSnapshotPath(previous.asOf));
  requireValue(Number.isSafeInteger(previous.counterValue) && previous.counterValue >= 0);
  requireValue(previous.asOf < asOf && delta === counterValue - previous.counterValue);
}

function validateCommon(record) {
  requireValue(record && typeof record === 'object' && !Array.isArray(record));
  requireValue(record.schemaVersion === 1 && record.methodology === VISITOR_METHOD
    && record.source === VISITOR_SOURCE);
  requireValue(Number.isSafeInteger(record.counterValue) && record.counterValue >= 0);
  visitorTimestamp(record.collectionStartedAt);
  visitorTimestamp(record.asOf);
  requireValue(record.collectionStartedAt <= record.asOf);
  requireValue(JSON.stringify(record.caveats) === JSON.stringify(VISITOR_CAVEATS));
  validatePrevious(record.previous, record.asOf, record.counterValue, record.changeFromPrevious);
}

export function makeVisitorEvidence(observation, previous = null) {
  const response = visitorResponse(observation.sourceResponse);
  const collectionStartedAt = visitorTimestamp(observation.collectionStartedAt);
  const asOf = visitorTimestamp(observation.asOf);
  const link = previous ? {
    snapshot: previous.snapshot,
    evidenceSha256: previous.evidenceSha256,
    asOf: previous.asOf,
    counterValue: previous.counterValue,
  } : null;
  const evidence = {
    schemaVersion: 1,
    methodology: VISITOR_METHOD,
    source: VISITOR_SOURCE,
    collectionStartedAt,
    asOf,
    counterValue: response.value,
    sourceResponse: response,
    sourceResponseSha256: visitorResponseHash(response),
    sourceHeaders: observation.sourceHeaders,
    previous: link,
    changeFromPrevious: previous ? response.value - previous.counterValue : null,
    caveats: { ...VISITOR_CAVEATS },
  };
  validateVisitorEvidence(evidence);
  return evidence;
}

export function validateVisitorEvidence(evidence) {
  validateCommon(evidence);
  requireValue(JSON.stringify(evidence.sourceResponse) === JSON.stringify(visitorResponse(evidence.sourceResponse)));
  requireValue(evidence.sourceResponse.value === evidence.counterValue
    && evidence.sourceResponseSha256 === visitorResponseHash(evidence.sourceResponse));
  const headers = evidence.sourceHeaders;
  requireValue(headers && typeof headers === 'object' && !Array.isArray(headers));
  requireValue(Object.keys(headers).every((key) => key === 'httpDate' || key === 'etag'));
  if ('httpDate' in headers) visitorTimestamp(headers.httpDate);
  if ('etag' in headers) requireValue(typeof headers.etag === 'string' && ETAG.test(headers.etag));
  return evidence;
}

export function makeVisitorLatest(evidence, evidenceSha256) {
  validateVisitorEvidence(evidence);
  requireValue(HASH.test(evidenceSha256));
  return {
    schemaVersion: 1,
    methodology: VISITOR_METHOD,
    source: VISITOR_SOURCE,
    counterValue: evidence.counterValue,
    collectionStartedAt: evidence.collectionStartedAt,
    asOf: evidence.asOf,
    snapshot: visitorSnapshotPath(evidence.asOf),
    evidenceSha256,
    sourceResponseSha256: evidence.sourceResponseSha256,
    previous: evidence.previous,
    changeFromPrevious: evidence.changeFromPrevious,
    caveats: { ...VISITOR_CAVEATS },
  };
}

export function validateVisitorPointer(pointer) {
  validateCommon(pointer);
  requireValue(SNAPSHOT.test(pointer.snapshot) && pointer.snapshot === visitorSnapshotPath(pointer.asOf));
  requireValue(HASH.test(pointer.evidenceSha256) && HASH.test(pointer.sourceResponseSha256));
  return pointer;
}

export function verifyVisitorLatest(pointer, evidenceBytes) {
  validateVisitorPointer(pointer);
  requireValue(visitorHash(evidenceBytes) === pointer.evidenceSha256);
  let evidence;
  try { evidence = JSON.parse(evidenceBytes.toString('utf8')); }
  catch { throw new VisitorDataError('invalid-evidence'); }
  validateVisitorEvidence(evidence);
  requireValue(JSON.stringify(pointer) === JSON.stringify(makeVisitorLatest(evidence, pointer.evidenceSha256)));
  return pointer;
}
