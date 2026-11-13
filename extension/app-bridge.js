'use strict';

/* Medxplain Profile ID Finder - app bridge
 *
 * Runs on the Profile QR Sender origin. The app posts a message, the bridge
 * forwards it to the background worker, and the results come back the same
 * way. This is what makes "Fetch IDs now" work with one click while the
 * extension popup stays closed.
 */
(function () {
  var EXT_SOURCE = 'profile-qr-extension';
  var APP_SOURCE = 'profile-qr-app';

  function announce() {
    window.postMessage({ source: EXT_SOURCE, type: 'ready' }, '*');
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;

    var data = event.data;
    if (!data || data.source !== APP_SOURCE) return;

    if (data.type === 'ping') {
      announce();
      return;
    }

    if (data.type !== 'fetchIds') return;

    var requestId = String(data.requestId || '');

    chrome.runtime.sendMessage(
      { type: 'fetchIds', emails: data.emails || [] },
      function (response) {
        void chrome.runtime.lastError;
        window.postMessage({
          source: EXT_SOURCE,
          type: 'results',
          requestId: requestId,
          response: response || { ok: false, error: 'No response from the extension.' }
        }, '*');
      }
    );
  });

  announce();
  setTimeout(announce, 400);
  setTimeout(announce, 1200);
})();
