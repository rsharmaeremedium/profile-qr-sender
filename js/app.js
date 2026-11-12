/* =========================================================================
   Profile QR Sender
   - extracts email IDs from pasted text / CSV
   - accepts a profile ID, admin URL or medxplain URL per row
   - builds https://medxplain.eremedium.in/medxplain/<id>/
   - renders QR codes locally and names the PNG <email>+<id>.png
   - downloads a ZIP, exports CSV, and shares files via the Web Share API
   ========================================================================= */
(function () {
  'use strict';

  // Same UTF-8 setup as QR-EREMEDIUM so output matches the reference site.
  if (typeof qrcode === 'function' && qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  }

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    emailInput: $('emailInput'),
    emailFile: $('emailFile'),
    addEmailsBtn: $('addEmailsBtn'),
    sampleBtn: $('sampleBtn'),
    clearEmailsBtn: $('clearEmailsBtn'),
    emailStats: $('emailStats'),

    filterInput: $('filterInput'),
    statusFilter: $('statusFilter'),
    pasteBtn: $('pasteBtn'),
    exportCsvBtn: $('exportCsvBtn'),
    generateAllBtn: $('generateAllBtn'),
    downloadZipBtn: $('downloadZipBtn'),
    profileList: $('profileList'),
    emptyState: $('emptyState'),

    baseUrl: $('baseUrl'),
    qrSize: $('qrSize'),
    qrEcl: $('qrEcl'),
    qrMargin: $('qrMargin'),
    qrMarginOut: $('qrMarginOut'),

    bookmarkletLink: $('bookmarkletLink'),
    copyBookmarkletBtn: $('copyBookmarkletBtn'),

    statTotal: $('statTotal'),
    statReady: $('statReady'),
    statSent: $('statSent'),
    statMissing: $('statMissing'),
    downloadZipBtn2: $('downloadZipBtn2'),
    shareNextBtn: $('shareNextBtn'),

    pasteDialog: $('pasteDialog'),
    pasteForm: $('pasteForm'),
    pairsPane: $('pairsPane'),
    orderedPane: $('orderedPane'),
    pairsInput: $('pairsInput'),
    orderedInput: $('orderedInput'),
    onlyEmpty: $('onlyEmpty'),
    applyPasteBtn: $('applyPasteBtn'),
    pasteError: $('pasteError'),

    shareDialog: $('shareDialog'),
    shareCanvas: $('shareCanvas'),
    shareText: $('shareText'),
    shareNativeBtn: $('shareNativeBtn'),
    shareDownloadBtn: $('shareDownloadBtn'),
    shareWhatsappBtn: $('shareWhatsappBtn'),
    shareWaLink: $('shareWaLink'),
    shareCloseBtn: $('shareCloseBtn'),

    installBtn: $('installBtn'),
    netBadge: $('netBadge'),
    toast: $('toast')
  };

  var STORAGE_KEY = 'profile-qr-sender-v1';
  var ADMIN_SEARCH = 'https://medxplain.eremedium.in/admin/userprofile/usersprofile/?q=';
  var DEFAULT_BASE = 'https://medxplain.eremedium.in/medxplain/';
  var EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  var EMAIL_ONE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

  var state = {
    rows: [],
    settings: {
      baseUrl: DEFAULT_BASE,
      size: 500,
      ecl: 'Q',
      margin: 2
    },
    filter: '',
    status: 'all',
    seq: 0
  };

  var saveTimer = null;
  var filterTimer = null;
  var marginTimer = null;
  var toastTimer = null;
  var installPrompt = null;
  var pendingShare = null;
  var pasteMode = 'pairs';
  var zipBusy = false;

  /* ======================================================================
     small helpers
     ====================================================================== */
  function toast(message, type) {
    els.toast.textContent = message;
    els.toast.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.className = 'toast' + (type ? ' ' + type : '');
    }, 4200);
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
  }

  function saveNow() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        rows: state.rows.map(function (r) {
          return { email: r.email, raw: r.raw, sent: !!r.sent };
        }),
        settings: state.settings,
        seq: state.seq
      }));
    } catch (e) {
      /* localStorage can be unavailable in private mode */
    }
  }

  function stamp() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function normalizeBase(base) {
    var s = String(base == null ? '' : base).trim();
    if (!s) s = DEFAULT_BASE;
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    if (s.charAt(s.length - 1) !== '/') s += '/';
    try { s = new URL(s).href; } catch (e) { /* keep the text */ }
    if (s.charAt(s.length - 1) !== '/') s += '/';
    return s;
  }

  function normalizeUrl(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    try {
      return new URL(s, 'https://medxplain.eremedium.in').href;
    } catch (e) {
      return s;
    }
  }

  function isReady(row) {
    return !!(row && row.profileId && row.url);
  }

  function rowByUid(uid) {
    var key = String(uid);
    for (var i = 0; i < state.rows.length; i++) {
      if (state.rows[i].uid === key) return state.rows[i];
    }
    return null;
  }

  function getCard(uid) {
    return els.profileList.querySelector('[data-uid="' + String(uid) + '"]');
  }

  function safeFileBase(email, id) {
    var s = String(email || '') + '+' + String(id || '');
    s = s
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, '');
    if (s.length > 180) s = s.slice(0, 180).replace(/[. ]+$/g, '');
    return s || 'qr';
  }

  function fileName(row) {
    return safeFileBase(row.email, row.profileId) + '.png';
  }

  function uniqueName(name, seen) {
    if (!seen.has(name)) {
      seen.add(name);
      return name;
    }
    var dot = name.lastIndexOf('.');
    var base = dot > 0 ? name.slice(0, dot) : name;
    var ext = dot > 0 ? name.slice(dot) : '';
    var n = 2;
    while (seen.has(base + ' (' + n + ')' + ext)) n++;
    var out = base + ' (' + n + ')' + ext;
    seen.add(out);
    return out;
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  function copyText(text, label) {
    var value = String(text == null ? '' : text);
    var done = function () { toast((label || 'Copied') + ' copied to clipboard.', 'ok'); };
    var fail = function () {
      var ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        done();
      } catch (e) {
        toast('Could not copy. Select the text manually.', 'error');
      }
      ta.remove();
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(done, fail);
    } else {
      fail();
    }
  }

  /* ======================================================================
     email + profile parsing
     ====================================================================== */
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

  function parseProfileInput(raw, baseUrl) {
    var value = String(raw == null ? '' : raw).trim();
    var base = normalizeBase(baseUrl);
    if (!value) return { id: '', url: '', error: '' };

    // A pasted file name like "user@example.com+123.png"
    var fileMatch = value.match(/^(.+?)\+(\d+)(?:\.png)?$/i);
    if (fileMatch && fileMatch[1].indexOf('@') !== -1 && !/^https?:/i.test(value)) {
      return { id: fileMatch[2], url: base + fileMatch[2] + '/', error: '' };
    }

    // Django admin change URL: /admin/userprofile/usersprofile/123/change/
    var m = value.match(/\/usersprofile\/(\d+)(?:[/?#]|$)/i);
    if (m) return { id: m[1], url: base + m[1] + '/', error: '' };

    // Medxplain profile URL: /medxplain/123/
    m = value.match(/\/medxplain\/(\d+)(?:[/?#]|$)/i);
    if (m) return { id: m[1], url: normalizeUrl(value), error: '' };

    // Bare numeric ID (optionally with a trailing slash)
    m = value.match(/^(\d+)\/?$/);
    if (m) return { id: m[1], url: base + m[1] + '/', error: '' };

    // Any other URL: keep it for the QR, but require a numeric last path segment
    // so the file name still has a profile ID.
    if (/^https?:\/\//i.test(value)) {
      try {
        var u = new URL(value);
        var segs = u.pathname.split('/').filter(Boolean);
        var last = segs.length ? segs[segs.length - 1] : '';
        if (/^\d+$/.test(last)) {
          return { id: last, url: u.href, error: '' };
        }
      } catch (e) { /* ignore */ }
      return { id: '', url: normalizeUrl(value), error: 'No numeric profile ID found in this URL.' };
    }

    // /medxplain/123/ without a protocol
    if (/^\/?medxplain\//i.test(value)) {
      var mm = value.match(/(\d+)/);
      if (mm) return { id: mm[1], url: normalizeUrl(value), error: '' };
    }

    return { id: '', url: '', error: 'Enter a profile ID or a profile URL.' };
  }

  function applyRaw(row) {
    var parsed = parseProfileInput(row.raw, state.settings.baseUrl);
    row.profileId = parsed.id;
    row.url = parsed.url;
    row.error = parsed.error || '';
  }

  function setRaw(row, raw, opts) {
    opts = opts || {};
    var value = String(raw == null ? '' : raw);
    if (value !== row.raw) row.sent = false;
    row.raw = value;
    applyRaw(row);

    if (opts.updateInput) {
      var cardForInput = getCard(row.uid);
      var input = cardForInput ? cardForInput.querySelector('.id-input') : null;
      if (input) input.value = row.raw;
    }

    var card = getCard(row.uid);
    if (card) updateCard(row, card);
    updateStats();
    updateButtons();
    saveSoon();
  }

  /* ======================================================================
     QR rendering
     ====================================================================== */
  function buildQR(text) {
    if (typeof qrcode !== 'function') {
      throw new Error('QR library did not load');
    }
    var qr = qrcode(0, state.settings.ecl);
    qr.addData(text);
    qr.make();
    return qr;
  }

  function renderExact(qr, canvas, targetPx) {
    var margin = state.settings.margin;
    var count = qr.getModuleCount();
    var total = count + margin * 2;
    var unit = Math.max(1, Math.floor(targetPx / total));
    var side = unit * total;

    canvas.width = side;
    canvas.height = side;

    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, side, side);
    ctx.fillStyle = '#000000';

    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect((c + margin) * unit, (r + margin) * unit, unit, unit);
        }
      }
    }

    if (targetPx > side) {
      var out = document.createElement('canvas');
      out.width = out.height = targetPx;
      var octx = out.getContext('2d');
      octx.imageSmoothingEnabled = false;
      octx.drawImage(canvas, 0, 0, targetPx, targetPx);

      canvas.width = canvas.height = targetPx;
      var ctx2 = canvas.getContext('2d');
      ctx2.imageSmoothingEnabled = false;
      ctx2.drawImage(out, 0, 0);
    }
  }

  function makeQRBlob(row) {
    return new Promise(function (resolve, reject) {
      try {
        var qr = buildQR(row.url);
        var canvas = document.createElement('canvas');
        renderExact(qr, canvas, state.settings.size);

        if (canvas.toBlob) {
          canvas.toBlob(function (blob) {
            if (blob) resolve(blob);
            else reject(new Error('PNG export failed'));
          }, 'image/png');
        } else {
          var dataUrl = canvas.toDataURL('image/png');
          var bin = atob(dataUrl.split(',')[1]);
          var bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          resolve(new Blob([bytes], { type: 'image/png' }));
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  function makeQRFile(row) {
    return makeQRBlob(row).then(function (blob) {
      return new File([blob], fileName(row), { type: 'image/png' });
    });
  }

  /* ======================================================================
     list rendering
     ====================================================================== */
  function filteredRows() {
    var q = state.filter.trim().toLowerCase();
    return state.rows.filter(function (row) {
      if (state.status === 'ready' && !isReady(row)) return false;
      if (state.status === 'missing' && isReady(row)) return false;
      if (state.status === 'sent' && !row.sent) return false;
      if (!q) return true;
      return row.email.toLowerCase().indexOf(q) !== -1 ||
        row.raw.toLowerCase().indexOf(q) !== -1 ||
        String(row.profileId || '').indexOf(q) !== -1;
    });
  }

  function setEmptyState(show, title, text) {
    els.emptyState.classList.toggle('show', !!show);
    if (show) {
      var h = els.emptyState.querySelector('h3');
      var p = els.emptyState.querySelector('p');
      if (h) h.textContent = title;
      if (p) p.textContent = text;
    }
  }

  function buildCard(row, index) {
    var card = document.createElement('article');
    card.className = 'profile-card';
    card.dataset.uid = row.uid;

    card.innerHTML =
      '<div class="pc-main">' +
        '<div class="pc-top">' +
          '<span class="pc-index"></span>' +
          '<span class="pc-email"></span>' +
          '<span class="status-pill missing">Need ID</span>' +
          '<button class="icon-btn" data-act="copy-email" type="button" title="Copy email" aria-label="Copy email">&#10697;</button>' +
        '</div>' +
        '<div class="pc-controls">' +
          '<input class="id-input" type="text" spellcheck="false" autocomplete="off" placeholder="Profile ID or URL">' +
          '<button class="btn btn-sm btn-ghost" data-act="paste" type="button">Paste</button>' +
          '<button class="btn btn-sm btn-ghost" data-act="search" type="button">Search admin</button>' +
          '<button class="btn btn-sm btn-ghost" data-act="open" type="button">Open</button>' +
          '<button class="icon-btn" data-act="clear" type="button" title="Clear this row" aria-label="Clear this row">&times;</button>' +
        '</div>' +
        '<div class="pc-meta">' +
          '<span class="filename"></span>' +
          '<button class="link-btn" data-act="copy-url" type="button" disabled>Copy URL</button>' +
        '</div>' +
      '</div>' +
      '<div class="pc-qr">' +
        '<div class="qr-frame">' +
          '<canvas class="qr-thumb" width="112" height="112" role="img" aria-label="QR code preview"></canvas>' +
          '<div class="qr-placeholder">Need ID</div>' +
        '</div>' +
        '<div class="qr-actions">' +
          '<button class="btn btn-sm btn-primary" data-act="download" type="button" disabled>PNG</button>' +
          '<button class="btn btn-sm btn-ghost" data-act="share" type="button" disabled>Share</button>' +
        '</div>' +
        '<label class="sent-check"><input class="sent-input" type="checkbox"> Sent</label>' +
      '</div>';

    var indexEl = card.querySelector('.pc-index');
    if (indexEl) indexEl.textContent = String(index + 1).padStart(2, '0');

    var emailEl = card.querySelector('.pc-email');
    if (emailEl) emailEl.textContent = row.email;

    var input = card.querySelector('.id-input');
    if (input) {
      input.value = row.raw;
      input.setAttribute('aria-label', 'Profile ID or URL for ' + row.email);
    }

    var sent = card.querySelector('.sent-input');
    if (sent) sent.checked = !!row.sent;

    updateCard(row, card);
    return card;
  }

  function updateCard(row, card) {
    if (!card) return;
    var ready = isReady(row);

    card.classList.toggle('is-ready', ready);
    card.classList.toggle('is-missing', !ready);
    card.classList.toggle('is-sent', !!row.sent);

    var pill = card.querySelector('.status-pill');
    if (pill) {
      if (row.sent) {
        pill.className = 'status-pill sent';
        pill.textContent = 'Sent';
      } else if (ready) {
        pill.className = 'status-pill ready';
        pill.textContent = 'Ready';
      } else {
        pill.className = 'status-pill missing';
        pill.textContent = row.error ? 'Check ID' : 'Need ID';
      }
    }

    var filenameEl = card.querySelector('.filename');
    if (filenameEl) {
      if (ready) {
        filenameEl.textContent = fileName(row);
        filenameEl.classList.remove('is-error');
      } else if (row.error) {
        filenameEl.textContent = row.error;
        filenameEl.classList.add('is-error');
      } else {
        filenameEl.textContent = 'Filename appears after a profile ID is added.';
        filenameEl.classList.remove('is-error');
      }
    }

    var copyUrl = card.querySelector('[data-act="copy-url"]');
    if (copyUrl) copyUrl.disabled = !ready;

    var input = card.querySelector('.id-input');
    if (input) input.classList.toggle('has-error', !!row.error);

    var frame = card.querySelector('.qr-frame');
    var canvas = card.querySelector('.qr-thumb');
    var placeholder = card.querySelector('.qr-placeholder');
    var downloadBtn = card.querySelector('[data-act="download"]');
    var shareBtn = card.querySelector('[data-act="share"]');

    if (ready) {
      try {
        var qr = buildQR(row.url);
        renderExact(qr, canvas, 160);
        if (frame) frame.classList.add('ready');
        if (placeholder) placeholder.textContent = 'QR ready';
        if (downloadBtn) downloadBtn.disabled = false;
        if (shareBtn) shareBtn.disabled = false;
      } catch (err) {
        if (frame) frame.classList.remove('ready');
        if (placeholder) placeholder.textContent = 'QR error';
        if (downloadBtn) downloadBtn.disabled = true;
        if (shareBtn) shareBtn.disabled = true;
        if (filenameEl) {
          filenameEl.textContent = 'Could not build QR: ' + (err && err.message ? err.message : err);
          filenameEl.classList.add('is-error');
        }
      }
    } else {
      if (frame) frame.classList.remove('ready');
      if (placeholder) placeholder.textContent = row.error ? 'Check ID' : 'Need ID';
      if (downloadBtn) downloadBtn.disabled = true;
      if (shareBtn) shareBtn.disabled = true;
    }

    var sentInput = card.querySelector('.sent-input');
    if (sentInput) sentInput.checked = !!row.sent;
  }

  function renderList() {
    var visible = filteredRows();
    var indexMap = new Map();
    state.rows.forEach(function (row, i) { indexMap.set(row.uid, i); });

    els.profileList.innerHTML = '';
    visible.forEach(function (row) {
      els.profileList.appendChild(buildCard(row, indexMap.get(row.uid) || 0));
    });

    if (!state.rows.length) {
      setEmptyState(true, 'No emails yet', 'Add a list of email IDs above to get started.');
    } else if (!visible.length) {
      setEmptyState(true, 'No matching rows', 'Try a different search or status filter.');
    } else {
      setEmptyState(false, '', '');
    }

    updateStats();
    updateButtons();
  }

  function refreshAllPreviews() {
    var cards = els.profileList.querySelectorAll('.profile-card');
    Array.prototype.forEach.call(cards, function (card) {
      var row = rowByUid(card.dataset.uid);
      if (row) updateCard(row, card);
    });
  }

  function updateStats() {
    var total = state.rows.length;
    var ready = 0;
    var sent = 0;
    state.rows.forEach(function (row) {
      if (isReady(row)) ready++;
      if (row.sent) sent++;
    });
    var missing = total - ready;

    els.emailStats.textContent = total + ' email' + (total === 1 ? '' : 's') +
      ' \u00B7 ' + ready + ' ready \u00B7 ' + missing + ' missing ID' +
      (sent ? ' \u00B7 ' + sent + ' sent' : '');

    els.statTotal.textContent = String(total);
    els.statReady.textContent = String(ready);
    els.statSent.textContent = String(sent);
    els.statMissing.textContent = String(missing);
  }

  function updateButtons() {
    var ready = 0;
    var unsent = 0;
    state.rows.forEach(function (row) {
      if (isReady(row)) {
        ready++;
        if (!row.sent) unsent++;
      }
    });

    var zipDisabled = ready === 0 || zipBusy;
    els.downloadZipBtn.disabled = zipDisabled;
    els.downloadZipBtn2.disabled = zipDisabled;
    els.shareNextBtn.disabled = unsent === 0;
  }

  /* ======================================================================
     adding / clearing emails
     ====================================================================== */
  function addEmailsFromText(text) {
    var emails = extractEmails(text);
    if (!emails.length) {
      toast('No email addresses found in that text.', 'error');
      return 0;
    }

    var existing = Object.create(null);
    state.rows.forEach(function (row) { existing[row.email.toLowerCase()] = true; });

    var added = 0;
    emails.forEach(function (email) {
      var key = email.toLowerCase();
      if (existing[key]) return;
      existing[key] = true;
      state.rows.push({
        uid: String(++state.seq),
        email: email,
        raw: '',
        profileId: '',
        url: '',
        error: '',
        sent: false
      });
      added++;
    });

    if (added) {
      renderList();
      saveSoon();
      var skipped = emails.length - added;
      toast(added + ' email' + (added === 1 ? '' : 's') + ' added' +
        (skipped ? ' \u00B7 ' + skipped + ' duplicate' + (skipped === 1 ? '' : 's') + ' skipped' : '') + '.', 'ok');
    } else {
      toast('Those email addresses are already in the list.', 'error');
    }
    return added;
  }

  function addSampleRows() {
    var samples = [
      ['dr.rao@example.com', '101'],
      ['dr.mehta@example.com', '102'],
      ['dr.khan@example.com', '103']
    ];
    var existing = Object.create(null);
    state.rows.forEach(function (row) { existing[row.email.toLowerCase()] = true; });

    var added = 0;
    samples.forEach(function (pair) {
      if (existing[pair[0]]) return;
      existing[pair[0]] = true;
      var row = {
        uid: String(++state.seq),
        email: pair[0],
        raw: pair[1],
        profileId: '',
        url: '',
        error: '',
        sent: false
      };
      applyRaw(row);
      state.rows.push(row);
      added++;
    });

    renderList();
    saveNow();
    toast(added ? added + ' sample row' + (added === 1 ? '' : 's') + ' added.' : 'Sample rows are already in the list.',
      added ? 'ok' : 'error');
  }

  function clearAll() {
    if (!state.rows.length) return;
    if (!window.confirm('Remove all emails, profile IDs and sent marks? This cannot be undone.')) return;
    state.rows = [];
    renderList();
    saveNow();
    toast('Cleared all rows.', 'ok');
  }

  function handleFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var added = addEmailsFromText(String(reader.result || ''));
      if (added) els.emailInput.value = '';
    };
    reader.onerror = function () { toast('Could not read that file.', 'error'); };
    reader.readAsText(file);
  }

  /* ======================================================================
     bulk paste
     ====================================================================== */
  function setPasteMode(mode) {
    pasteMode = mode === 'ordered' ? 'ordered' : 'pairs';
    var tabs = els.pasteDialog.querySelectorAll('.tab');
    Array.prototype.forEach.call(tabs, function (tab) {
      var on = tab.dataset.mode === pasteMode;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    els.pairsPane.hidden = pasteMode !== 'pairs';
    els.orderedPane.hidden = pasteMode !== 'ordered';
    els.pasteError.hidden = true;
  }

  function showPasteError(message) {
    els.pasteError.textContent = message;
    els.pasteError.hidden = false;
  }

  function openPasteDialog() {
    els.pasteError.hidden = true;
    els.pairsInput.value = '';
    els.orderedInput.value = '';
    setPasteMode('pairs');
    if (!els.pasteDialog.open) els.pasteDialog.showModal();
    setTimeout(function () { els.pairsInput.focus(); }, 50);
  }

  function cleanPastedValue(value) {
    var s = String(value == null ? '' : value).trim();
    var url = s.match(/https?:\/\/\S+/i);
    if (url) return url[0].replace(/[),;]+$/g, '');
    var id = s.match(/^\+?(\d{2,})\b/);
    if (id) return id[1];
    return s.replace(/^[+,\s]+/, '').trim();
  }

  function applyPairs(text) {
    var lines = String(text || '').split(/\r?\n/);
    var byEmail = Object.create(null);
    state.rows.forEach(function (row) { byEmail[row.email.toLowerCase()] = row; });

    var applied = 0;
    var added = 0;
    var skipped = 0;

    lines.forEach(function (rawLine) {
      var line = rawLine.trim();
      if (!line || line.charAt(0) === '#') return;

      var match = line.match(EMAIL_ONE);
      if (!match) {
        skipped++;
        return;
      }

      var email = match[0];
      var after = line.slice(match.index + match[0].length).replace(/^[\s,;|\t]+/, '').trim();
      var before = line.slice(0, match.index).replace(/[\s,;|\t]+$/, '').trim();
      var value = cleanPastedValue(after || before);

      if (!value) {
        skipped++;
        return;
      }

      var row = byEmail[email.toLowerCase()];
      if (!row) {
        row = {
          uid: String(++state.seq),
          email: email,
          raw: '',
          profileId: '',
          url: '',
          error: '',
          sent: false
        };
        state.rows.push(row);
        byEmail[email.toLowerCase()] = row;
        added++;
      }

      row.raw = value;
      row.sent = false;
      applyRaw(row);
      if (isReady(row)) applied++;
      else skipped++;
    });

    return { applied: applied, added: added, skipped: skipped };
  }

  function applyOrdered(text) {
    var values = String(text || '').split(/\r?\n/)
      .map(function (line) { return line.trim(); })
      .filter(function (line) { return line && line.charAt(0) !== '#'; })
      .map(cleanPastedValue);

    if (!values.length) return { applied: 0, total: 0, error: 'Paste at least one profile ID or URL.' };

    var rows = filteredRows();
    if (els.onlyEmpty.checked) rows = rows.filter(function (row) { return !isReady(row); });

    if (!rows.length) {
      return { applied: 0, total: values.length, error: 'No rows to fill with the current filter.' };
    }

    var count = Math.min(rows.length, values.length);
    for (var i = 0; i < count; i++) {
      rows[i].raw = values[i];
      rows[i].sent = false;
      applyRaw(rows[i]);
    }

    return { applied: count, total: values.length, error: '' };
  }

  function applyPaste() {
    els.pasteError.hidden = true;

    if (pasteMode === 'pairs') {
      var result = applyPairs(els.pairsInput.value);
      if (!result.applied && !result.added) {
        showPasteError('No valid "email, profile ID or URL" lines found. Check the format and try again.');
        return;
      }
      els.pasteDialog.close();
      renderList();
      saveNow();
      toast(result.applied + ' row' + (result.applied === 1 ? '' : 's') + ' mapped' +
        (result.added ? ' \u00B7 ' + result.added + ' email' + (result.added === 1 ? '' : 's') + ' added' : '') +
        (result.skipped ? ' \u00B7 ' + result.skipped + ' line' + (result.skipped === 1 ? '' : 's') + ' skipped' : '') + '.',
        'ok');
      return;
    }

    var ordered = applyOrdered(els.orderedInput.value);
    if (ordered.error) {
      showPasteError(ordered.error);
      return;
    }
    els.pasteDialog.close();
    renderList();
    saveNow();
    toast(ordered.applied + ' row' + (ordered.applied === 1 ? '' : 's') + ' filled' +
      (ordered.total > ordered.applied ? ' \u00B7 ' + (ordered.total - ordered.applied) + ' extra value' +
        (ordered.total - ordered.applied === 1 ? '' : 's') + ' ignored' : '') + '.', 'ok');
  }

  /* ======================================================================
     download / export
     ====================================================================== */
  function downloadRow(row) {
    if (!isReady(row)) {
      toast('Add a profile ID first.', 'error');
      return Promise.resolve();
    }
    return makeQRBlob(row).then(function (blob) {
      downloadBlob(blob, fileName(row));
      toast('Saved ' + fileName(row), 'ok');
    }).catch(function (err) {
      toast('Could not create the PNG: ' + (err && err.message ? err.message : err), 'error');
    });
  }

  function downloadZip() {
    if (zipBusy) return;
    if (typeof QRZip === 'undefined') {
      toast('ZIP library did not load. Try a single PNG download instead.', 'error');
      return;
    }

    var rows = state.rows.filter(isReady);
    if (!rows.length) {
      toast('No rows are ready yet.', 'error');
      return;
    }

    zipBusy = true;
    updateButtons();
    var oldTop = els.downloadZipBtn.textContent;
    els.downloadZipBtn.textContent = 'Preparing...';

    var files = [];
    var seen = new Set();
    var failed = 0;

    var chain = Promise.resolve();
    rows.forEach(function (row, index) {
      chain = chain.then(function () {
        els.downloadZipBtn.textContent = 'Preparing ' + (index + 1) + '/' + rows.length + '...';
        els.downloadZipBtn2.textContent = 'Preparing ' + (index + 1) + '/' + rows.length + '...';
        return makeQRBlob(row).then(function (blob) {
          return blob.arrayBuffer();
        }).then(function (buffer) {
          var name = uniqueName(fileName(row), seen);
          files.push({ name: name, data: new Uint8Array(buffer) });
        }).catch(function (err) {
          failed++;
          console.warn('QR failed for ' + row.email, err);
        });
      });
    });

    chain.then(function () {
      if (!files.length) throw new Error('No QR files could be generated.');
      var zip = QRZip.create(files);
      downloadBlob(zip, 'profile-qr-' + stamp() + '.zip');
      toast('Downloaded ' + files.length + ' QR code' + (files.length === 1 ? '' : 's') +
        (failed ? ' \u00B7 ' + failed + ' failed' : '') + '.', 'ok');
    }).catch(function (err) {
      toast('Could not build the ZIP: ' + (err && err.message ? err.message : err), 'error');
    }).then(function () {
      zipBusy = false;
      els.downloadZipBtn.textContent = oldTop;
      els.downloadZipBtn2.textContent = 'Download all PNGs (.zip)';
      updateButtons();
    });
  }

  function csvEscape(value) {
    var s = String(value == null ? '' : value);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportCsv() {
    if (!state.rows.length) {
      toast('No rows to export.', 'error');
      return;
    }
    var lines = ['email,profile_id,qr_url,filename,sent'];
    state.rows.forEach(function (row) {
      lines.push([
        row.email,
        row.profileId,
        row.url,
        isReady(row) ? fileName(row) : '',
        row.sent ? 'yes' : 'no'
      ].map(csvEscape).join(','));
    });
    var blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, 'profile-qr-map.csv');
    toast('CSV exported.', 'ok');
  }

  /* ======================================================================
     sharing
     ====================================================================== */
  function canShareFiles(file) {
    if (!navigator.canShare || !navigator.share) return false;
    try {
      return navigator.canShare({ files: [file] });
    } catch (e) {
      return false;
    }
  }

  function markSent(row, value) {
    row.sent = !!value;
    var card = getCard(row.uid);
    if (card) updateCard(row, card);
    updateStats();
    updateButtons();
    saveSoon();
  }

  function openWhatsApp(row) {
    var text = 'Medxplain profile QR for ' + row.email + '\n' + row.url;
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }

  function closeShareDialog() {
    if (els.shareDialog.open) els.shareDialog.close();
    pendingShare = null;
  }

  function openShareDialog(row, file) {
    pendingShare = { row: row, file: file };

    try {
      var qr = buildQR(row.url);
      renderExact(qr, els.shareCanvas, 220);
    } catch (e) { /* leave the previous preview */ }

    els.shareText.textContent = file.name + '\n' + row.url;
    els.shareWaLink.href = 'https://wa.me/?text=' + encodeURIComponent('Medxplain profile QR for ' + row.email + '\n' + row.url);

    var native = canShareFiles(file);
    els.shareNativeBtn.hidden = !native;
    if (!els.shareDialog.open) els.shareDialog.showModal();
  }

  function nativeSharePending() {
    if (!pendingShare) return;
    if (!navigator.share) {
      toast('This browser cannot share files. Download the PNG instead.', 'error');
      return;
    }
    var row = pendingShare.row;
    var file = pendingShare.file;

    navigator.share({
      files: [file],
      title: file.name,
      text: 'Medxplain profile QR for ' + row.email
    }).then(function () {
      markSent(row, true);
      closeShareDialog();
      toast('Shared. Marked as sent.', 'ok');
    }).catch(function (err) {
      if (err && err.name === 'AbortError') return;
      toast('Share failed. Download the PNG and attach it in WhatsApp instead.', 'error');
    });
  }

  function shareRow(row) {
    if (!isReady(row)) {
      toast('Add a profile ID first.', 'error');
      return Promise.resolve();
    }

    return makeQRFile(row).then(function (file) {
      if (canShareFiles(file)) {
        return navigator.share({
          files: [file],
          title: file.name,
          text: 'Medxplain profile QR for ' + row.email
        }).then(function () {
          markSent(row, true);
          toast('Shared. Marked as sent.', 'ok');
        }).catch(function (err) {
          if (err && err.name === 'AbortError') return;
          openShareDialog(row, file);
        });
      }
      openShareDialog(row, file);
    }).catch(function (err) {
      toast('Could not prepare the QR: ' + (err && err.message ? err.message : err), 'error');
    });
  }

  function shareNext() {
    var row = null;
    for (var i = 0; i < state.rows.length; i++) {
      if (isReady(state.rows[i]) && !state.rows[i].sent) { row = state.rows[i]; break; }
    }
    if (!row) {
      for (var j = 0; j < state.rows.length; j++) {
        if (isReady(state.rows[j])) { row = state.rows[j]; break; }
      }
    }
    if (!row) {
      toast('No ready rows to share.', 'error');
      return;
    }
    var card = getCard(row.uid);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    shareRow(row);
  }

  /* ======================================================================
     settings + bookmarklet
     ====================================================================== */
  function loadSettingsUI() {
    els.baseUrl.value = state.settings.baseUrl;
    els.qrSize.value = String(state.settings.size);
    els.qrEcl.value = state.settings.ecl;
    els.qrMargin.value = String(state.settings.margin);
    els.qrMarginOut.textContent = String(state.settings.margin);
  }

  function onSettingsChange() {
    var newBase = normalizeBase(els.baseUrl.value);
    var baseChanged = newBase !== state.settings.baseUrl;

    state.settings.baseUrl = newBase;
    state.settings.size = parseInt(els.qrSize.value, 10) || 500;
    state.settings.ecl = els.qrEcl.value || 'Q';
    state.settings.margin = parseInt(els.qrMargin.value, 10) || 0;

    els.baseUrl.value = newBase;
    els.qrMarginOut.textContent = String(state.settings.margin);

    if (baseChanged) {
      state.rows.forEach(function (row) { applyRaw(row); });
      renderList();
      buildBookmarklet();
    } else {
      refreshAllPreviews();
    }
    saveSoon();
  }

  function buildBookmarklet() {
    var base = state.settings.baseUrl;
    var code = 'javascript:(()=>{' +
      'const a=document.querySelector(\'#result_list tbody tr a[href*="/usersprofile/"]\')||' +
        'document.querySelector(\'a[href*="/usersprofile/"][href*="/change/"]\');' +
      'if(!a){alert("No profile link found on this page.");return}' +
      'const m=a.href.match(/\\/usersprofile\\/(\\d+)/);' +
      'if(!m){alert("Could not read the profile ID.");return}' +
      'const url=' + JSON.stringify(base) + '+m[1]+"/";' +
      'navigator.clipboard.writeText(url).then(' +
        '()=>alert("Copied: "+url),' +
        '()=>prompt("Copy this URL",url)' +
      ');' +
    '})();';

    els.bookmarkletLink.href = code;
    els.bookmarkletLink.dataset.code = code;
  }

  /* ======================================================================
     load state
     ====================================================================== */
  function loadState() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { saved = null; }
    if (!saved) return;

    if (saved.settings && typeof saved.settings === 'object') {
      state.settings.baseUrl = normalizeBase(saved.settings.baseUrl || DEFAULT_BASE);
      state.settings.size = parseInt(saved.settings.size, 10) || 500;
      state.settings.ecl = saved.settings.ecl || 'Q';
      state.settings.margin = parseInt(saved.settings.margin, 10) || 0;
    }

    if (Array.isArray(saved.rows)) {
      saved.rows.forEach(function (item) {
        if (!item || !item.email) return;
        var row = {
          uid: String(++state.seq),
          email: String(item.email),
          raw: String(item.raw == null ? '' : item.raw),
          profileId: '',
          url: '',
          error: '',
          sent: !!item.sent
        };
        applyRaw(row);
        state.rows.push(row);
      });
    }

    if (saved.seq && Number(saved.seq) > state.seq) state.seq = Number(saved.seq);
  }

  /* ======================================================================
     events
     ====================================================================== */
  function bindEvents() {
    els.addEmailsBtn.addEventListener('click', function () {
      var added = addEmailsFromText(els.emailInput.value);
      if (added) els.emailInput.value = '';
    });

    els.emailInput.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        var added = addEmailsFromText(els.emailInput.value);
        if (added) els.emailInput.value = '';
      }
    });

    els.emailFile.addEventListener('change', function () {
      var file = els.emailFile.files && els.emailFile.files[0];
      handleFile(file);
      els.emailFile.value = '';
    });

    els.sampleBtn.addEventListener('click', addSampleRows);
    els.clearEmailsBtn.addEventListener('click', clearAll);

    els.filterInput.addEventListener('input', function () {
      state.filter = els.filterInput.value;
      clearTimeout(filterTimer);
      filterTimer = setTimeout(renderList, 140);
    });

    els.statusFilter.addEventListener('change', function () {
      state.status = els.statusFilter.value;
      renderList();
    });

    els.pasteBtn.addEventListener('click', openPasteDialog);
    els.exportCsvBtn.addEventListener('click', exportCsv);
    els.generateAllBtn.addEventListener('click', function () {
      var ready = state.rows.filter(isReady);
      if (!ready.length) {
        toast('No rows are ready yet.', 'error');
        return;
      }
      refreshAllPreviews();
      toast('Generated ' + ready.length + ' QR code' + (ready.length === 1 ? '' : 's') + '.', 'ok');
    });

    els.downloadZipBtn.addEventListener('click', downloadZip);
    els.downloadZipBtn2.addEventListener('click', downloadZip);
    els.shareNextBtn.addEventListener('click', shareNext);

    els.profileList.addEventListener('input', function (e) {
      var input = e.target.closest ? e.target.closest('.id-input') : null;
      if (!input) return;
      var card = input.closest('.profile-card');
      if (!card) return;
      var row = rowByUid(card.dataset.uid);
      if (!row) return;
      setRaw(row, input.value);
    });

    els.profileList.addEventListener('change', function (e) {
      if (!e.target.classList || !e.target.classList.contains('sent-input')) return;
      var card = e.target.closest('.profile-card');
      if (!card) return;
      var row = rowByUid(card.dataset.uid);
      if (!row) return;
      markSent(row, e.target.checked);
    });

    els.profileList.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!btn) return;
      var card = btn.closest('.profile-card');
      if (!card) return;
      var row = rowByUid(card.dataset.uid);
      if (!row) return;
      var act = btn.dataset.act;

      if (act === 'copy-email') {
        copyText(row.email, 'Email');
      } else if (act === 'paste') {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
          toast('Clipboard read is not available in this browser. Paste manually.', 'error');
          return;
        }
        navigator.clipboard.readText().then(function (text) {
          if (!text) {
            toast('Clipboard is empty.', 'error');
            return;
          }
          setRaw(row, cleanPastedValue(text), { updateInput: true });
          toast('Pasted from clipboard.', 'ok');
        }).catch(function () {
          toast('Clipboard read was blocked. Paste manually into the field.', 'error');
        });
      } else if (act === 'search') {
        window.open(ADMIN_SEARCH + encodeURIComponent(row.email), '_blank', 'noopener');
      } else if (act === 'open') {
        if (!isReady(row)) {
          toast('Add a profile ID first.', 'error');
          return;
        }
        window.open(row.url, '_blank', 'noopener');
      } else if (act === 'clear') {
        setRaw(row, '', { updateInput: true });
        toast('Row cleared.', 'ok');
      } else if (act === 'copy-url') {
        if (!isReady(row)) {
          toast('No profile URL yet.', 'error');
          return;
        }
        copyText(row.url, 'Profile URL');
      } else if (act === 'download') {
        downloadRow(row);
      } else if (act === 'share') {
        shareRow(row);
      }
    });

    els.baseUrl.addEventListener('change', onSettingsChange);
    els.baseUrl.addEventListener('blur', onSettingsChange);
    els.qrSize.addEventListener('change', onSettingsChange);
    els.qrEcl.addEventListener('change', onSettingsChange);
    els.qrMargin.addEventListener('input', function () {
      els.qrMarginOut.textContent = els.qrMargin.value;
      clearTimeout(marginTimer);
      marginTimer = setTimeout(onSettingsChange, 160);
    });

    els.bookmarkletLink.addEventListener('click', function (e) {
      e.preventDefault();
      toast('Drag this button to your bookmarks bar, then click it on the admin page.');
    });
    els.copyBookmarkletBtn.addEventListener('click', function () {
      copyText(els.bookmarkletLink.dataset.code || els.bookmarkletLink.href, 'Bookmarklet code');
    });

    var tabs = els.pasteDialog.querySelectorAll('.tab');
    Array.prototype.forEach.call(tabs, function (tab) {
      tab.addEventListener('click', function () { setPasteMode(tab.dataset.mode); });
    });
    els.applyPasteBtn.addEventListener('click', applyPaste);

    els.shareNativeBtn.addEventListener('click', nativeSharePending);
    els.shareDownloadBtn.addEventListener('click', function () {
      if (!pendingShare) return;
      downloadBlob(pendingShare.file, pendingShare.file.name);
      toast('PNG downloaded. Attach it in WhatsApp as a document.', 'ok');
    });
    els.shareWhatsappBtn.addEventListener('click', function () {
      if (pendingShare) openWhatsApp(pendingShare.row);
    });
    els.shareCloseBtn.addEventListener('click', closeShareDialog);

    [els.pasteDialog, els.shareDialog].forEach(function (dialog) {
      dialog.addEventListener('click', function (e) {
        if (e.target === dialog) dialog.close();
      });
    });
    els.shareDialog.addEventListener('close', function () { pendingShare = null; });

    els.installBtn.addEventListener('click', function () {
      if (!installPrompt) return;
      installPrompt.prompt();
      installPrompt.userChoice.then(function () {
        installPrompt = null;
        els.installBtn.hidden = true;
      }, function () {
        installPrompt = null;
        els.installBtn.hidden = true;
      });
    });

    window.addEventListener('online', updateNet);
    window.addEventListener('offline', updateNet);

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      installPrompt = e;
      els.installBtn.hidden = false;
    });
    window.addEventListener('appinstalled', function () {
      els.installBtn.hidden = true;
      toast('App installed.', 'ok');
    });
  }

  function updateNet() {
    var online = navigator.onLine;
    els.netBadge.textContent = online ? 'Online' : 'Offline';
    els.netBadge.className = 'badge ' + (online ? 'badge-ok' : 'badge-warn');
    els.netBadge.title = online ? 'Online' : 'Offline \u2014 the app still works from its cache';
  }

  /* ======================================================================
     service worker
     ====================================================================== */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' &&
        location.hostname !== 'localhost' &&
        location.hostname !== '127.0.0.1') return;

    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (err) {
        console.warn('Service worker registration failed:', err);
      });
    });
  }

  /* ======================================================================
     init
     ====================================================================== */
  function init() {
    loadState();
    loadSettingsUI();
    bindEvents();
    buildBookmarklet();
    renderList();
    updateNet();
    registerServiceWorker();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
