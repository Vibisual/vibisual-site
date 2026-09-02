// 검색 노출용 정적 산출물 생성기.
//
// 정본은 index.html 하나다. 이 스크립트는 그것을 읽어
//   · 화면마다 **실제 주소를 가진 파일**            (blog/ · docs/ 이하)
//   · JS 를 돌리지 않는 크롤러도 읽을 수 있는 본문  (#vb-seo 프리렌더 블록)
//   · 화면마다 다른 <title> · 설명 · canonical · OG · hreflang · JSON-LD
//   · robots.txt · sitemap.xml
// 을 만든다.
//
// 왜 필요한가: 이 사이트의 본문은 전부 {{ }} 템플릿이라 JS 실행 전에는 글자가 하나도 없고,
// Blog·Docs 는 주소가 아니라 상태(setView)라서 색인될 수 있는 페이지가 통틀어 하나뿐이었다.
// 즉 검색엔진이 볼 수 있는 것이 "빈 페이지 한 장"이었다.
//
// 실행: node build-seo.mjs        (html/ 안에서)
//
// 여러 번 돌려도 결과가 같다 — 주입한 자리를 표식(<!-- vb:seo:* -->)으로 찾아 갈아끼우고,
// 표식이 없으면 예전 태그를 걷어내고 새로 만든다. 그래서 dc 편집 도구가 index.html 을
// 다시 써서 주입분이 사라져도 이 스크립트를 한 번 돌리면 원상복구된다.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ORIGIN = 'https://vibisual.pro';
const REPO = 'https://github.com/Vibisual/vibisual';
const OG = ORIGIN + '/og.png';
const SRC = join(ROOT, 'index.html');

// ─────────────────────────────────────────────────────────────────────────────
// 1. index.html 안의 데이터 리터럴을 그대로 읽어 온다
//
// 문구를 여기에 복사해 두면 반드시 어긋난다(사이트를 고쳐도 검색 결과는 옛날 문장을
// 들고 있게 된다). 그래서 T · BLOG · DOCS · LANGS 를 소스에서 직접 떼어 평가한다.
// ─────────────────────────────────────────────────────────────────────────────

const source = readFileSync(SRC, 'utf8');

/** 문자열 리터럴 하나를 건너뛴다(이스케이프 포함). 닫는 따옴표 위치를 돌려준다. */
function skipString(s, i) {
  const q = s[i];
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue; }
    if (s[j] === q) return j;
  }
  throw new Error('닫히지 않은 문자열 (' + i + ')');
}

/** `const NAME = { … }` / `[ … ]` 의 리터럴 본문만 잘라 낸다. 문자열·주석 안의 괄호는 세지 않는다. */
function literalOf(s, name) {
  const head = '\nconst ' + name + ' = ';
  const at = s.indexOf(head);
  if (at < 0) throw new Error(name + ' 선언을 찾지 못했다');
  const start = at + head.length;
  const open = s[start];
  if (open !== '{' && open !== '[') throw new Error(name + ' 이 객체/배열 리터럴이 아니다');
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let j = start; j < s.length; j++) {
    const c = s[j];
    if (c === '"' || c === "'" || c === '`') { j = skipString(s, j); continue; }
    if (c === '/' && s[j + 1] === '/') { const n = s.indexOf('\n', j); if (n < 0) break; j = n; continue; }
    if (c === '/' && s[j + 1] === '*') { const n = s.indexOf('*/', j); if (n < 0) break; j = n + 1; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return s.slice(start, j + 1);
  }
  throw new Error(name + ' 리터럴의 끝을 찾지 못했다');
}

const evalLit = (name) => new Function('return (' + literalOf(source, name) + ')')();

const LANGS = evalLit('LANGS');
const T = evalLit('T');
const BLOG = evalLit('BLOG');
const DOCS = evalLit('DOCS');
const HTML_LANG = evalLit('HTML_LANG');

// 릴리스 번호는 stats.yml 이 10분마다 맞춰 두는 stats.json 에서 읽는다 — 여기에 적어 두지 않는다.
let VERSION = '';
try { VERSION = String(JSON.parse(readFileSync(join(ROOT, 'stats.json'), 'utf8')).release.tag || '').replace(/^v/, ''); } catch { }

// 본문(글·문서)이 실제로 존재하는 로케일. UI 문구는 12개 로케일이 다 있지만
// 블로그·문서 본문은 en·ko 둘뿐이라, 그 두 화면의 hreflang 은 있는 것만 신고한다.
const CONTENT_LANGS = Object.keys(BLOG).filter((l) => DOCS[l]);
const UI_LANGS = LANGS.map(([code]) => code);

// ─────────────────────────────────────────────────────────────────────────────
// 2. 화면 목록 — 여기 있는 것이 곧 색인 대상 주소다
// ─────────────────────────────────────────────────────────────────────────────

const posts = BLOG.en;
const docs = DOCS.en;
const docOverview = docs.find((d) => d.id === 'overview') || docs[0];

const today = new Date().toISOString().slice(0, 10);

const routes = [
  { path: '/', kind: 'home', view: 'home', lastmod: today, priority: '1.0', langs: UI_LANGS },
  { path: '/blog/', kind: 'bloglist', view: 'blog', lastmod: posts.map((p) => p.date).sort().pop(), priority: '0.7', langs: CONTENT_LANGS },
  ...posts.map((p) => ({
    path: '/blog/' + p.id + '/', kind: 'post', view: 'blog', post: p,
    lastmod: p.date, priority: '0.6', langs: CONTENT_LANGS,
  })),
  { path: '/docs/', kind: 'doc', view: 'docs', doc: docOverview, lastmod: docOverview.updated, priority: '0.8', langs: CONTENT_LANGS },
  ...docs.filter((d) => d.id !== docOverview.id).map((d) => ({
    path: '/docs/' + d.id + '/', kind: 'doc', view: 'docs', doc: d,
    lastmod: d.updated, priority: '0.6', langs: CONTENT_LANGS,
  })),
];

// ─────────────────────────────────────────────────────────────────────────────
// 3. 조각 만들기
// ─────────────────────────────────────────────────────────────────────────────

const esc = (v) => String(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** 설명문은 검색 결과에서 잘리므로 문장 경계에서 접는다. */
const clip = (v, n = 300) => {
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('。'), cut.lastIndexOf('다. '));
  return (stop > n * 0.5 ? cut.slice(0, stop + 1) : cut.trimEnd() + '…');
};

const abs = (p, lang) => ORIGIN + p + (lang && lang !== 'en' ? '?lang=' + lang : '');

function metaOf(r) {
  if (r.kind === 'home') {
    const t = T.en;
    // index.html 의 headFor() 와 **같은 규칙**이다. 크롤러가 보는 <head> 의 제목과
    // JS 가 렌더한 뒤의 제목이 다르면 뒤엣것이 이긴다 — 그래서 둘을 어긋나게 두면 안 된다.
    return {
      title: 'Vibisual — ' + (t.h1a + ' ' + t.h1em).replace(/[.。।]\s*$/, '') + ' · ' + t.eyebrow,
      desc: clip(t.sub),
      ogType: 'website',
    };
  }
  if (r.kind === 'bloglist') {
    return {
      title: 'Blog — Vibisual',
      desc: clip('Essays, release notes and guides from Vibisual, the agent visual desktop for Claude Code. ' +
        posts.map((p) => p.title).join(' · ')),
      ogType: 'website',
    };
  }
  if (r.kind === 'post') {
    return { title: r.post.title + ' — Vibisual', desc: clip(r.post.excerpt), ogType: 'article' };
  }
  return { title: r.doc.title + ' — Vibisual docs', desc: clip(r.doc.lead), ogType: 'article' };
}

/** 구조화 데이터. 앱을 "앱"으로 등록하는 자리가 SoftwareApplication 이다. */
function jsonLd(r) {
  const publisher = {
    '@type': 'Organization', '@id': ORIGIN + '/#org', name: 'Vibisual',
    url: ORIGIN, logo: ORIGIN + '/favicon.svg', sameAs: [REPO],
  };
  const site = {
    '@type': 'WebSite', '@id': ORIGIN + '/#website', name: 'Vibisual',
    url: ORIGIN, inLanguage: 'en', publisher: { '@id': ORIGIN + '/#org' },
  };
  const m = metaOf(r);

  if (r.kind === 'home') {
    return [publisher, site, {
      '@type': 'SoftwareApplication',
      '@id': ORIGIN + '/#app',
      name: 'Vibisual',
      alternateName: 'Vibisual — Visual Development Environment for Claude Code',
      applicationCategory: 'DeveloperApplication',
      applicationSubCategory: 'IDE',
      operatingSystem: 'Windows 10, Windows 11, macOS, Linux',
      description: clip(T.en.sub, 500),
      url: ORIGIN,
      downloadUrl: REPO + '/releases/latest',
      installUrl: REPO + '/releases/latest',
      softwareVersion: VERSION || undefined,
      license: 'https://www.apache.org/licenses/LICENSE-2.0',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
      author: { '@id': ORIGIN + '/#org' },
      publisher: { '@id': ORIGIN + '/#org' },
      screenshot: OG,
      softwareRequirements: 'Claude CLI on PATH',
      featureList: [T.en.f1t, T.en.f2t, T.en.f3t],
    }];
  }

  const crumbs = {
    '@type': 'BreadcrumbList',
    itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: ORIGIN + '/' }].concat(
      r.kind === 'bloglist' ? [{ '@type': 'ListItem', position: 2, name: 'Blog', item: ORIGIN + '/blog/' }]
        : r.kind === 'post' ? [
          { '@type': 'ListItem', position: 2, name: 'Blog', item: ORIGIN + '/blog/' },
          { '@type': 'ListItem', position: 3, name: r.post.title, item: ORIGIN + r.path },
        ] : [
          { '@type': 'ListItem', position: 2, name: 'Docs', item: ORIGIN + '/docs/' },
        ].concat(r.path === '/docs/' ? [] : [{ '@type': 'ListItem', position: 3, name: r.doc.title, item: ORIGIN + r.path }])
    ),
  };

  if (r.kind === 'bloglist') {
    return [publisher, site, crumbs, {
      '@type': 'Blog', '@id': ORIGIN + '/blog/#blog', name: 'Vibisual Blog',
      url: ORIGIN + '/blog/', description: m.desc, inLanguage: 'en',
      publisher: { '@id': ORIGIN + '/#org' },
      blogPost: posts.map((p) => ({
        '@type': 'BlogPosting', headline: p.title, url: ORIGIN + '/blog/' + p.id + '/',
        datePublished: p.date, description: clip(p.excerpt),
        author: { '@type': 'Organization', name: p.author },
      })),
    }];
  }

  if (r.kind === 'post') {
    const p = r.post;
    return [publisher, site, crumbs, {
      '@type': 'BlogPosting',
      '@id': ORIGIN + r.path + '#post',
      headline: p.title,
      description: clip(p.excerpt),
      articleSection: p.tag,
      datePublished: p.date,
      dateModified: p.date,
      inLanguage: 'en',
      wordCount: p.body.join(' ').split(/\s+/).length,
      author: { '@type': 'Organization', name: p.author, url: ORIGIN },
      publisher: { '@id': ORIGIN + '/#org' },
      image: OG,
      isPartOf: { '@id': ORIGIN + '/blog/#blog' },
      mainEntityOfPage: { '@type': 'WebPage', '@id': ORIGIN + r.path },
    }];
  }

  const d = r.doc;
  return [publisher, site, crumbs, {
    '@type': 'TechArticle',
    '@id': ORIGIN + r.path + '#doc',
    headline: d.title,
    description: clip(d.lead),
    dateModified: d.updated,
    inLanguage: 'en',
    about: { '@id': ORIGIN + '/#app' },
    author: { '@id': ORIGIN + '/#org' },
    publisher: { '@id': ORIGIN + '/#org' },
    mainEntityOfPage: { '@type': 'WebPage', '@id': ORIGIN + r.path },
  }];
}

function headBlock(r) {
  const m = metaOf(r);
  const L = [];
  L.push('<title>' + esc(m.title) + '</title>');
  L.push('<meta name="description" content="' + esc(m.desc) + '" />');
  L.push('<link rel="canonical" href="' + abs(r.path) + '" />');
  // 로케일 대안. 본문이 없는 언어까지 신고하면 없는 페이지를 있다고 말하는 셈이라 넣지 않는다.
  for (const code of r.langs) {
    L.push('<link rel="alternate" hreflang="' + esc(HTML_LANG[code] || code) + '" href="' + abs(r.path, code) + '" />');
  }
  L.push('<link rel="alternate" hreflang="x-default" href="' + abs(r.path) + '" />');
  L.push('<meta property="og:type" content="' + m.ogType + '" />');
  L.push('<meta property="og:site_name" content="Vibisual" />');
  L.push('<meta property="og:locale" content="en_US" />');
  L.push('<meta property="og:url" content="' + abs(r.path) + '" />');
  L.push('<meta property="og:title" content="' + esc(m.title) + '" />');
  L.push('<meta property="og:description" content="' + esc(m.desc) + '" />');
  L.push('<meta property="og:image" content="' + OG + '" />');
  L.push('<meta property="og:image:width" content="1200" />');
  L.push('<meta property="og:image:height" content="630" />');
  if (r.kind === 'post') {
    L.push('<meta property="article:published_time" content="' + r.post.date + '" />');
    L.push('<meta property="article:section" content="' + esc(r.post.tag) + '" />');
  }
  L.push('<meta name="twitter:card" content="summary_large_image" />');
  L.push('<meta name="twitter:title" content="' + esc(m.title) + '" />');
  L.push('<meta name="twitter:description" content="' + esc(m.desc) + '" />');
  L.push('<meta name="twitter:image" content="' + OG + '" />');
  L.push('<script type="application/ld+json">' +
    JSON.stringify({ '@context': 'https://schema.org', '@graph': jsonLd(r) })
      .replace(/</g, '\\u003c') + '</script>');
  // 이 파일이 어느 화면인지 앱에게 알려 준다 — 앱은 이 값으로 첫 화면을 정한다.
  L.push('<script>window.__VB_ROUTE__=' + JSON.stringify({
    view: r.view,
    post: r.kind === 'post' ? r.post.id : null,
    doc: r.kind === 'doc' ? r.doc.id : null,
  }) + ';</script>');
  return L.join('\n');
}

// ─── 프리렌더 본문 ──────────────────────────────────────────────────────────
// JS 가 아직(또는 영영) 돌지 않는 동안 보이는 진짜 글자다. 화면에 렌더될 내용과 같은
// 문장을 쓴다 — 크롤러에게만 다른 것을 보여주면 그것은 클로킹이고, 실제로 벌을 받는다.
// 앱이 뜨는 순간 componentDidMount 가 이 블록을 지운다.

// style 속성은 큰따옴표로 감싸 나가므로 이 안의 글꼴 이름은 **작은따옴표**여야 한다.
// 큰따옴표를 쓰면 거기서 속성이 끊겨 태그가 깨진다 — 앱이 뜬 화면에서는 이 블록이 지워져
// 눈에 띄지 않고, 정작 이 블록이 전부인 크롤러 쪽에서만 깨진다.
const S = {
  wrap: "margin:0 auto;max-width:840px;padding:64px 22px 80px;font-family:Geist,'IBM Plex Sans KR',Helvetica,sans-serif;color:oklch(0.9 0.008 250);line-height:1.65",
  eyebrow: 'margin:0 0 14px;font-size:12px;letter-spacing:0.09em;text-transform:uppercase;color:oklch(0.78 0.13 195)',
  h1: 'margin:0 0 18px;font-size:42px;line-height:1.08;letter-spacing:-0.03em;color:oklch(0.97 0.005 250)',
  h2: 'margin:38px 0 12px;font-size:24px;line-height:1.2;letter-spacing:-0.02em;color:oklch(0.95 0.005 250)',
  h3: 'margin:26px 0 10px;font-size:18px;color:oklch(0.93 0.005 250)',
  p: 'margin:0 0 16px;font-size:16px;color:oklch(0.86 0.008 250)',
  lead: 'margin:0 0 26px;font-size:19px;color:oklch(0.88 0.008 250)',
  meta: 'margin:0 0 26px;font-size:13px;color:oklch(0.68 0.01 250)',
  nav: 'margin:0 0 34px;font-size:14px;display:flex;flex-wrap:wrap;gap:8px 18px',
  a: 'color:oklch(0.78 0.13 195);text-decoration:none',
  pre: "margin:0 0 16px;padding:14px 16px;border:1px solid oklch(0.26 0.012 250);border-radius:10px;overflow-x:auto;font-family:'Geist Mono',ui-monospace,monospace;font-size:13px;color:oklch(0.84 0.01 250)",
  note: 'margin:0 0 16px;padding:12px 16px;border-left:2px solid oklch(0.46 0.07 205);font-size:15px;color:oklch(0.82 0.01 250)',
  table: 'margin:0 0 16px;border-collapse:collapse;font-size:14px;width:100%',
  td: 'padding:7px 12px 7px 0;border-bottom:1px solid oklch(0.24 0.012 250);vertical-align:top;color:oklch(0.84 0.01 250)',
};

// 위 규칙을 사람이 기억하는 대신 여기서 막는다 — 한 번 어기면 크롤러가 보는 유일한 본문이 깨진다.
for (const [k, v] of Object.entries(S)) {
  if (v.includes('"')) throw new Error('S.' + k + ' 안에 큰따옴표가 있다 — style 속성이 거기서 끊긴다. 작은따옴표로 바꿔라.');
}

const link = (href, text) => '<a href="' + href + '" style="' + S.a + '">' + esc(text) + '</a>';
const para = (v) => '<p style="' + S.p + '">' + esc(v) + '</p>';

/** 모든 화면 위에 같은 길잡이를 둔다 — JS 없이도 사이트 전체를 걸어 다닐 수 있어야 한다. */
function crawlNav(here) {
  const items = [
    ['/', 'Home'], ['/blog/', 'Blog'], ['/docs/', 'Docs'],
    ...docs.filter((d) => d.id !== docOverview.id).map((d) => ['/docs/' + d.id + '/', d.title]),
    ...posts.map((p) => ['/blog/' + p.id + '/', p.title]),
  ].filter(([h]) => h !== here);
  return '<nav style="' + S.nav + '">' + items.map(([h, t]) => link(h, t)).join('') + '</nav>';
}

function preHome() {
  const t = T.en;
  const out = [];
  out.push('<p style="' + S.eyebrow + '">' + esc(t.eyebrow) + '</p>');
  out.push('<h1 style="' + S.h1 + '">' + esc(t.h1a + ' ' + t.h1em) + '</h1>');
  out.push('<p style="' + S.lead + '">' + esc(t.sub) + '</p>');
  out.push('<p style="' + S.meta + '">' + esc(t.heroMeta) + '</p>');
  out.push(crawlNav('/'));
  out.push('<p style="' + S.p + '">' + link(REPO + '/releases/latest', t.ctaDl) + ' · ' +
    link(REPO, t.ctaStar) + ' · ' + link('https://youtu.be/asJ_Z-75uqc', t.ctaWatch) + '</p>');
  out.push('<h2 style="' + S.h2 + '">' + esc(t.whatTitle) + '</h2>');
  for (const [ht, hb] of [[t.f1t, t.f1b], [t.f2t, t.f2b], [t.f3t, t.f3b]]) {
    out.push('<h3 style="' + S.h3 + '">' + esc(ht) + '</h3>');
    out.push(para(hb));
  }
  out.push('<h2 style="' + S.h2 + '">' + esc(t.instTitle) + '</h2>');
  out.push(para(t.instLead));
  out.push('<h3 style="' + S.h3 + '">' + esc(t.instWin) + '</h3>');
  out.push(para(t.instWinBody));
  out.push('<h3 style="' + S.h3 + '">' + esc(t.instSrc) + '</h3>');
  out.push(para(t.instSrcBody));
  out.push('<h2 style="' + S.h2 + '">' + esc(t.statusLabel) + '</h2>');
  out.push(para(t.statusBody));
  out.push('<h2 style="' + S.h2 + '">' + esc(t.secLabel) + '</h2>');
  out.push(para(t.secBody));
  out.push('<p style="' + S.meta + '">' + esc(t.footNote) + '</p>');
  return out.join('\n');
}

function preBlogList() {
  const out = [];
  out.push('<h1 style="' + S.h1 + '">Blog</h1>');
  out.push('<p style="' + S.lead + '">Essays, release notes and guides from Vibisual — the agent visual desktop for Claude Code.</p>');
  out.push(crawlNav('/blog/'));
  for (const p of posts) {
    out.push('<h2 style="' + S.h2 + '">' + link('/blog/' + p.id + '/', p.title) + '</h2>');
    out.push('<p style="' + S.meta + '">' + esc(p.date + ' · ' + p.tag + ' · ' + p.read + ' · ' + p.author) + '</p>');
    out.push(para(p.excerpt));
  }
  return out.join('\n');
}

function prePost(p) {
  const out = [];
  out.push('<p style="' + S.eyebrow + '">' + esc(p.tag) + '</p>');
  out.push('<h1 style="' + S.h1 + '">' + esc(p.title) + '</h1>');
  out.push('<p style="' + S.meta + '">' + esc(p.date + ' · ' + p.read + ' · ' + p.author) + '</p>');
  out.push(crawlNav('/blog/' + p.id + '/'));
  out.push('<p style="' + S.lead + '">' + esc(p.excerpt) + '</p>');
  for (const v of p.body) out.push(para(v));
  return out.join('\n');
}

function preDoc(d) {
  const out = [];
  out.push('<p style="' + S.eyebrow + '">' + esc(d.g) + '</p>');
  out.push('<h1 style="' + S.h1 + '">' + esc(d.title) + '</h1>');
  out.push('<p style="' + S.lead + '">' + esc(d.lead) + '</p>');
  out.push('<p style="' + S.meta + '">Updated ' + esc(d.updated) + '</p>');
  out.push(crawlNav(d.id === docOverview.id ? '/docs/' : '/docs/' + d.id + '/'));
  for (const s of d.sections || []) {
    out.push('<h2 style="' + S.h2 + '">' + esc(s.h) + '</h2>');
    for (const v of s.paras || []) out.push(para(v));
    if (s.code && s.code.length) {
      out.push('<pre style="' + S.pre + '">' + s.code.map(esc).join('\n') + '</pre>');
    }
    if (s.rows && s.rows.length) {
      out.push('<table style="' + S.table + '"><tbody>' + s.rows.map(
        ([k, v]) => '<tr><td style="' + S.td + '"><strong>' + esc(k) + '</strong></td><td style="' + S.td + '">' + esc(v) + '</td></tr>'
      ).join('') + '</tbody></table>');
    }
    if (s.note) out.push('<p style="' + S.note + '">' + esc(s.note) + '</p>');
  }
  return out.join('\n');
}

function bodyBlock(r) {
  const inner = r.kind === 'home' ? preHome()
    : r.kind === 'bloglist' ? preBlogList()
      : r.kind === 'post' ? prePost(r.post)
        : preDoc(r.doc);
  return '<div id="vb-seo" style="' + S.wrap + '">\n' + inner + '\n</div>';
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. 바탕 문서 만들기 — 표식이 없으면 예전 태그를 걷어내고 표식을 심는다
// ─────────────────────────────────────────────────────────────────────────────

const HEAD_A = '<!-- vb:seo:head:start · build-seo.mjs 가 갈아끼운다. 손으로 고치지 마라 -->';
const HEAD_B = '<!-- vb:seo:head:end -->';
const BODY_A = '<!-- vb:seo:body:start · JS 없이도 읽히는 본문. build-seo.mjs 가 갈아끼운다 -->';
const BODY_B = '<!-- vb:seo:body:end -->';

function makeBase(html) {
  let s = html;

  // 하위 폴더(/blog/…)에서도 같은 파일이 돌아야 하므로 자산 경로는 루트 기준으로 둔다.
  // (vibisual.github.io/vibisual-site/ 는 커스텀 도메인으로 301 이라 이 경로만 있으면 된다.)
  s = s.replace(/(["'(])\.\/(favicon\.svg|fonts\/fonts\.css|support\.js|stats\.json|og\.png)/g, '$1/$2');

  // 이미 심어 둔 블록은 통째로 걷어낸다.
  s = s.replace(new RegExp(escRe(HEAD_A) + '[\\s\\S]*?' + escRe(HEAD_B) + '\\n?'), '');
  s = s.replace(new RegExp(escRe(BODY_A) + '[\\s\\S]*?' + escRe(BODY_B) + '\\n?'), '');

  // 표식이 없던 시절의 태그도 걷어낸다(<head> 안에서만).
  const headEnd = s.indexOf('</head>');
  if (headEnd < 0) throw new Error('</head> 를 찾지 못했다');
  let head = s.slice(0, headEnd);
  const tail = s.slice(headEnd);
  head = head
    .replace(/^[ \t]*<title>[\s\S]*?<\/title>\n?/m, '')
    .replace(/^[ \t]*<meta\s+name="description"[^>]*>\n?/gm, '')
    .replace(/^[ \t]*<link\s+rel="canonical"[^>]*>\n?/gm, '')
    .replace(/^[ \t]*<link\s+rel="alternate"\s+hreflang[^>]*>\n?/gm, '')
    .replace(/^[ \t]*<meta\s+property="(og|article):[^"]*"[^>]*>\n?/gm, '')
    .replace(/^[ \t]*<meta\s+name="twitter:[^"]*"[^>]*>\n?/gm, '')
    .replace(/^[ \t]*<script\s+type="application\/ld\+json">[\s\S]*?<\/script>\n?/gm, '')
    .replace(/^[ \t]*<script>window\.__VB_ROUTE__[\s\S]*?<\/script>\n?/gm, '');
  s = head + tail;

  // 표식을 제자리에 심는다.
  s = s.replace('</head>', HEAD_A + '\n' + HEAD_B + '\n</head>');
  const bodyAt = s.indexOf('<body>');
  if (bodyAt < 0) throw new Error('<body> 를 찾지 못했다');
  s = s.slice(0, bodyAt + '<body>'.length) + '\n' + BODY_A + '\n' + BODY_B +
    s.slice(bodyAt + '<body>'.length);
  return s;
}

const escRe = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const base = makeBase(source);

function render(r) {
  return base
    .replace(HEAD_A + '\n' + HEAD_B, HEAD_A + '\n' + headBlock(r) + '\n' + HEAD_B)
    .replace(BODY_A + '\n' + BODY_B, BODY_A + '\n' + bodyBlock(r) + '\n' + BODY_B);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. 쓰기
// ─────────────────────────────────────────────────────────────────────────────

const written = [];
function put(rel, text) {
  const full = join(ROOT, rel);
  mkdirSync(dirname(full), { recursive: true });
  const before = existsSync(full) ? readFileSync(full, 'utf8') : null;
  if (before !== text) writeFileSync(full, text);
  written.push([rel, text.length, before === text ? '그대로' : before === null ? '새로' : '갱신']);
}

for (const r of routes) {
  put(r.path === '/' ? 'index.html' : r.path.replace(/^\//, '') + 'index.html', render(r));
}

put('robots.txt', [
  '# 이 파일이 없으면 크롤러는 사이트맵을 스스로 찾지 못한다.',
  'User-agent: *',
  'Allow: /',
  '',
  '# 편집 도구가 남긴 캐시라 페이지가 참조하지 않는다.',
  'Disallow: /uploads/',
  '',
  'Sitemap: ' + ORIGIN + '/sitemap.xml',
  '',
].join('\n'));

put('sitemap.xml', [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
  '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ...routes.map((r) => [
    '  <url>',
    '    <loc>' + abs(r.path) + '</loc>',
    '    <lastmod>' + r.lastmod + '</lastmod>',
    '    <changefreq>' + (r.kind === 'home' ? 'weekly' : 'monthly') + '</changefreq>',
    '    <priority>' + r.priority + '</priority>',
    ...r.langs.map((code) =>
      '    <xhtml:link rel="alternate" hreflang="' + (HTML_LANG[code] || code) + '" href="' + abs(r.path, code) + '"/>'),
    '    <xhtml:link rel="alternate" hreflang="x-default" href="' + abs(r.path) + '"/>',
    '  </url>',
  ].join('\n')),
  '</urlset>',
  '',
].join('\n'));

// 이름이 바뀐 글·문서의 옛 폴더는 남겨 두면 404 대신 낡은 내용을 계속 내보낸다.
const keep = new Set(routes.map((r) => r.path));
for (const [dir, prefix] of [['blog', '/blog/'], ['docs', '/docs/']]) {
  const full = join(ROOT, dir);
  if (!existsSync(full)) continue;
  for (const name of readdirSyncSafe(full)) {
    if (name === 'index.html') continue;
    if (!keep.has(prefix + name + '/')) {
      rmSync(join(full, name), { recursive: true, force: true });
      written.push([dir + '/' + name, 0, '지움']);
    }
  }
}
function readdirSyncSafe(p) {
  try { return readdirSync(p); } catch { return []; }
}

const changed = written.filter((w) => w[2] !== '그대로');
console.log('경로 ' + routes.length + '개 · 파일 ' + written.length + '개 (' + changed.length + '개 바뀜)');
for (const [rel, size, how] of written) {
  console.log('  ' + how.padEnd(4) + ' ' + rel.padEnd(30) + (size ? (size / 1024).toFixed(0) + 'KB' : ''));
}
