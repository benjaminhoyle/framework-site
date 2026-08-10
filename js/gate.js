/**
 * The gate on Framework's private pages.
 *
 * One mechanism for the funnel monitor, the catalogue manager and the two
 * studios, so there is one thing to explain to a new person and one thing to
 * change if it ever needs changing.
 *
 * What it does, in order:
 *   1. takes a `?key=` out of the URL if there is one, stores it, and strips it
 *      from the address bar — old bookmarks keep working, but the secret stops
 *      living in browser history and referrer headers;
 *   2. otherwise reads the key it stored last time;
 *   3. checks it against /api/auth before showing anything;
 *   4. asks for it, in a password field, if there isn't one or it is wrong.
 *
 * These pages are static files and anyone can fetch the HTML. That is not what
 * the gate is protecting: it protects the *endpoints*, which hold the data and
 * spend the image-generation budget. Hence `FrameworkGate.fetch`, which is the
 * only way any of these pages should talk to /api.
 *
 *     FrameworkGate.ready().then(function () { …start the page… });
 *     FrameworkGate.fetch('/api/catalog').then(…)
 */
window.FrameworkGate = (function () {
  "use strict";

  var STORAGE = 'frameworkKey';
  var key = '';

  function stored() {
    try { return window.localStorage.getItem(STORAGE) || ''; } catch (e) { return ''; }
  }
  function store(value) {
    try { window.localStorage.setItem(STORAGE, value); } catch (e) { /* private mode; the session still works */ }
  }
  function forget() {
    try { window.localStorage.removeItem(STORAGE); } catch (e) { /* nothing to do */ }
  }

  /** A `?key=` in the URL, moved into storage and removed from the address bar. */
  function adoptFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get('key');
    if (!fromUrl) return '';
    params.delete('key');
    var rest = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? '?' + rest : '') + window.location.hash);
    return fromUrl;
  }

  function check(candidate) {
    return window.fetch('/api/auth', {
      method: 'POST',
      headers: { 'x-framework-key': candidate }
    }).then(function (r) { return r.ok; }).catch(function () { return false; });
  }

  /** The same fetch, with the key attached. Never put it in the URL. */
  function gatedFetch(path, options) {
    var opts = options || {};
    var headers = Object.assign({}, opts.headers || {}, { 'x-framework-key': key });
    return window.fetch(path, Object.assign({}, opts, { headers: headers }));
  }

  function prompt(message) {
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'fw-gate';
      wrap.innerHTML =
        '<form class="fw-gate-card">' +
          '<h1>Framework</h1>' +
          '<p class="fw-gate-msg"></p>' +
          '<input type="password" autocomplete="current-password" ' +
            'aria-label="Access key" placeholder="Access key" required>' +
          '<button type="submit">Open</button>' +
        '</form>';
      wrap.querySelector('.fw-gate-msg').textContent = message;
      var form = wrap.querySelector('form');
      var input = wrap.querySelector('input');
      var button = wrap.querySelector('button');

      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var candidate = input.value.trim();
        if (!candidate) return;
        button.disabled = true;
        button.textContent = 'Checking…';
        check(candidate).then(function (ok) {
          if (ok) {
            store(candidate);
            wrap.remove();
            resolve(candidate);
            return;
          }
          button.disabled = false;
          button.textContent = 'Open';
          wrap.querySelector('.fw-gate-msg').textContent = 'That key was not recognised. Try again.';
          input.select();
        });
      });

      document.body.appendChild(wrap);
      input.focus();
    });
  }

  var readiness = null;

  /** Resolves once there is a key that /api/auth accepts. */
  function ready() {
    if (readiness) return readiness;
    readiness = (function () {
      var fromUrl = adoptFromUrl();
      var candidate = fromUrl || stored();
      if (fromUrl) store(fromUrl);
      if (!candidate) return prompt('This page is private. Enter the access key.');
      return check(candidate).then(function (ok) {
        if (ok) return candidate;
        forget();
        return prompt('The saved key is no longer valid. Enter the access key.');
      });
    })().then(function (value) {
      key = value;
      return value;
    });
    return readiness;
  }

  /** Forget the key on this device and ask again. */
  function signOut() {
    forget();
    window.location.reload();
  }

  return {
    ready: ready,
    fetch: gatedFetch,
    signOut: signOut,
    key: function () { return key; }
  };
})();
