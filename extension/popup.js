'use strict';

/* Medxplain Profile ID Finder - popup logic
 * Drives one admin search at a time in the user's logged-in admin tab,
 * then pushes the found IDs into the Profile QR Sender app.
 */

var $ = function (id) { return document.getElementById(id); };

var APP_URL = 'https://rsharmaeremedium.github.io/profile-qr-sender/';
var ADMIN_URL = 'https://medxplain.eremedium.in/admin/userprofile/usersprofile/';
var APP_PATTERNS = [
  'https://rsharmaeremedium.github.io/profile-qr-sender/*',
  'http://localhost/*',
  'http://127.0.0.1/*'
];
var EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

var state = {
  results: [],
  running: false,
  stop: false,
  delay: 700
};

var els = {};
var saveTimer = null;

document.addEventListener('DOMContentLoaded', init);

function init() {
  els = {
    emails: $('emails'),
    findBtn: $('findBtn'),
    stopBtn: $('stopBtn'),
    useAppBtn: $('useAppBtn'),
    openAdminBtn: $('openAdminBtn'),
    openTabBtn: $('openTabBtn'),
    diagnoseBtn: $('diagnoseBtn'),
    resetAdminBtn: $('resetAdminBtn'),
    diagnostics: $('diagnostics'),
    status: $('status'),
    bar: $('bar'),
    resultsWrap: $('resultsWrap'),
    results: $('results'),
    count: $('count'),
    clearResultsBtn: $('clearResultsBtn'),
    pushBtn: $('pushBtn'),
    copyBtn: $('copyBtn'),
    csvBtn: $('csvBtn'),
    delay: $('delay')
  };

  bind();
  load();
  render();
}

function bind() {
  els.findBtn.addEventListener('click', runLookups);

  els.stopBtn.addEventListener('click', function () {
    state.stop = true;
    setStatus('Stopping after the current email…', 'warn');
  });

  els.useAppBtn.addEventListener('click', useEmailsFromApp);

  els.openAdminBtn.addEventListener('click', function () {
    chrome.tabs.create({ url: ADMIN_URL, active: true });
  });

  els.diagnoseBtn.addEventListener('click', runDiagnostics);
  els.resetAdminBtn.addEventListener('click', resetAdminBase);

  els.openTabBtn.addEventListener('click', function () {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
  });

  els.clearResultsBtn.addEventListener('click', function () {
    state.results = [];
    render();
    save();
    setStatus('Results cleared.', 'info');
    setProgress(0);
  });

  els.pushBtn.addEventListener('click', pushIds);
  els.copyBtn.addEventListener('click', copyPairs);
  els.csvBtn.addEventListener('click', downloadCsv);

  els.delay.addEventListener('change', function () {
    state.delay = clampDelay(els.delay.value);
    els.delay.value = state.delay;
    save();
  });

  els.emails.addEventListener('input', saveSoon);
}

/* --------------------------------------------------------------- persistence */

function load() {
  chrome.storage.local.get(['finderState'], function (data) {
    var saved = data && data.finderState;
    if (!saved) return;
    if (typeof saved.emails === 'string') els.emails.value = saved.emails;
    if (Array.isArray(saved.results)) state.results = saved.results;
    if (saved.delay) state.delay = clampDelay(saved.delay);
    els.delay.value = state.delay;
    render();
  });
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 300);
}

function save() {
  chrome.storage.local.set({
    finderState: {
      emails: els.emails.value,
      results: state.results,
      delay: state.delay
    }
  });
}

/* -------------------------------------------------------------------- lookup */

async function runLookups() {
  if (state.running) return;

  var emails = extractEmails(els.emails.value);
  if (!emails.length) {
    setStatus('Add at least one email address.', 'error');
    return;
  }

  state.running = true;
  state.stop = false;
  state.results = [];
  els.emails.value = emails.join('\n');
  setRunningUI(true);
  render();
  save();
  setProgress(0);
  setStatus('Connecting to the Medxplain admin…', 'info');

  var tab;
  try {
    tab = await ensureAdminTab();
  } catch (e) {
    state.running = false;
    setRunningUI(false);
    setStatus('Could not open the admin tab: ' + e.message, 'error');
    return;
  }

  var pong;
  try {
    pong = await sendToTab(tab.id, { cmd: 'ping' }, 8);
  } catch (e) {
    state.running = false;
    setRunningUI(false);
    setStatus('The admin tab did not respond. Reload it, log in, then try again.', 'error');
    return;
  }

  if (!pong || !pong.admin) {
    state.running = false;
    setRunningUI(false);
    setStatus('Open a Medxplain admin page in a tab, then try again.', 'error');
    return;
  }

  var foundCount = 0;

  for (var i = 0; i < emails.length; i++) {
    if (state.stop) break;

    var email = emails[i];
    setStatus('Looking up ' + (i + 1) + ' of ' + emails.length + ': ' + email, 'info');

    var result;
    try {
      result = await sendToTab(tab.id, { cmd: 'lookupOne', email: email }, 3);
    } catch (e) {
      result = { status: 'error', message: String(e.message || e) };
    }
    if (!result) result = { status: 'error', message: 'No response from the admin tab.' };

    result.email = email;
    state.results.push(result);
    if (result.status === 'found') foundCount++;

    render();
    save();
    setProgress((i + 1) / emails.length);

    if (result.status === 'login') {
      setStatus('The admin session is not logged in. Log in in the admin tab, then run again.', 'error');
      chrome.tabs.update(tab.id, { active: true });
      break;
    }

    if (i < emails.length - 1 && !state.stop) await sleep(state.delay);
  }

  state.running = false;
  setRunningUI(false);
  save();

  if (state.stop) {
    setStatus('Stopped. ' + foundCount + ' of ' + emails.length + ' IDs found.', foundCount ? 'ok' : 'warn');
  } else {
    setStatus('Done. ' + foundCount + ' of ' + emails.length + ' IDs found.', foundCount ? 'ok' : 'warn');
  }
}

async function ensureAdminTab() {
  var tabs = await chrome.tabs.query({ url: ['https://medxplain.eremedium.in/admin/*'] });
  if (tabs.length) return tabs[0];

  var tab = await chrome.tabs.create({ url: ADMIN_URL, active: false });
  await waitForTab(tab.id);
  return tab;
}

function waitForTab(tabId) {
  return new Promise(function (resolve) {
    var done = false;

    function finish() {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }

    function listener(id, info) {
      if (id === tabId && info.status === 'complete') finish();
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId, function (tab) {
      if (tab && tab.status === 'complete') finish();
    });
    setTimeout(finish, 20000);
  });
}

async function runDiagnostics() {
  els.diagnostics.hidden = false;
  els.diagnostics.textContent = 'Running diagnostics…';
  setStatus('Checking the admin session…', 'info');

  var emails = extractEmails(els.emails.value);
  var email = emails[0] || '';

  var tab;
  try {
    tab = await ensureAdminTab();
  } catch (e) {
    els.diagnostics.textContent = 'Could not open the admin tab: ' + e.message;
    setStatus('Could not open the admin tab.', 'error');
    return;
  }

  var result;
  try {
    result = await sendToTab(tab.id, { cmd: 'diagnose', email: email }, 8);
  } catch (e) {
    result = { ok: false, message: String(e.message || e) };
  }

  var app = null;
  try {
    var appTab = await findAppTab(false);
    if (appTab) {
      app = await executeInPage(appTab.id, pageIsApp);
      var appEmails = await executeInPage(appTab.id, pageGetEmails);
      app.emailCount = appEmails && appEmails.ok ? appEmails.emails.length : null;
    }
  } catch (e) {
    app = { error: String(e.message || e) };
  }

  els.diagnostics.textContent = JSON.stringify({ adminTab: result, appTab: app }, null, 2);

  if (result && result.indexLogin) {
    setStatus('Admin says login required. Log in in the admin tab, then click Diagnose again.', 'warn');
  } else if (result && result.search && result.search.login) {
    setStatus('Search redirected to login. Log in in the admin tab and try again.', 'warn');
  } else if (result && result.search && result.search.status >= 400) {
    setStatus('Admin search returned HTTP ' + result.search.status + '. Check the admin URL.', 'error');
  } else if (result && result.search && result.search.rowCount === 0) {
    setStatus('Search returned no rows for ' + (email || 'the test email') + '.', 'warn');
  } else if (result && result.ok) {
    setStatus('Diagnostics captured. See the report below.', 'ok');
  } else {
    setStatus('Diagnostics failed. See the report below.', 'error');
  }
}

async function resetAdminBase() {
  try {
    var tab = await ensureAdminTab();
    await sendToTab(tab.id, { cmd: 'resetSearchBase' }, 5);
    els.diagnostics.hidden = true;
    setStatus('Admin search URL reset. The next run will rediscover it.', 'ok');
  } catch (e) {
    setStatus('Could not reset the admin URL: ' + e.message, 'error');
  }
}

function sendToTab(tabId, msg, retries) {
  retries = retries == null ? 5 : retries;

  return new Promise(function (resolve, reject) {
    var injected = false;

    function attempt(left) {
      chrome.tabs.sendMessage(tabId, msg, function (response) {
        var err = chrome.runtime.lastError;
        if (err) {
          // The content script may not be in the tab yet (tab opened before the
          // extension was installed). Inject it once and retry.
          if (!injected) {
            injected = true;
            injectContent(tabId).then(function () {
              setTimeout(function () { attempt(left); }, 250);
            });
            return;
          }
          if (left > 0) {
            setTimeout(function () { attempt(left - 1); }, 350);
            return;
          }
          reject(new Error(err.message));
          return;
        }
        resolve(response);
      });
    }

    attempt(retries);
  });
}

function injectContent(tabId) {
  return new Promise(function (resolve) {
    chrome.scripting.executeScript(
      { target: { tabId: tabId }, files: ['content.js'] },
      function () {
        void chrome.runtime.lastError;
        resolve();
      }
    );
  });
}

/* ------------------------------------------------------------- app handoff */

/* The app's functions live in the page's own JS world. Content scripts run in an
 * isolated world, so we run these helpers in the MAIN world with chrome.scripting.
 * The functions below must be self-contained: Chrome serialises them by source. */

function pageIsApp() {
  var marked = document.querySelector('meta[name="application-name"][content="Profile QR Sender"]');
  if (document.title !== 'Profile QR Sender' && !marked) return { app: false };
  var list = document.getElementById('profileList');
  var cards = document.querySelectorAll('.profile-card');
  return {
    app: !!(list || cards.length),
    bridge: !!(window.ProfileQrSender && typeof window.ProfileQrSender.getEmails === 'function')
  };
}

function pageGetEmails() {
  if (window.ProfileQrSender && typeof window.ProfileQrSender.getEmails === 'function') {
    return { ok: true, emails: window.ProfileQrSender.getEmails() };
  }

  var emails = [];
  var seen = Object.create(null);
  var nodes = document.querySelectorAll('.pc-email');

  for (var i = 0; i < nodes.length; i++) {
    var value = nodes[i].textContent.trim();
    var key = value.toLowerCase();
    if (!value || seen[key]) continue;
    seen[key] = true;
    emails.push(value);
  }

  return { ok: true, emails: emails };
}

function pageSetIds(items) {
  if (window.ProfileQrSender && typeof window.ProfileQrSender.setIds === 'function') {
    var bridged = window.ProfileQrSender.setIds(items);
    return {
      ok: true,
      updated: bridged.updated,
      added: bridged.added,
      missing: bridged.missing
    };
  }

  var cards = document.querySelectorAll('.profile-card');
  var byEmail = Object.create(null);
  var i;

  for (i = 0; i < cards.length; i++) {
    var emailNode = cards[i].querySelector('.pc-email');
    if (emailNode) byEmail[emailNode.textContent.trim().toLowerCase()] = cards[i];
  }

  var updated = 0;
  var missing = [];

  (items || []).forEach(function (item) {
    if (!item) return;
    var email = String(item.email || '').trim();
    var id = String(item.id == null ? '' : item.id).trim();
    if (!email || !/^\d+$/.test(id)) return;

    var card = byEmail[email.toLowerCase()];
    if (!card) { missing.push(email); return; }

    var input = card.querySelector('.id-input');
    if (!input) { missing.push(email); return; }

    input.value = id;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    updated++;
  });

  return { ok: true, updated: updated, missing: missing };
}

function executeInPage(tabId, func, args) {
  return new Promise(function (resolve, reject) {
    chrome.scripting.executeScript(
      {
        target: { tabId: tabId },
        world: 'MAIN',
        func: func,
        args: args || []
      },
      function (results) {
        var err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        if (!results || !results.length) {
          reject(new Error('The page returned no result.'));
          return;
        }
        resolve(results[0].result);
      }
    );
  });
}

async function findAppTab(openIfMissing) {
  var tabs = await chrome.tabs.query({ url: APP_PATTERNS });

  for (var i = 0; i < tabs.length; i++) {
    try {
      var info = await executeInPage(tabs[i].id, pageIsApp);
      if (info && info.app) return tabs[i];
    } catch (e) { /* not the app tab, or the page is not ready yet */ }
  }

  if (!openIfMissing) return null;

  var tab = await chrome.tabs.create({ url: APP_URL, active: false });
  await waitForTab(tab.id);
  return tab;
}

async function useEmailsFromApp() {
  setStatus('Looking for the QR app tab…', 'info');

  var tab = await findAppTab(false);
  if (!tab) {
    setStatus('Open the QR app in a tab first, then click this button again.', 'warn');
    return;
  }

  try {
    var res = await executeInPage(tab.id, pageGetEmails);
    if (!res || !res.ok) {
      setStatus((res && res.message) || 'Could not read the QR app.', 'error');
      return;
    }
    if (!res.emails.length) {
      setStatus('The QR app has no emails yet. Add them there first.', 'warn');
      return;
    }
    els.emails.value = res.emails.join('\n');
    save();
    setStatus(res.emails.length + ' emails loaded from the QR app.', 'ok');
  } catch (e) {
    setStatus('Could not reach the QR app tab. Reload it and try again.', 'error');
  }
}

async function pushIds() {
  var found = state.results.filter(function (r) {
    return r.status === 'found' && r.id;
  });

  if (!found.length) {
    setStatus('No IDs to push yet.', 'warn');
    return;
  }

  var items = found.map(function (r) {
    return { email: r.email, id: r.id };
  });

  var tab = await findAppTab(false);
  if (tab) {
    try {
      var res = await executeInPage(tab.id, pageSetIds, [items]);
      if (res && res.ok) {
        chrome.tabs.update(tab.id, { active: true });

        var parts = [];
        if (res.updated) parts.push(res.updated + ' updated');
        if (res.added) parts.push(res.added + ' added');
        if (res.missing && res.missing.length) {
          parts.push(res.missing.length + ' not found in the app');
        }

        setStatus(parts.length
          ? parts.join(', ') + ' - IDs pushed to the QR app.'
          : 'IDs pushed to the QR app.',
          res.missing && res.missing.length ? 'warn' : 'ok');
        return;
      }
    } catch (e) { /* fall back to a fresh app tab */ }
  }

  var payload = b64url(JSON.stringify(items));
  chrome.tabs.create({ url: APP_URL + '#import=' + payload, active: true });
  setStatus('Opened the QR app with ' + items.length + ' IDs.', 'ok');
}

function copyPairs() {
  var found = state.results.filter(function (r) {
    return r.status === 'found' && r.id;
  });

  var text = found.map(function (r) {
    return r.email + ', ' + r.id;
  }).join('\n');

  navigator.clipboard.writeText(text).then(function () {
    setStatus('Copied ' + found.length + ' email,id lines.', 'ok');
  }, function () {
    setStatus('Clipboard was blocked. Use the CSV button instead.', 'error');
  });
}

function downloadCsv() {
  var lines = ['email,profile_id,status'];

  state.results.forEach(function (r) {
    var id = r.status === 'found' ? r.id : '';
    lines.push([r.email, id, r.status].map(csvCell).join(','));
  });

  var blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'profile-ids.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}

/* -------------------------------------------------------------------- render */

function render() {
  var found = state.results.filter(function (r) {
    return r.status === 'found' && r.id;
  });

  els.resultsWrap.hidden = state.results.length === 0;
  els.count.textContent = state.results.length
    ? '(' + found.length + ' found / ' + state.results.length + ')'
    : '';

  els.results.innerHTML = '';
  state.results.forEach(function (r) {
    els.results.appendChild(resultRow(r));
  });

  els.pushBtn.disabled = found.length === 0;
  els.copyBtn.disabled = found.length === 0;
  els.csvBtn.disabled = state.results.length === 0;
}

function resultRow(r) {
  var row = document.createElement('div');
  row.className = 'result ' + r.status;

  var main = document.createElement('div');
  main.className = 'result-main';

  var email = document.createElement('div');
  email.className = 'result-email';
  email.textContent = r.email || '';

  var meta = document.createElement('div');
  meta.className = 'result-meta';
  meta.textContent = statusText(r);

  main.appendChild(email);
  main.appendChild(meta);
  row.appendChild(main);

  if (r.status === 'found' && r.id) {
    var actions = document.createElement('div');
    actions.className = 'result-actions';

    var profile = document.createElement('a');
    profile.href = 'https://medxplain.eremedium.in/medxplain/' + r.id + '/';
    profile.target = '_blank';
    profile.rel = 'noopener';
    profile.textContent = 'Open profile ' + r.id;

    actions.appendChild(profile);
    row.appendChild(actions);
  }

  if (r.status === 'ambiguous' && Array.isArray(r.candidates)) {
    var list = document.createElement('div');
    list.className = 'candidates';

    r.candidates.slice(0, 8).forEach(function (c) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'candidate';
      btn.textContent = 'Use ID ' + c.id + (c.rowText ? ' — ' + c.rowText.slice(0, 60) : '');
      btn.addEventListener('click', function () {
        r.status = 'found';
        r.id = c.id;
        r.changeUrl = c.changeUrl;
        r.message = '';
        render();
        save();
      });
      list.appendChild(btn);
    });

    row.appendChild(list);
  }

  return row;
}

function statusText(r) {
  if (r.status === 'found') return 'ID ' + r.id;
  if (r.status === 'notfound') return 'Not found';
  if (r.status === 'ambiguous') return 'Multiple matches';
  if (r.status === 'login') return 'Login required';
  return r.message || 'Error';
}

/* -------------------------------------------------------------------- utils */

function extractEmails(text) {
  var found = String(text == null ? '' : text).match(EMAIL_RE) || [];
  var out = [];
  var seen = Object.create(null);

  for (var i = 0; i < found.length; i++) {
    var email = found[i].replace(/^[.,;:]+|[.,;:]+$/g, '');
    var key = email.toLowerCase();
    if (!seen[key]) {
      seen[key] = true;
      out.push(email);
    }
  }
  return out;
}

function clampDelay(value) {
  var n = parseInt(value, 10);
  if (!isFinite(n)) n = 700;
  return Math.min(5000, Math.max(200, n));
}

function setStatus(message, kind) {
  els.status.textContent = message;
  els.status.className = 'status ' + (kind || 'info');
}

function setProgress(fraction) {
  var pct = Math.max(0, Math.min(1, fraction)) * 100;
  els.bar.style.width = pct + '%';
}

function setRunningUI(running) {
  els.findBtn.disabled = running;
  els.stopBtn.disabled = !running;
  els.findBtn.textContent = running ? 'Finding…' : 'Find IDs';
}

function b64url(text) {
  var bytes = new TextEncoder().encode(text);
  var bin = '';
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function csvCell(value) {
  var s = String(value == null ? '' : value);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}
