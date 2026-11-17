'use strict';
// Pure DOM simulation: zero real accounts, no Firebase credentials or production I/O.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function section(start, end) {
  const at = html.indexOf(start);
  const to = html.indexOf(end, at + start.length);
  assert.ok(at >= 0 && to > at, 'expected visual-only source block');
  return html.slice(at + start.length, to);
}
const controller = section('<script id="nfLoginFXController">', '</script>');
const css = section('<style id="nfPremiumLogin">', '</style>');

function harness() {
  const on = new Set();
  const timers = [];
  const subscriptions = [];
  const handler = {};
  const node = (textContent = '') => ({ textContent });
  let reloads = 0;
  const elements = {
    nfLoginFX: { dataset: {}, attributes: {}, classList: {
      add(key) { on.add(key); },
      remove(key) { on.delete(key); },
      contains(key) { return on.has(key); }
    }, setAttribute(key, value) { this.attributes[key] = value; } },
    nfFXSymbol: node(), nfFXName: node(), nfFXDetail: node(),
    nfFXLoadingHelp: { hidden: true },
    nfFXRetry: { hidden: true, addEventListener(kind, cb) {
      assert.equal(kind, 'click'); handler.retry = cb;
    } },
    authScreen: { style: { display: 'block' } },
    appScreen: { style: { display: 'none' } },
    verificationScreen: { style: { display: 'none' } },
    companySetupScreen: { style: { display: 'none' } },
    authButton: { textContent: 'ログイン', disabled: false,
      addEventListener(kind, cb, capture) { handler[kind] = cb; assert.equal(capture, true); }
    },
    errorMessage: node(), email: { value: '' }, password: { value: '' }
  };
  class Observer {
    constructor(callback) { this.callback = callback; }
    observe(target, options) { subscriptions.push({ target, options, cb: this.callback }); }
  }
  vm.runInNewContext(controller, {
    document: { getElementById: id => elements[id] || null },
    getComputedStyle: el => ({ display: el.style.display }),
    MutationObserver: Observer,
    setTimeout: (cb, delay) => (timers.push({ cb, delay }), timers.length),
    clearTimeout: () => {},
    location: { reload() { reloads++; } },
    sessionStorage: { getItem() { throw Error('sessionStorage must not hide repeated start'); } }
  }, { timeout: 1000 });
  function update() {
    const sub = subscriptions.find(x => x.target === elements.authScreen);
    assert.ok(sub);
    sub.cb();
  }
  function fail(message) {
    elements.errorMessage.textContent = message;
    const sub = subscriptions.find(x => x.target === elements.errorMessage);
    assert.ok(sub);
    sub.cb();
  }
  return { elements, on, timers, handler, update, fail, reloads: () => reloads };
}

test('every page load shows the NF startup screen, not just first session', () => {
  for (let i = 0; i < 2; i++) {
    const h = harness();
    assert.equal(h.on.has('on'), true);
    assert.equal(h.elements.nfLoginFX.dataset.phase, 'boot');
    assert.equal(h.elements.nfFXName.textContent, 'NICO FACTORY');
    assert.equal(h.timers.at(-1).delay, 2000);
  }
});
test('valid login button touch immediately shows login-in-progress; blank fields do not', () => {
  const h = harness();
  assert.equal(typeof h.handler.click, 'function');
  h.timers.at(-1).cb();
  h.handler.click();
  assert.equal(h.on.has('on'), false);
  h.elements.email.value = 'example@invalid.test';
  h.elements.password.value = 'fake-password';
  h.handler.click();
  assert.equal(h.on.has('on'), true);
  assert.equal(h.elements.nfLoginFX.dataset.phase, 'pending');
  assert.equal(h.elements.nfFXName.textContent, 'ログイン認証中');
  assert.equal(h.timers.at(-1).delay, 1600);
});
test('failed login hides pending effect without incorrectly displaying success', () => {
  const h = harness();
  h.elements.email.value = 'example@invalid.test';
  h.elements.password.value = 'fake-password';
  h.handler.click();
  h.fail('認証エラー');
  assert.equal(h.on.has('on'), false);
  assert.equal(h.elements.nfLoginFX.dataset.phase, 'pending');
});
test('success only after real app screen becomes visible; one success per login', () => {
  const h = harness();
  h.elements.authScreen.style.display = 'none';
  h.update(); // verification screen: not a successful login
  assert.notEqual(h.elements.nfLoginFX.dataset.phase, 'success');
  h.elements.appScreen.style.display = 'block';
  h.update();
  assert.equal(h.elements.nfLoginFX.dataset.phase, 'success');
  assert.equal(h.elements.nfFXName.textContent, 'ログイン成功');
  assert.equal(h.timers.at(-1).delay, 2000);
  const before = h.timers.length;
  h.update();
  assert.equal(h.timers.length, before);
  h.elements.authScreen.style.display = 'block';
  h.elements.appScreen.style.display = 'none';
  h.update();
  h.elements.authScreen.style.display = 'none';
  h.elements.appScreen.style.display = 'block';
  h.update();
  assert.equal(h.timers.length, before + 1);
});
test('registration does not show login-in-progress', () => {
  const h = harness();
  h.timers.at(-1).cb();
  h.elements.email.value = 'example@invalid.test';
  h.elements.password.value = 'fake-password';
  h.elements.authButton.textContent = 'アカウントを作成';
  h.handler.click();
  assert.equal(h.on.has('on'), false);
});
test('reduced-motion CSS disables spinning but retains static visible status', () => {
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css, /#nfLoginFX \.nf-ring\{animation:none!important\}/);
  assert.match(controller, /flash\('boot',2000\)/);
  assert.doesNotMatch(controller, /if\(reduced\)return|sessionStorage\.getItem/);
  assert.match(css, /#nfLoginFX\.on\{visibility:visible;opacity:1\}/);
});
test('presentation controller contains no Firebase/network/data mutations', () => {
  assert.doesNotMatch(controller, /signInWith|signOut|fetch\s*\(|setDoc|updateDoc|deleteDoc|firebase|httpsCallable|location\.href|window\.location/);
  assert.match(css, /pointer-events:none/);
  for (const id of ['authScreen','authButton','email','password','appScreen']) {
    assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1);
  }
});

test('slow post-auth initial data loading never exposes a white screen', () => {
  const h = harness();
  h.elements.authScreen.style.display = 'none';
  h.update(); // app and alternative screens still hidden while server requests run
  assert.equal(h.on.has('on'), true, 'startup overlay stays visible');
  h.timers[0].cb(); // 2-second initial splash finishes during slow Firestore
  assert.equal(h.on.has('on'), true);
  assert.equal(h.elements.nfLoginFX.dataset.phase, 'loading');
  assert.equal(h.elements.nfFXName.textContent, 'データを読み込み中');
  assert.equal(h.elements.nfLoginFX.attributes['aria-hidden'], 'false');
  assert.equal(h.elements.nfFXRetry.hidden, true);
  assert.equal(h.timers.at(-1).delay, 12000);
  assert.equal(h.reloads(), 0, 'never reload, sign out or mutate data automatically');
  h.timers.at(-1).cb();
  assert.equal(h.elements.nfFXLoadingHelp.hidden, false);
  assert.equal(h.elements.nfFXRetry.hidden, false);
  assert.equal(h.reloads(), 0, 'displaying retry option is not an automatic reload');
  h.handler.retry();
  assert.equal(h.reloads(), 1, 'explicit user action can safely retry the page');
});

test('successful page load replaces persistent loader with a 2-second success animation', () => {
  const h = harness();
  h.elements.authScreen.style.display = 'none';
  h.update();
  h.timers[0].cb(); // enter indefinite visual loading state
  assert.equal(h.elements.nfLoginFX.dataset.phase, 'loading');
  h.elements.appScreen.style.display = 'block';
  h.update();
  assert.equal(h.elements.nfLoginFX.dataset.phase, 'success');
  assert.equal(h.elements.nfFXLoadingHelp.hidden, true);
  assert.equal(h.timers.at(-1).delay, 2000);
  h.timers.at(-1).cb();
  assert.equal(h.on.has('on'), false);
});

test('verification and company setup screens stop loading, never claim login success', () => {
  for (const screen of ['verificationScreen', 'companySetupScreen']) {
    const h = harness();
    h.elements.authScreen.style.display = 'none';
    h.update();
    h.timers[0].cb();
    assert.equal(h.elements.nfLoginFX.dataset.phase, 'loading');
    h.elements[screen].style.display = 'block';
    h.update();
    assert.equal(h.on.has('on'), false);
    assert.notEqual(h.elements.nfLoginFX.dataset.phase, 'success');
  }
});

test('login error after a blank transition clears the waiting overlay safely', () => {
  const h = harness();
  h.elements.authScreen.style.display = 'none';
  h.update();
  h.timers[0].cb();
  h.elements.authScreen.style.display = 'block';
  h.update();
  h.fail('読み込みに失敗しました');
  assert.equal(h.on.has('on'), false);
  assert.equal(h.elements.nfFXRetry.hidden, true);
});

test('recovery affordance is hidden until an actual 12s blank loading period', () => {
  const h = harness();
  h.elements.authScreen.style.display = 'none';
  h.update();
  h.timers[0].cb();
  h.elements.appScreen.style.display = 'block';
  h.update();
  for (const scheduled of h.timers.filter(x => x.delay === 12000)) scheduled.cb();
  assert.equal(h.elements.nfFXLoadingHelp.hidden, true);
  assert.equal(h.elements.nfFXRetry.hidden, true);
  h.handler.retry();
  assert.equal(h.reloads(), 0);
});
