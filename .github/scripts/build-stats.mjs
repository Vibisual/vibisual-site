// stats.json 을 짓는다 — 스타 수 · 누적 설치 수 · 최신 릴리스 자산 목록.
//
// 왜 이걸 여기서 짓나: 이 숫자를 브라우저가 직접 GitHub 에 물으면 안 되기 때문이다.
// GitHub 공개 API 는 키 없이 쓰면 **방문자 IP 당 시간 60회**다. 사이트 전체가 아니라
// 보는 사람마다 따로 세는 한도라, 새로고침을 몇십 번 하거나 이동통신망처럼 여러 사람이
// 한 IP 를 나눠 쓰면 금세 비고 그때부터 숫자 칸이 '—' 로 죽는다.
// 그래서 조회는 **여기(GitHub Actions, 인증 조회라 저장소당 시간 1,000회)** 에서만 하고,
// 방문자는 같은 도메인의 stats.json 한 장만 읽는다 — 방문자가 쓰는 GitHub 한도는 0 이다.
//
// 실행: node .github/scripts/build-stats.mjs [출력경로]
//   GITHUB_TOKEN 이 있으면 인증 조회(권장), 없으면 무인증으로도 돈다(로컬에서 초기값 만들 때).

import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const REPO = 'Vibisual/vibisual';                 // 앱 저장소(이 사이트 저장소가 아니다)
const OUT = process.argv[2] || 'stats.json';
const TOKEN = process.env.GITHUB_TOKEN || '';

const headers = {
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'vibisual-site-stats',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
};

async function api(path) {
  const r = await fetch(`https://api.github.com${path}`, { headers });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${r.statusText}`);
  return r.json();
}

// 사람이 받아서 설치하는 파일만 센다.
//   · exe / dmg / AppImage / deb / rpm  → 설치본 (리눅스는 셋 다 낸다)
//   · latest*.yml                       → 설치된 앱이 켜질 때마다 조회하는 업데이트 메타. 사람 수가 아니다
//   · *.blockmap                        → 델타 업데이트 조각
//   · *-mac.zip                         → macOS 업데이트 페이로드(사람이 받는 것은 dmg 다)
const isInstaller = (name) => {
  const s = String(name).toLowerCase();
  return s.endsWith('.exe') || s.endsWith('.dmg') || s.endsWith('.appimage')
    || s.endsWith('.deb') || s.endsWith('.rpm');
};

const repo = await api(`/repos/${REPO}`);
const releases = await api(`/repos/${REPO}/releases?per_page=100`);

let installs = 0;
for (const rel of releases) {
  for (const a of rel.assets || []) {
    if (isInstaller(a.name)) installs += a.download_count || 0;
  }
}

// 목록은 최신순이다 — 초안·프리릴리스를 건너뛴 첫 항목이 releases/latest 와 같은 것이다.
const top = releases.filter((r) => !r.draft && !r.prerelease)[0];
const names = top ? (top.assets || []).map((a) => a.name) : [];
const arm = (n) => (n.indexOf('arm64') >= 0 ? 1 : 0);

const stats = {
  stars: repo.stargazers_count,
  installs,
  release: {
    tag: top ? top.tag_name : null,
    win: names.filter((n) => n.slice(-10) === '-setup.exe'),
    mac: names.filter((n) => n.slice(-4) === '.dmg').sort((a, b) => arm(b) - arm(a)),
    linux: names.filter((n) => n.slice(-9) === '.AppImage' || n.slice(-4) === '.deb' || n.slice(-4) === '.rpm'),
  },
};

// 시각 같은 것은 넣지 않는다 — 매번 달라지면 값이 그대로인 시간에도 커밋이 쌓인다.
const next = JSON.stringify(stats, null, 2) + '\n';
const prev = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
if (prev === next) {
  console.log(`unchanged · stars=${stats.stars} installs=${stats.installs} tag=${stats.release.tag}`);
  process.exit(0);
}
writeFileSync(OUT, next);
console.log(`written ${OUT} · stars=${stats.stars} installs=${stats.installs} tag=${stats.release.tag}`);
