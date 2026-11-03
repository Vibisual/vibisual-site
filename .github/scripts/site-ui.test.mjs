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

function createLocks() {
  const queues = new Map();
  return { request(name, options, callback) {
    const next = (queues.get(name) || Promise.resolve()).then(() => {
      if (options.signal.aborted) throw new Error('Lock request aborted');
      return callback();
    });
    queues.set(name, next.catch(() => {}));
    return next;
  } };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const visitorReply = value => ({ ok: true, json: async () => ({ value }) });

function createBrowser({ entries = {}, storage = new Map(Object.entries(entries)), response = current,
  offline = false, visitorResponse = { value: 337 }, visitorOffline = false, visitorFetch,
  locks = createLocks(), webdriver = false, origin = 'https://vibisual.pro', storageApi,
  timer = setTimeout, cancelTimer = clearTimeout } = {}) {
  const requests = [];
  const context = vm.createContext({
    DCLogic: class {
      props = {};
      setState(patch) { Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch); }
    },
    window: { addEventListener() {}, removeEventListener() {} },
    document: { getElementById: () => null, querySelector: () => null, addEventListener() {}, removeEventListener() {}, documentElement: {} },
    location: { origin, pathname: '/', search: '' },
    navigator: { locks, webdriver },
    URLSearchParams, AbortController, setTimeout: timer, clearTimeout: cancelTimer, cancelAnimationFrame() {},
    localStorage: storageApi || { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (offline || (visitorOffline && url.includes('abacus.'))) throw new Error('Offline');
      if (visitorFetch && url.includes('abacus.')) return visitorFetch(url, options);
      return { ok: true, json: async () => url.includes('abacus.') ? visitorResponse : response };
    },
  });
  vm.runInContext(script + '\n;globalThis.api = { Component, T, LANGS, PUBLIC_STATS_KEY, readPublicStats };', context);
  const { Component, ...api } = context.api;
  const mountApp = () => {
    const app = new Component();
    app.applyFont = app.applyBg = app.initBgField = () => {};
    app.componentDidMount();
    return app;
  };
  return { ...api, mountApp, storage, requests };
}

async function mount(options = {}) {
  const browser = createBrowser(options);
  const app = browser.mountApp();
  await flush();
  return { ...browser, app };
}

test('legacy installer cache remains isolated while the existing visitor counter is restored', async () => {
  const { app, requests } = await mount({
    entries: { 'vibisual-stats': JSON.stringify({ stars: 999, dls: 999, visits: 999 }), 'vibisual-visited': '1' },
    response: { stars: 999, installs: 999 },
  });
  const values = app.renderVals();
  assert.equal(values.stat1, '—');
  assert.equal(values.stat2, '—');
  assert.equal(values.statsAsOf, '—');
  assert.equal(values.t.statsNotMeasured, 'Not measured');
  assert.equal(values.stat3, '337');
  assert.deepEqual(requests.map(r => r.url), ['/stats.json', 'https://abacus.jasoncameron.dev/get/vibisual-pro/site-total']);
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

test('every supported locale keeps the visitor card and download clarification', async () => {
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
    assert.match(t.sitePrivacy, /abacus\.jasoncameron\.dev/);
    assert.doesNotMatch(t.sitePrivacy, /unpkg/);
  }
  assert.match(html, /href="\/metrics\/"/);
  assert.match(html, /{{ stat3 }}/);
  assert.doesNotMatch(html, /{{ t\.statsNotMeasured }}|class="vb-stats-note"/);
  assert.match(html, /title="{{ t\.statsCaveat }}"/);
  assert.equal(T.ko.st3, '웹사이트 방문자');
  assert.equal(T.en.st3, 'website visitors');
});


test('a new browser uses the existing hit endpoint once; return visits use get', async () => {
  const first = await mount({ visitorResponse: { value: 338 } });
  assert.equal(first.requests[1].url, 'https://abacus.jasoncameron.dev/hit/vibisual-pro/site-total');
  assert.equal(first.storage.get('vibisual-visited'), '1');
  assert.equal(first.app.renderVals().stat3, '338');
  assert.equal(JSON.parse(first.storage.get('vibisual-stats')).visits, 338);
  const again = await mount({ entries: Object.fromEntries(first.storage), visitorResponse: { value: 338 } });
  assert.equal(again.requests[1].url, 'https://abacus.jasoncameron.dev/get/vibisual-pro/site-total');
  assert.equal(again.app.renderVals().stat3, '338');
});

test('visitor failure preserves the old visitor value without importing legacy installs', async () => {
  const previous = { visits: 336, dls: 999, stars: 999 };
  const result = await mount({ entries: { 'vibisual-stats': JSON.stringify(previous) }, visitorOffline: true });
  assert.equal(result.app.renderVals().stat3, '336');
  assert.equal(result.app.renderVals().stat2, '240');
  assert.equal(result.storage.get('vibisual-visited'), 'pending');
  assert.deepEqual(JSON.parse(result.storage.get('vibisual-stats')), previous);
});

test('invalid visitor responses keep cached visits and the pending marker', async () => {
  for (const value of [undefined, null, '337', -1, NaN, 1.5]) {
    const result = await mount({ entries: { 'vibisual-stats': JSON.stringify({ visits: 336 }) }, visitorResponse: { value } });
    assert.equal(result.app.renderVals().stat3, '336');
    assert.equal(result.storage.get('vibisual-visited'), 'pending');
  }
  const result = await mount({ visitorResponse: { value: 0 } });
  assert.equal(result.app.renderVals().stat3, '0');
});

test('simultaneous tabs serialize the existing marker, request and cache write', async () => {
  const storage = new Map([['vibisual-stats', JSON.stringify({ visits: 338 })]]);
  const locks = createLocks();
  const firstReply = deferred();
  const first = createBrowser({ storage, locks, visitorFetch: () => firstReply.promise });
  const second = createBrowser({ storage, locks, visitorResponse: { value: 340 } });
  const firstApp = first.mountApp();
  const secondApp = second.mountApp();
  await flush();
  assert.equal(storage.get('vibisual-visited'), 'pending');
  assert.equal(first.requests.filter(r => r.url.includes('/hit/')).length, 1);
  assert.equal(second.requests.filter(r => r.url.includes('abacus.')).length, 0);
  firstReply.resolve(visitorReply(339));
  await flush();
  assert.equal(second.requests.find(r => r.url.includes('abacus.')).url, 'https://abacus.jasoncameron.dev/get/vibisual-pro/site-total');
  assert.equal(firstApp.state.visits, 339);
  assert.equal(secondApp.state.visits, 340);
  assert.equal(JSON.parse(storage.get('vibisual-stats')).visits, 340);
});

test('duplicate mounts in one page share a request and ignore unmounted callbacks', async () => {
  const reply = deferred();
  const browser = createBrowser({ entries: { 'vibisual-stats': JSON.stringify({ visits: 338 }) },
    visitorFetch: () => reply.promise });
  const oldApp = browser.mountApp();
  oldApp.componentWillUnmount();
  const currentApp = browser.mountApp();
  await flush();
  assert.equal(browser.requests.filter(r => r.url.includes('abacus.')).length, 1);
  reply.resolve(visitorReply(339));
  await flush();
  assert.equal(oldApp.state.visits, 338);
  assert.equal(currentApp.state.visits, 339);
});

test('a lost response leaves pending durable and a later page only reads', async () => {
  const first = await mount({ visitorOffline: true, entries: { 'vibisual-stats': JSON.stringify({ visits: 338 }) } });
  assert.equal(first.storage.get('vibisual-visited'), 'pending');
  assert.equal(first.app.state.visits, 338);
  const next = await mount({ entries: Object.fromEntries(first.storage), visitorResponse: { value: 339 } });
  assert.equal(next.requests.find(r => r.url.includes('abacus.')).url, 'https://abacus.jasoncameron.dev/get/vibisual-pro/site-total');
  assert.equal(next.storage.get('vibisual-visited'), 'pending');
  assert.equal(next.app.state.visits, 339);
});

test('storage failures, unsupported locks, previews and automation only read', async () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const markerWriteBlocked = { getItem: () => null, setItem() { throw new Error('quota'); } };
  const failedReadback = { getItem: () => null, setItem() {} };
  for (const options of [
    { storageApi: blocked }, { storageApi: markerWriteBlocked }, { storageApi: failedReadback },
    { locks: null }, { locks: { request() { throw new Error('lock denied'); } } },
    { locks: { request: async () => { throw new Error('lock denied'); } } },
    { origin: 'http://127.0.0.1:8767' }, { origin: 'https://preview.example.com' },
    { origin: 'http://vibisual.pro' }, { webdriver: true },
  ]) {
    const result = await mount(options);
    const requests = result.requests.filter(r => r.url.includes('abacus.'));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://abacus.jasoncameron.dev/get/vibisual-pro/site-total');
    assert.equal(requests[0].options.cache, 'no-store');
    assert.equal(result.app.state.visits, 337);
  }
});

test('a timeout releases the lock and never retries an ambiguous hit', async () => {
  let timeout;
  let cleared = false;
  const browser = createBrowser({ entries: { 'vibisual-stats': JSON.stringify({ visits: 338 }) },
    timer: (callback, delay) => { assert.equal(delay, 8000); timeout = callback; return 1; },
    cancelTimer: () => { cleared = true; },
    visitorFetch: (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }) });
  const app = browser.mountApp();
  await flush();
  assert.equal(browser.storage.get('vibisual-visited'), 'pending');
  timeout();
  await flush();
  assert.equal(cleared, true);
  assert.equal(app.state.visits, 338);
  assert.equal(browser.requests.filter(r => r.url.includes('abacus.')).length, 1);
  const next = await mount({ entries: Object.fromEntries(browser.storage) });
  assert.match(next.requests.find(r => r.url.includes('abacus.')).url, /\/get\//);
});

test('lock acquisition times out to read only and a late grant cannot increment', async () => {
  let expireLock, lateGrant, lockSignal;
  let nextTimer = 0;
  const timers = new Map();
  const browser = createBrowser({
    locks: { request(name, options, callback) {
      lockSignal = options.signal;
      lateGrant = callback;
      return new Promise(() => {});
    } },
    timer: callback => { const id = ++nextTimer; timers.set(id, callback); expireLock ||= callback; return id; },
    cancelTimer: id => timers.delete(id),
  });
  const app = browser.mountApp();
  await flush();
  assert.equal(browser.requests.filter(r => r.url.includes('abacus.')).length, 0);
  expireLock();
  await flush();
  assert.equal(lockSignal.aborted, true);
  assert.equal(app.state.visits, 337);
  assert.equal(browser.requests.filter(r => r.url.includes('abacus.')).length, 1);
  assert.match(browser.requests.find(r => r.url.includes('abacus.')).url, /\/get\//);
  assert.equal(browser.storage.has('vibisual-visited'), false);
  await lateGrant();
  await flush();
  assert.equal(browser.requests.filter(r => r.url.includes('abacus.')).length, 1);
  assert.equal(browser.storage.has('vibisual-visited'), false);
  assert.equal(timers.size, 0);
});

test('newer valid decreases and zero remain observations rather than a fabricated floor', async () => {
  const storage = new Map([['vibisual-stats', JSON.stringify({ visits: 338, dls: 999 })], ['vibisual-visited', '1']]);
  const values = [337, 0];
  const browser = createBrowser({ storage, visitorFetch: async () => visitorReply(values.shift()) });
  const first = browser.mountApp();
  await flush();
  assert.equal(first.state.visits, 337);
  first.componentWillUnmount();
  const second = browser.mountApp();
  await flush();
  assert.equal(second.state.visits, 0);
  assert.deepEqual(JSON.parse(storage.get('vibisual-stats')), { visits: 0, dls: 999 });
  assert.equal(browser.requests.filter(r => r.url.includes('/hit/')).length, 0);
});

test('HTTP errors and malformed JSON preserve the existing count without another hit', async () => {
  for (const response of [
    { ok: false, json: async () => ({ value: 0 }) },
    { ok: true, json: async () => { throw new Error('bad JSON'); } },
  ]) {
    const result = await mount({ entries: { 'vibisual-stats': JSON.stringify({ visits: 338 }) },
      visitorFetch: async () => response });
    assert.equal(result.app.state.visits, 338);
    assert.equal(JSON.parse(result.storage.get('vibisual-stats')).visits, 338);
    assert.equal(result.storage.get('vibisual-visited'), 'pending');
    assert.equal(result.requests.filter(r => r.url.includes('abacus.')).length, 1);
  }
});
