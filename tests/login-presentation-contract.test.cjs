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
  assert.match(controller, /getComputedStyle\(element\)/);
  assert.match(controller, /visible\(app\)/);
  assert.doesNotMatch(controller, /sessionStorage/, 'repeated page loads must not suppress startup');
  assert.match(controller, /flash\('boot',2000\)/, '2-second startup phase on every load');
  assert.doesNotMatch(controller, /flash\('pending'/, 'passkey and button presses do not start an overlay');
  assert.doesNotMatch(controller, /button\.addEventListener\('click'/, 'passkey or credential UI must never retrigger the FX');
  assert.match(controller, /queuedSuccess/, 'boot must finish before a fast sign-in success overlay');
  assert.match(html, /id="nfFXLoadingHelp"/);
  assert.match(html, /id="nfFXRetry"/);
  assert.match(controller, /showLoading\(true\)/);
  assert.match(controller, /12000/, 'no indefinite invisible loading');
  assert.match(controller, /flash\('success',2000\)/, '2-second authenticated success phase');
  assert.doesNotMatch(controller, /signInWith|createUserWith|signOut|setDoc|updateDoc|deleteDoc|fetch\s*\(/);
  const css = extract('<style id="nfPremiumLogin">', '</style>');
  assert.match(css, /pointer-events:none/);
  assert.match(css, /height:100svh/, 'FX uses a stable mobile viewport height');
  assert.match(css, /min-height:48px;border-radius:11px;font-size:16px/, 'iOS credential fields must not zoom the page on focus');
  assert.match(css, /nfOrbitReverse/, 'visibly moving rings are retained');
  assert.match(css, /nfFXSuccess/, 'success has a dedicated animation');
  assert.match(css, /#nfLoginFX \.nf-ring:before/, 'circular sweep is visible even during boot');
});
