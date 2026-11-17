'use strict';
/* Deterministic DOM-level animation tests: no Firebase, network, credentials or live writes. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const controller = html.match(/<script id="nfLoginFXController">([\s\S]*?)<\/script>/)?.[1];
assert.ok(controller, 'presentation controller is required');

function harness() {
  const map = new Map();
  function element(id, display = 'block') {
    const classes = new Set();
    const handlers = new Map();
    const attributes = new Map();
    return {
      id, style: { display }, dataset: {}, textContent: '',
      hidden: id === 'nfFXLoadingHelp' || id === 'nfFXRetry',
      classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x) },
      addEventListener: (name, fn) => { handlers.set(name, fn); },
      dispatch: name => { if (handlers.has(name)) handlers.get(name)(); },
      setAttribute: (name, value) => { attributes.set(name, value); },
      getAttribute: name => attributes.get(name)
    };
  }
  for (const id of [
    'nfLoginFX', 'authScreen', 'appScreen', 'verificationScreen',
    'companySetupScreen', 'errorMessage', 'nfFXLoadingHelp', 'nfFXRetry',
    'nfFXSymbol', 'nfFXName', 'nfFXDetail', 'authButton', 'email', 'password'
  ]) map.set(id, element(id));
  for (const id of ['appScreen', 'verificationScreen', 'companySetupScreen'])
    map.get(id).style.display = 'none';

  let now = 0, nextTimerId = 0, reloads = 0;
  const timers = new Map();
  const observers = [];
  const context = {
    document: { getElementById: id => map.get(id) ?? null },
    getComputedStyle: el => ({ display: el.style.display }),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {}
    },
    setTimeout: (fn, ms) => { const id = ++nextTimerId; timers.set(id, { due: now + ms, fn }); return id; },
    clearTimeout: id => { timers.delete(id); },
    location: { reload: () => { reloads++; } }
  };
  vm.runInNewContext(controller, context, { timeout: 1000 });
  return {
    el: id => map.get(id),
    tick(ms) {
      const end = now + ms;
      for (let i = 0; i < 100; i++) {
        const ready = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
        if (!ready) { now = end; return; }
        now = ready[1].due; timers.delete(ready[0]); ready[1].fn();
      }
      throw Error('animation did not settle');
    },
    changeScreens(changes) {
      for (const [id, display] of Object.entries(changes)) map.get(id).style.display = display;
      observers[0].callback();
    },
    reportError(message) { map.get('errorMessage').textContent = message; observers[1].callback(); },
    get reloads() { return reloads; }
  };
}

test('opening is animated for exactly 2000ms, regardless of autofill or password input', () => {
  const h = harness(), fx = h.el('nfLoginFX');
  assert.equal(fx.dataset.phase, 'boot');
  assert.equal(fx.classList.contains('on'), true);
  h.el('password').dispatch('input');
  h.el('email').dispatch('change');
  h.el('authButton').dispatch('click'); // iOS credential/password form action
  assert.equal(fx.dataset.phase, 'boot');
  h.tick(1999);
  assert.equal(fx.classList.contains('on'), true);
  h.tick(1);
  assert.equal(fx.classList.contains('on'), false);
  h.el('authButton').dispatch('click');
  assert.equal(fx.classList.contains('on'), false, 'button/passkey must not retrigger the overlay');
});

test('dashboard entry after boot gets exactly one 2-second success animation', () => {
  const h = harness(), fx = h.el('nfLoginFX');
  h.tick(2000);
  h.changeScreens({ authScreen: 'none', appScreen: 'block' });
  assert.equal(fx.dataset.phase, 'success');
  assert.equal(h.el('nfFXName').textContent, 'ログイン成功');
  h.tick(1999);
  assert.equal(fx.classList.contains('on'), true);
  h.tick(1);
  assert.equal(fx.classList.contains('on'), false);
  h.changeScreens({ appScreen: 'block' });
  assert.equal(fx.classList.contains('on'), false, 'repeated app mutations must not replay success');
});

test('a fast cached authentication queues success rather than cutting startup short', () => {
  const h = harness(), fx = h.el('nfLoginFX');
  h.tick(100);
  h.changeScreens({ authScreen: 'none', appScreen: 'block' });
  assert.equal(fx.dataset.phase, 'boot');
  h.tick(1899);
  assert.equal(fx.dataset.phase, 'boot');
  h.tick(1);
  assert.equal(fx.dataset.phase, 'success');
  assert.equal(fx.classList.contains('on'), true);
  h.tick(2000);
  assert.equal(fx.classList.contains('on'), false);
});

test('failed login shows original form immediately and never flashes success', () => {
  const h = harness(), fx = h.el('nfLoginFX');
  h.reportError('メールアドレスまたはパスワードが違います');
  assert.equal(fx.classList.contains('on'), false);
  assert.notEqual(fx.dataset.phase, 'success');
});

test('a blank screen displays loading and offers recovery after 12 seconds', () => {
  const h = harness(), fx = h.el('nfLoginFX');
  h.changeScreens({ authScreen: 'none', appScreen: 'none' });
  h.tick(2000);
  assert.equal(fx.dataset.phase, 'loading');
  assert.equal(fx.classList.contains('on'), true);
  assert.equal(h.el('nfFXLoadingHelp').hidden, true);
  h.tick(12000);
  assert.equal(h.el('nfFXLoadingHelp').hidden, false);
  assert.equal(h.el('nfFXRetry').hidden, false);
  h.el('nfFXRetry').dispatch('click');
  assert.equal(h.reloads, 1);
  h.changeScreens({ authScreen: 'block' });
  assert.equal(fx.classList.contains('on'), false);
});
