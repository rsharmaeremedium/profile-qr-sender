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

  if (window.__profileIdFinderContent) return;
  window.__profileIdFinderContent = true;

  var ADMIN_HOST = 'medxplain.eremedium.in';

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
  });

  /* ---------------------------------------------------------- admin lookup */

  async function lookupOne(email) {
    if (!email) return { status: 'error', message: 'Missing email address.' };

    var url = '/admin/userprofile/usersprofile/?q=' + encodeURIComponent(email);
    var res = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'Accept': 'text/html' }
    });

    if (/\/admin\/login\//i.test(res.url)) {
      return { status: 'login', message: 'The admin session is not logged in.' };
    }
    if (!res.ok) {
      return { status: 'error', message: 'The admin returned HTTP ' + res.status + '.' };
    }

    var html = await res.text();
    if (/id=["']login-form["']/i.test(html) || /name=["']username["']/i.test(html)) {
      return { status: 'login', message: 'The admin session is not logged in.' };
    }

    return parseResults(html, email);
  }

  function parseResults(html, email) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var table = doc.querySelector('#result_list');
    var results = collectResults(table || doc);

    // If the custom table had no profile links, fall back to the whole page.
    if (!results.length && table) results = collectResults(doc);

    if (!results.length) {
      return { status: 'notfound', message: 'No user matched this email.' };
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

  function collectResults(scope) {
    var seen = Object.create(null);
    var results = [];
    var links = scope.querySelectorAll('a[href*="/usersprofile/"]');

    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href') || '';
      var m = href.match(/\/usersprofile\/(\d+)\//);
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
        changeUrl: new URL(href, location.origin).href
      });
    }

    return results;
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
})();
