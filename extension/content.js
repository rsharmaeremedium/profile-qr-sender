/* Medxplain Profile ID Finder - content script
 *
 * Runs only on https://medxplain.eremedium.in/admin/* and performs the admin
 * searches inside the tab, so they use the user's existing login session and
 * are not affected by cross-site cookie rules.
 *
 * The QR app handoff is done by the popup with chrome.scripting in the page's
 * main world (see popup.js), because content scripts cannot see page globals.
 */
(function () {
  'use strict';

  if (window.__profileIdFinderContent_v110) return;
  window.__profileIdFinderContent_v110 = true;

  var ADMIN_HOST = 'medxplain.eremedium.in';
  var DEFAULT_SEARCH_BASE = '/admin/userprofile/usersprofile/';
  var STORAGE_KEY = 'adminSearchBase';
  var searchBaseCache = null;

  function isAdminPage() {
    return location.hostname === ADMIN_HOST &&
      location.pathname.indexOf('/admin/') === 0;
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.cmd) return;

    if (msg.cmd === 'ping') {
      sendResponse({ ok: true, admin: isAdminPage() });
      return;
    }

    if (msg.cmd === 'lookupOne') {
      lookupOne(String(msg.email || '')).then(sendResponse).catch(function (err) {
        sendResponse({ status: 'error', message: String((err && err.message) || err) });
      });
      return true;
    }

    if (msg.cmd === 'diagnose') {
      diagnose(String(msg.email || '')).then(sendResponse).catch(function (err) {
        sendResponse({ ok: false, message: String((err && err.message) || err) });
      });
      return true;
    }

    if (msg.cmd === 'resetSearchBase') {
      searchBaseCache = null;
      chrome.storage.local.remove(STORAGE_KEY, function () {
        sendResponse({ ok: true });
      });
      return true;
    }
  });

  /* ---------------------------------------------------------- admin lookup */

  async function lookupOne(email) {
    if (!email) return { status: 'error', message: 'Missing email address.' };

    var base = await getSearchBase();
    var url = base + '?q=' + encodeURIComponent(email);
    var res = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Accept': 'text/html' }
    });

    if (isLoginResponse(res)) {
      return { status: 'login', message: 'The admin session is not logged in.' };
    }
    if (!res.ok) {
      return {
        status: 'error',
        message: 'The admin returned HTTP ' + res.status + ' for ' + base + '.'
      };
    }

    var html = await res.text();
    if (looksLikeLogin(html)) {
      return { status: 'login', message: 'The admin session is not logged in.' };
    }
    return parseResults(html, email, base);
  }

  function looksLikeLogin(html) {
    return /id=["']login-form["']/i.test(html) || /name=["']username["']/i.test(html);
  }

  function isLoginResponse(res) {
    return /\/admin\/login\//i.test(res.url);
  }

  /* The admin model path is not guaranteed to stay the same. Read the admin
   * index once and cache the changelist URL that looks like the user profile
   * model, instead of relying only on the hardcoded default. */
  async function getSearchBase() {
    if (searchBaseCache) return searchBaseCache;

    try {
      var stored = await chrome.storage.local.get([STORAGE_KEY]);
      if (stored && stored[STORAGE_KEY]) {
        searchBaseCache = withTrailingSlash(stored[STORAGE_KEY]);
        return searchBaseCache;
      }
    } catch (e) { /* storage is optional */ }

    var discovered = await discoverSearchBase();
    if (discovered) {
      searchBaseCache = discovered;
      try {
        chrome.storage.local.set({ [STORAGE_KEY]: discovered });
      } catch (e) { /* ignore */ }
      return discovered;
    }

    searchBaseCache = DEFAULT_SEARCH_BASE;
    return searchBaseCache;
  }

  async function discoverSearchBase() {
    var res = await fetch('/admin/', {
      credentials: 'same-origin',
      headers: { 'Accept': 'text/html' }
    });

    if (isLoginResponse(res) || !res.ok) return null;

    var html = await res.text();
    if (looksLikeLogin(html)) return null;

    var doc = new DOMParser().parseFromString(html, 'text/html');
    var links = doc.querySelectorAll('a[href]');
    var best = null;

    for (var i = 0; i < links.length; i++) {
      var raw = links[i].getAttribute('href') || '';
      var url;
      try {
        url = new URL(raw, location.origin);
      } catch (e) {
        continue;
      }
      if (url.origin !== location.origin) continue;
      if (!/^\/admin\/[^/]+\/[^/]+\/$/.test(url.pathname)) continue;

      var text = (links[i].textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      var path = url.pathname.toLowerCase();
      var score = 0;

      if (path.indexOf('usersprofile') !== -1) score += 20;
      if (path.indexOf('userprofile') !== -1) score += 15;
      if (text.indexOf('profile') !== -1) score += 6;
      if (text.indexOf('user') !== -1) score += 3;
      if (text.indexOf('doctor') !== -1) score += 2;
      if (path.indexOf('/auth/user/') !== -1) score += 1;

      if (score > 0 && (!best || score > best.score)) {
        best = { href: url.pathname, score: score, text: text };
      }
    }

    return best ? best.href : null;
  }

  function withTrailingSlash(value) {
    var s = String(value || '').trim();
    if (!s) return DEFAULT_SEARCH_BASE;
    if (s.charAt(0) !== '/') s = '/' + s;
    if (s.charAt(s.length - 1) !== '/') s += '/';
    return s;
  }

  function parseResults(html, email, base) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var table = doc.querySelector('#result_list');
    var results = collectResults(table || doc, base);

    // If the custom table had no profile links, fall back to the whole page.
    if (!results.length && table) results = collectResults(doc, base);

    if (!results.length) {
      return {
        status: 'notfound',
        message: 'No user matched this email.',
        rowCount: table ? table.querySelectorAll('tbody tr').length : 0
      };
    }

    var emailLc = email.toLowerCase();
    var exact = results.filter(function (r) {
      return r.text.toLowerCase().indexOf(emailLc) !== -1;
    });

    if (exact.length === 1) return found(exact[0]);
    if (results.length === 1) return found(results[0]);

    return {
      status: 'ambiguous',
      message: exact.length > 1
        ? 'Several results contain this email. Choose one.'
        : 'Several results matched. Choose one.',
      candidates: (exact.length > 1 ? exact : results).map(publicResult)
    };
  }

  function collectResults(scope, base) {
    var seen = Object.create(null);
    var results = [];
    var modelPath = withTrailingSlash(base || DEFAULT_SEARCH_BASE);
    var modelRe = new RegExp(escapeRegExp(modelPath) + '(\\d+)(?:/|$)', 'i');
    var fallbackRe = /\/usersprofile\/(\d+)\//i;
    var links = scope.querySelectorAll('a[href]');

    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || '';
      var url;
      try {
        url = new URL(href, location.origin);
      } catch (e) {
        continue;
      }
      if (url.origin !== location.origin) continue;

      var m = url.pathname.match(modelRe) || url.pathname.match(fallbackRe);
      if (!m) continue;

      var id = m[1];
      if (seen[id]) continue;
      seen[id] = true;

      var tr = links[i].closest('tr');
      var text = (tr ? tr.textContent : links[i].textContent || '')
        .replace(/\s+/g, ' ').trim();

      results.push({
        id: id,
        text: text,
        changeUrl: url.href
      });
    }

    return results;
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function found(result) {
    return {
      status: 'found',
      id: result.id,
      changeUrl: result.changeUrl,
      rowText: result.text.slice(0, 180)
    };
  }

  function publicResult(result) {
    return {
      id: result.id,
      changeUrl: result.changeUrl,
      rowText: result.text.slice(0, 180)
    };
  }

  /* ------------------------------------------------------------ diagnostics */

  async function diagnose(email) {
    var out = {
      ok: true,
      pageUrl: location.href,
      adminPage: isAdminPage(),
      cachedBase: searchBaseCache || null,
      storedBase: null,
      discoveredBase: null,
      indexStatus: null,
      indexFinalUrl: null,
      indexLogin: null,
      candidates: [],
      search: null
    };

    try {
      var stored = await chrome.storage.local.get([STORAGE_KEY]);
      out.storedBase = (stored && stored[STORAGE_KEY]) || null;
    } catch (e) { /* ignore */ }

    try {
      var res = await fetch('/admin/', {
        credentials: 'same-origin',
        headers: { 'Accept': 'text/html' }
      });
      out.indexStatus = res.status;
      out.indexFinalUrl = res.url;
      out.indexLogin = isLoginResponse(res);

      if (res.ok && !out.indexLogin) {
        var html = await res.text();
        if (looksLikeLogin(html)) {
          out.indexLogin = true;
        } else {
          var doc = new DOMParser().parseFromString(html, 'text/html');
          var links = doc.querySelectorAll('a[href]');
          for (var i = 0; i < links.length && out.candidates.length < 25; i++) {
            var raw = links[i].getAttribute('href') || '';
            var url;
            try { url = new URL(raw, location.origin); } catch (e) { continue; }
            if (url.origin !== location.origin) continue;
            if (!/^\/admin\/[^/]+\/[^/]+\/$/.test(url.pathname)) continue;
            out.candidates.push({
              path: url.pathname,
              text: (links[i].textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)
            });
          }
        }
      }
    } catch (e) {
      out.indexError = String((e && e.message) || e);
    }

    try {
      out.discoveredBase = await discoverSearchBase();
    } catch (e) {
      out.discoverError = String((e && e.message) || e);
    }

    if (email) {
      try {
        var base = await getSearchBase();
        var searchRes = await fetch(base + '?q=' + encodeURIComponent(email), {
          credentials: 'same-origin',
          headers: { 'Accept': 'text/html' }
        });
        var body = await searchRes.text();
        var searchDoc = new DOMParser().parseFromString(body, 'text/html');
        var table = searchDoc.querySelector('#result_list');
        var rows = table ? table.querySelectorAll('tbody tr') : [];
        var sample = [];
        for (var r = 0; r < rows.length && sample.length < 3; r++) {
          var t = rows[r].textContent.replace(/\s+/g, ' ').trim();
          if (t) sample.push(t.slice(0, 160));
        }
        out.search = {
          base: base,
          url: base + '?q=' + encodeURIComponent(email),
          status: searchRes.status,
          finalUrl: searchRes.url,
          login: isLoginResponse(searchRes) || looksLikeLogin(body),
          tableFound: !!table,
          rowCount: rows.length,
          profileLinks: collectResults(searchDoc, base).length,
          sampleRows: sample
        };
      } catch (e) {
        out.search = { error: String((e && e.message) || e) };
      }
    }

    return out;
  }
})();
