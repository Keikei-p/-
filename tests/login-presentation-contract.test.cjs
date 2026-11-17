'use strict';
/*
 * Login visual-only regression contract.
 * Uses built-in Node modules; does not access Firebase or production.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const extract = (start, end) => {
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, 'visual block must be present');
  return html.slice(from, to);
};
test('visual layer is confined to login; no existing auth form identifiers removed', () => {
  for (const id of ['authScreen', 'authButton', 'authTitle', 'email', 'password',
                    'nameGroup', 'switchButton', 'forgotPasswordButton',
                    'partnerEmailLinkVerifyPanel', 'appScreen']) {
    assert.match(html, new RegExp('id="' + id + '"'), 'required original element missing: '+id);
  }
  assert.equal((html.match(/id="authButton"/g) || []).length, 1);
  assert.equal((html.match(/id="nfLoginFX"/g) || []).length, 1);
  assert.match(html, /async function login\(\)/);
  assert.match(html, /onAuthStateChanged\(\s*auth,/);
});
test('login design includes mobile and reduced-motion fallbacks', () => {
  const css = extract('<style id="nfPremiumLogin">', '</style>');
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /#authScreen \.auth-card/);
  assert.match(css, /#authScreen \.auth-wrapper/);
});
test('boot and success overlay is passive and contains no auth operations', () => {
  const controller = extract('<script id="nfLoginFXController">', '</script>');
  assert.match(html, /id="nfLoginFX" aria-hidden="true"/);
  assert.match(controller, /MutationObserver/);
  assert.match(controller, /getComputedStyle\(app\)/);
  assert.match(controller, /sessionStorage/);
  assert.doesNotMatch(controller, /signInWith|createUserWith|signOut|setDoc|updateDoc|deleteDoc|fetch\s*\(/);
  const css = extract('<style id="nfPremiumLogin">', '</style>');
  assert.match(css, /pointer-events:none/);
});

const vm = require('node:vm');
function createVisualHarness({ reduced = false, seen = false } = {}) {
  const visible = new Set();
  const elements = {
    authScreen: { style: { display: '' } },
    appScreen: { style: { display: 'none' } },
    nfLoginFX: { classList: {
      add: value => visible.add(value),
      remove: value => visible.delete(value),
      contains: value => visible.has(value)
    } },
    nfFXSymbol: { textContent: '' },
    nfFXName: { textContent: '' },
    nfFXDetail: { textContent: '' }
  };
  const scheduled = [];
  const storage = new Map(seen ? [['nf-login-intro-v1', 'seen']] : []);
  let notify;
  const context = {
    document: { getElementById: id => elements[id] || null },
    window: { matchMedia: () => ({ matches: reduced }) },
    sessionStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value)
    },
    getComputedStyle: node => ({ display: node.style.display }),
    clearTimeout: () => {},
    setTimeout: (cb, duration) => {
      scheduled.push({ cb, duration });
      return scheduled.length;
    },
    MutationObserver: class {
      constructor(cb) { notify = cb; }
      observe() {}
    }
  };
  const script = extract('<script id="nfLoginFXController">', '</script>');
  vm.runInNewContext(script, context, { timeout: 500 });
  assert.equal(typeof notify, 'function', 'controller attaches a passive visual observer');
  return {
    elements, visible, scheduled,
    transition(authDisplay, appDisplay) {
      elements.authScreen.style.display = authDisplay;
      elements.appScreen.style.display = appDisplay;
      notify();
    }
  };
}
test('first launch overlay is non-blocking and a success badge requires app visibility', () => {
  const h = createVisualHarness();
  assert.ok(h.visible.has('on'));
  assert.equal(h.elements.nfFXName.textContent, 'NICO FACTORY');
  assert.equal(h.scheduled.at(-1).duration, 1000);
  h.transition('none', 'none');
  assert.equal(h.elements.nfFXName.textContent, 'NICO FACTORY', 'do not celebrate a hidden/error screen');
  h.transition('none', 'block');
  assert.equal(h.elements.nfFXName.textContent, 'ログイン成功');
  assert.equal(h.elements.nfFXDetail.textContent, 'ダッシュボードを表示します');
  assert.equal(h.scheduled.at(-1).duration, 600);
  const count = h.scheduled.length;
  h.transition('none', 'block');
  assert.equal(h.scheduled.length, count, 'same authenticated view must not replay success');
});
test('subsequent session has no first-launch splash and a logout/login resets success', () => {
  const h = createVisualHarness({ seen: true });
  assert.equal(h.scheduled.length, 0);
  h.transition('none', 'block');
  assert.equal(h.elements.nfFXName.textContent, 'ログイン成功');
  h.transition('block', 'none');
  h.transition('none', 'block');
  assert.equal(h.scheduled.length, 2, 'new login shows success once');
});
test('reduced-motion users never get blocking overlays', () => {
  const h = createVisualHarness({ reduced: true });
  h.transition('none', 'block');
  assert.equal(h.scheduled.length, 0);
  assert.equal(h.visible.has('on'), false);
});
