'use strict';

/* Medxplain Profile ID Finder - background worker
 *
 * Lets the QR app ask for IDs directly (one click in the app) while the popup
 * is closed. The searches still run in the logged-in admin tab through the
 * admin content script, so cookies and CSRF behave exactly like the popup.
 */

var ADMIN_URL = 'https://medxplain.eremedium.in/admin/userprofile/usersprofile/';
var ADMIN_PATTERN = 'https://medxplain.eremedium.in/admin/*';
var DELAY_MS = 500;

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || msg.type !== 'fetchIds') return;
  run(msg.emails || []).then(sendResponse).catch(function (err) {
    sendResponse({ ok: false, error: String((err && err.message) || err) });
  });
  return true;
});

async function run(emails) {
  var clean = [];
  var seen = Object.create(null);

  (emails || []).forEach(function (value) {
    var email = String(value || '').trim();
    if (!email) return;
    var key = email.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    clean.push(email);
  });

  if (!clean.length) return { ok: false, error: 'No email addresses were sent.' };

  var tab = await findAdminTab();
  await sendToAdmin(tab.id, { cmd: 'ping' });

  var results = [];

  for (var i = 0; i < clean.length; i++) {
    var email = clean[i];
    var result;

    try {
      result = await sendToAdmin(tab.id, { cmd: 'lookupOne', email: email });
    } catch (e) {
      result = { status: 'error', message: String((e && e.message) || e) };
    }

    if (!result) result = { status: 'error', message: 'No response from the admin tab.' };
    result.email = email;
    results.push(result);

    if (result.status === 'login') break;
    if (i < clean.length - 1) await sleep(DELAY_MS);
  }

  return { ok: true, results: results, tabId: tab.id };
}

async function findAdminTab() {
  var tabs = await chrome.tabs.query({ url: [ADMIN_PATTERN] });
  if (tabs.length) return tabs[0];

  var tab = await chrome.tabs.create({ url: ADMIN_URL, active: false });
  await waitForTab(tab.id);
  return tab;
}

function sendToAdmin(tabId, msg, retries) {
  retries = retries == null ? 6 : retries;

  return new Promise(function (resolve, reject) {
    var injected = false;

    function attempt(left) {
      chrome.tabs.sendMessage(tabId, msg, function (response) {
        var err = chrome.runtime.lastError;

        if (err) {
          // The tab may have been open before the extension was installed.
          if (!injected) {
            injected = true;
            chrome.scripting.executeScript(
              { target: { tabId: tabId }, files: ['content.js'] },
              function () {
                void chrome.runtime.lastError;
                setTimeout(function () { attempt(left); }, 250);
              }
            );
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

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}
