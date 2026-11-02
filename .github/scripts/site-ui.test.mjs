import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const script = html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
const current = {
  schemaVersion: 2, stars: 1, installerDownloads: 240,
  verifiedInstallations: null, activeUsers: null, asOf: '2026-11-02T10:00:00.000Z',
  release: { tag: 'v0.2.6', win: ['Vibisual-0.2.6-setup.exe'], mac: [], linux: [] },
};

async function mount({ entries = {}, response = current, offline = false } = {}) {
  const storage = new Map(Object.entries(entries));
  const requests = [];
  const context = vm.createContext({
    DCLogic: class {
      props = {};
      setState(patch) { Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch); }
    },
    window: { addEventListener() {} },
    document: { getElementById: () => null, querySelector: () => null, addEventListener() {}, documentElement: {} },
    location: { origin: 'https://vibisual.pro', pathname: '/', search: '' },
    URLSearchParams,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (offline) throw new Error('Offline');
      return { ok: true, json: async () => response };
    },
  });
  vm.runInContext(script + '\n;globalThis.api = { Component, T, LANGS, PUBLIC_STATS_KEY, readPublicStats };', context);
  const { Component, ...api } = context.api;
  const app = new Component();
  app.applyFont = app.applyBg = app.initBgField = () => {};
  app.componentDidMount();
  await new Promise(resolve => setImmediate(resolve));
  return { ...api, app, storage, requests };
}

test('legacy cache and legacy response cannot supply installer downloads or visits', async () => {
  const { app, requests } = await mount({
    entries: { 'vibisual-stats': JSON.stringify({ stars: 999, dls: 999, visits: 999 }), 'vibisual-visited': '1' },
    response: { stars: 999, installs: 999 },
  });
  const values = app.renderVals();
  assert.equal(values.stat1, '—');
  assert.equal(values.stat2, '—');
  assert.equal(values.statsAsOf, '—');
  assert.equal(values.t.statsNotMeasured, 'Not measured');
  assert.deepEqual(requests.map(r => r.url), ['/stats.json']);
});

test('schema 2 displays its own timestamp and stores only the new schema', async () => {
  const { app, storage, PUBLIC_STATS_KEY } = await mount();
  const values = app.renderVals();
  assert.equal(values.stat1, '1');
  assert.equal(values.stat2, '240');
  assert.equal(values.statsAsOf, '2026-11-02 10:00:00 UTC');
  assert.equal(values.verNum, 'v0.2.6');
  const cached = JSON.parse(storage.get(PUBLIC_STATS_KEY));
  assert.equal(cached.schemaVersion, 2);
  assert.equal(cached.installerDownloads, 240);
  assert.equal(cached.verifiedInstallations, null);
  assert.equal(cached.activeUsers, null);
  assert.equal('dls' in cached || 'installs' in cached || 'visits' in cached, false);
});

test('offline schema 2 cache retains the original collection time', async () => {
  const previous = { ...current, installerDownloads: 50, asOf: '2026-10-01T00:00:00Z' };
  const { app } = await mount({ entries: { 'vibisual-public-stats-v2': JSON.stringify(previous) }, offline: true });
  assert.equal(app.renderVals().stat2, '50');
  assert.equal(app.renderVals().statsAsOf, '2026-10-01 00:00:00 UTC');
});

test('fresh missing metrics replace cached numbers with unknown instead of relabeling old data', async () => {
  const { app } = await mount({
    entries: { 'vibisual-public-stats-v2': JSON.stringify(current) },
    response: { schemaVersion: 2, asOf: '2026-11-03T00:00:00Z' },
  });
  assert.equal(app.renderVals().stat1, '—');
  assert.equal(app.renderVals().stat2, '—');
  assert.equal(app.renderVals().statsAsOf, '2026-11-03 00:00:00 UTC');
});

test('corrupt cache and invalid timestamps stay unknown without blocking the page', async () => {
  const { app } = await mount({
    entries: { 'vibisual-public-stats-v2': '{broken' },
    response: { ...current, asOf: 'not a date' },
  });
  assert.equal(app.renderVals().stat2, '—');
  assert.equal(app.renderVals().statsAsOf, '—');
});

test('counts reject invalid numbers and strings while accepting a measured zero', async () => {
  for (const value of [-1, 1.5, '240', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null]) {
    const { app } = await mount({ response: { ...current, stars: value, installerDownloads: value } });
    assert.equal(app.renderVals().stat1, '—');
    assert.equal(app.renderVals().stat2, '—');
  }
  const { app } = await mount({ response: { ...current, stars: 0, installerDownloads: 0 } });
  assert.equal(app.renderVals().stat1, '0');
  assert.equal(app.renderVals().stat2, '0');
  assert.equal(app.renderVals().t.statsNotMeasured, 'Not measured');
});

test('every supported locale renders the definition, caveat, unmeasured state and source labels', async () => {
  const { app, LANGS, T } = await mount();
  for (const [lang] of LANGS) {
    app.state.lang = lang;
    const { t, stat4 } = app.renderVals();
    for (const key of ['st2', 'st3', 'statsNotMeasured', 'statsDefinition', 'statsCaveat', 'statsMethod', 'statsAsOf']) {
      assert.equal(typeof T[lang][key], 'string', `${lang}.${key}`);
      assert.ok(t[key].trim(), `${lang}.${key}`);
    }
    for (const extension of ['.exe', '.dmg', '.AppImage', '.deb', '.rpm', 'ZIP']) {
      assert.ok(t.statsDefinition.includes(extension), `${lang}: ${extension}`);
    }
    assert.match(stat4, /^\d+$/, `${lang}: blog count preserved`);
    assert.doesNotMatch(t.sitePrivacy, /abacus|unpkg/);
  }
  assert.match(html, /href="\/metrics\/"/);
  assert.match(html, /{{ t\.statsNotMeasured }}/);
  assert.doesNotMatch(html, /abacus\.jasoncameron\.dev/);
});
