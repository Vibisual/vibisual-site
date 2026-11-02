// stats.json 을 짓는다 — 스타 수 · 설치 파일 다운로드 요청 수 · 최신 릴리스 자산 목록.
// 같은 값으로 index.html 안의 '조회 실패용' 폴백(버전 문자열 · 다운로드 파일 이름)도 맞춘다.
//
// 왜 이걸 여기서 짓나: 이 숫자를 브라우저가 직접 GitHub 에 물으면 안 되기 때문이다.
// GitHub 공개 API 는 키 없이 쓰면 **방문자 IP 당 시간 60회**다. 사이트 전체가 아니라
// 보는 사람마다 따로 세는 한도라, 새로고침을 몇십 번 하거나 이동통신망처럼 여러 사람이
// 한 IP 를 나눠 쓰면 금세 비고 그때부터 숫자 칸이 '—' 로 죽는다.
// 그래서 조회는 **여기(GitHub Actions, 인증 조회라 저장소당 시간 1,000회)** 에서만 하고,
// 방문자는 같은 도메인의 stats.json 한 장만 읽는다 — 방문자가 쓰는 GitHub 한도는 0 이다.
//
// 실행: node .github/scripts/build-stats.mjs [출력경로] [페이지경로]
//   GITHUB_TOKEN 이 있으면 인증 조회(권장), 없으면 무인증으로도 돈다(로컬에서 초기값 만들 때).

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { REPO, summarize, readAllReleases } from './metrics-data.mjs';

const OUT = process.argv[2] || 'stats.json';
const PAGE = process.argv[3] || 'index.html';
const TOKEN = process.env.GITHUB_TOKEN || '';

const headers = {
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'vibisual-site-stats',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

async function api(path, { allowNotFound = false } = {}) {
  const r = await fetch(`https://api.github.com${path}`, { headers });
  if (allowNotFound && r.status === 404) return null;
  if (!r.ok) throw new Error(`${path} → ${r.status} ${r.statusText}`);
  return r.json();
}

// Read and validate every public release before changing any published file.
const collectionStartedAt = new Date().toISOString();
const repo = await api(`/repos/${REPO}`);
const releases = await readAllReleases(api);
const latest = await api(`/repos/${REPO}/releases/latest`, { allowNotFound: true });
const observed = summarize(repo, releases, latest?.id ?? null);
const dataSha256 = createHash('sha256').update(JSON.stringify(observed)).digest('hex');
const now = new Date().toISOString();
let previous = null;
try { previous = JSON.parse(readFileSync(OUT, 'utf8')); } catch { /* first recording */ }

// Record on a data change or once per UTC day. asOf is the recorded observation,
// not an assertion that an old number was checked just now. Git retains history.
let asOf = now;
let snapshot;
let evidenceSha256;
const previousPath = typeof previous?.snapshot === 'string'
  && /^\/metrics\/snapshots\/[0-9TZ.-]+\.json$/.test(previous.snapshot)
  ? join(dirname(OUT), previous.snapshot.slice(1)) : null;
if (previous?.schemaVersion === 2 && previous.dataSha256 === dataSha256
    && previous.asOf?.slice(0, 10) === now.slice(0, 10)
    && previousPath && existsSync(previousPath)
    && createHash('sha256').update(readFileSync(previousPath)).digest('hex') === previous.evidenceSha256) {
  ({ asOf, snapshot, evidenceSha256 } = previous);
} else {
  const evidence = JSON.stringify({ ...observed, collectionStartedAt, asOf }, null, 2) + '\n';
  evidenceSha256 = createHash('sha256').update(evidence).digest('hex');
  snapshot = `/metrics/snapshots/${asOf.replaceAll(':', '-')}.json`;
  const evidencePath = join(dirname(OUT), snapshot.slice(1));
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, evidence, { flag: 'wx' });
}
const stats = {
  schemaVersion: 2,
  methodology: observed.methodology,
  stars: observed.stars,
  installerDownloads: observed.installerDownloads,
  allAssetDownloads: observed.allAssetDownloads,
  verifiedInstallations: null,
  activeUsers: null,
  asOf,
  source: observed.source,
  methodologyUrl: '/metrics/',
  snapshot,
  evidenceSha256,
  dataSha256,
  release: observed.release,
};

// index.html 안의 폴백도 같은 값으로 맞춘다.
//
// 왜: 그 폴백은 stats.json 을 못 받았을 때만 쓰이지만, 아무도 안 고치면 릴리스마다 낡는다.
// 실제로 v0.1.17 을 냈는데 페이지에는 v0.1.16 이 박혀 있었다. 한 스크립트가 둘 다 맞춰야
// '두 곳이 따로 낡는' 일이 없다. 정규식을 쓰지 않는다 — 앵커 문자열로만 자른다.
function syncPage(s) {
  const tag = stats.release.tag;
  if (!tag) return { text: s, hits: 0 };
  let hits = 0;

  // ① `this.state.relVer || 'v0.1.16'` 의 따옴표 안쪽만 갈아 끼운다(헤더 배지 · 버전 숫자).
  const MARK = "this.state.relVer || '";
  for (let i = s.indexOf(MARK); i >= 0; i = s.indexOf(MARK, i + MARK.length + tag.length)) {
    const a = i + MARK.length;
    const b = s.indexOf("'", a);
    if (b < 0) break;
    if (s.slice(a, b) !== tag) hits++;
    s = s.slice(0, a) + tag + s.slice(b);
  }

  // ② DL_FALLBACK — 주석 한 줄까지 통째로 다시 쓴다.
  const HEAD = '// 조회가 실패했을 때만 쓰는 이름';
  const a = s.indexOf(HEAD);
  if (a >= 0) {
    const b = s.indexOf('};', a);
    if (b > a) {
      const q = (list) => '[' + list.map((n) => "'" + n + "'").join(', ') + ']';
      const block = HEAD + ' — ' + tag + ' 이 실제로 발행한 자산과 같다.\n'
        + '// (이 블록은 .github/scripts/build-stats.mjs 가 릴리스마다 다시 쓴다 — 손으로 고치지 마라.)\n'
        + 'const DL_FALLBACK = {\n'
        + '  win: ' + q(stats.release.win) + ',\n'
        + '  mac: ' + q(stats.release.mac) + ',\n'
        + '  linux: ' + q(stats.release.linux) + ',\n';
      if (s.slice(a, b) !== block) hits++;
      s = s.slice(0, a) + block + s.slice(b);
    }
  }

  // ③ 구조화 데이터(JSON-LD)의 `softwareVersion`.
  //
  // 왜 여기까지: 이 값은 화면에 안 보이지만 **검색엔진이 읽는다**(schema.org
  // SoftwareApplication). 눈에 안 보이니 아무도 안 고쳐서 ①②를 맞춘 뒤에도 혼자 낡는다 —
  // v0.1.20 을 냈는데 여기만 0.1.19 로 남아 있었다. 태그에서 `v` 를 뗀 형태를 쓴다.
  const VMARK = '"softwareVersion":"';
  for (let i = s.indexOf(VMARK); i >= 0; i = s.indexOf(VMARK, i + VMARK.length)) {
    const a2 = i + VMARK.length;
    const b2 = s.indexOf('"', a2);
    if (b2 < 0) break;
    const bare = tag.replace(/^v/, '');
    if (s.slice(a2, b2) !== bare) hits++;
    s = s.slice(0, a2) + bare + s.slice(b2);
  }

  return { text: s, hits };
}

let pageChanged = false;
if (existsSync(PAGE)) {
  const before = readFileSync(PAGE, 'utf8');
  const { text } = syncPage(before);
  if (text !== before) { writeFileSync(PAGE, text); pageChanged = true; }
}

// Same data within the same UTC day reuses the timestamped evidence.
const next = JSON.stringify(stats, null, 2) + '\n';
const prev = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
const jsonChanged = prev !== next;
if (jsonChanged) writeFileSync(OUT, next);

const what = [jsonChanged ? OUT : null, pageChanged ? PAGE : null].filter(Boolean).join(' + ');
console.log(
  `${what || 'unchanged'} · stars=${stats.stars} installerDownloads=${stats.installerDownloads}`
  + ` recorded=${stats.asOf} tag=${stats.release.tag}`,
);
