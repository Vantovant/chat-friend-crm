/**
 * Vanto CRM — WhatsApp Web Content Script v4.0
 * MV3 compliant: ALL auth + API calls delegated to background.js via sendMessage.
 * This script only handles DOM detection and sidebar UI.
 */

'use strict';

// ── Config ─────────────────────────────────────────────────────────────────────
var SIDEBAR_ID = 'vanto-crm-sidebar';
var TOGGLE_ID  = 'vanto-crm-toggle';

// ── State ──────────────────────────────────────────────────────────────────────
var currentPhone    = null;
var currentName     = null;
var currentContact  = null;
var sidebarVisible  = true;
var detectionTimer  = null;
var headerObserver  = null;
var pollInterval    = null;
var lastDetectedKey = '';
var currentTags     = [];
var isAuthenticated = false; // updated from background
var teamMembers     = [];    // cached profiles list

// ── Logging ────────────────────────────────────────────────────────────────────
function log(msg, data) {
  if (data !== undefined) {
    console.log('[Vanto CRM]', msg, data);
  } else {
    console.log('[Vanto CRM]', msg);
  }
}

// ── Background bridge ──────────────────────────────────────────────────────────
function sendToBackground(message, callback) {
  try {
    chrome.runtime.sendMessage(message, function(response) {
      if (chrome.runtime.lastError) {
        log('Background error', chrome.runtime.lastError.message);
        if (callback) callback(null);
        return;
      }
      if (callback) callback(response);
    });
  } catch (e) {
    log('sendToBackground failed', e.message);
    if (callback) callback(null);
  }
}

// ── Auth state ─────────────────────────────────────────────────────────────────
function checkAuthState(callback) {
  sendToBackground({ type: 'VANTO_GET_SESSION' }, function(response) {
    isAuthenticated = !!(response && response.token);
    log('Auth state', isAuthenticated ? 'logged in' : 'not logged in');
    updateAuthBanner();
    if (callback) callback(isAuthenticated);
  });
}

// Listen for auth changes from background (login/logout in popup)
chrome.runtime.onMessage.addListener(function(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === 'VANTO_TOKEN_UPDATED') {
    isAuthenticated = true;
    log('Token updated — refreshing');
    updateAuthBanner();
    loadTeamMembers();
    runDetection();
  }
  if (msg.type === 'VANTO_TOKEN_CLEARED') {
    isAuthenticated = false;
    log('Token cleared');
    updateAuthBanner();
  }
});

// ── Save contact via background ────────────────────────────────────────────────
function saveContactViaBackground(payload, callback) {
  sendToBackground({ type: 'VANTO_SAVE_CONTACT', payload: payload }, function(response) {
    callback(response || { success: false, error: 'No response from background' });
  });
}

// ── Load contact via background ────────────────────────────────────────────────
function loadContactViaBackground(phone, callback) {
  sendToBackground({ type: 'VANTO_LOAD_CONTACT', phone: phone }, function(response) {
    callback(response || { success: false, error: 'No response' });
  });
}

// ── Load team members via background ──────────────────────────────────────────
function loadTeamMembers() {
  sendToBackground({ type: 'VANTO_LOAD_TEAM' }, function(response) {
    if (response && response.success && response.members) {
      teamMembers = response.members;
      renderAssignToDropdown();
    }
  });
}

function renderAssignToDropdown() {
  var sel = document.getElementById('vanto-f-assigned-to');
  if (!sel) return;
  var currentVal = sel.value || '';
  sel.innerHTML = '<option value="">— Unassigned —</option>';
  teamMembers.forEach(function(m) {
    var opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.full_name || m.email || m.id.slice(0,8);
    if (m.id === currentVal) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ── Phone sanitizer ────────────────────────────────────────────────────────────
function sanitizePhone(raw) {
  return (raw || '').replace(/\D/g, '');
}

// ── Extract whatsapp_id from DOM (the internal WA number, NOT user-entered) ────
// currentPhone is the WA-extracted digits (JID number). We keep it as whatsapp_id.
// The phone INPUT field contains what the user typed — that becomes payload.phone.
function getPhoneInputValue() {
  var el = document.getElementById('vanto-f-phone');
  return el ? (el.value || '').trim() : '';
}

// ── Auth banner ────────────────────────────────────────────────────────────────
function updateAuthBanner() {
  var banner = document.getElementById('vanto-auth-banner');
  if (!banner) return;
  banner.style.display = isAuthenticated ? 'none' : 'block';
}

// ── Chat detection ─────────────────────────────────────────────────────────────
function getActiveContactInfo() {
  var name  = null;
  var phone = null;

  var nameSelectors = [
    '[data-testid="conversation-header"] span[title]',
    '[data-testid="conversation-info-header-chat-title"] span',
    '[data-testid="conversation-info-header-chat-title"]',
    'header [data-testid="conversation-info-header"] span[title]',
    'header span[dir="auto"][title]',
    '#main header span[title]',
    '#main header span[dir="auto"]',
    '#main header > div > div > div > div span[title]',
  ];
  for (var i = 0; i < nameSelectors.length; i++) {
    var el = document.querySelector(nameSelectors[i]);
    if (el) {
      var t = el.getAttribute('title') || (el.textContent || '').trim();
      if (t && t.length > 0 && t.length < 200) { name = t; break; }
    }
  }

  // P0: #main data-id
  var mainPanel = document.getElementById('main');
  if (mainPanel) {
    var m = (mainPanel.getAttribute('data-id') || '').match(/(\d{7,15})@/);
    if (m) phone = m[1];
  }

  // P1: URL hash
  if (!phone) {
    var hm = window.location.hash.match(/\/chat\/(\d{7,15})@/);
    if (hm) phone = hm[1];
  }

  // P2: any [data-id] in #main
  if (!phone) {
    var els = document.querySelectorAll('#main [data-id]');
    for (var j = 0; j < els.length; j++) {
      var dm = (els[j].getAttribute('data-id') || '').match(/(\d{7,15})@/);
      if (dm) { phone = dm[1]; break; }
    }
  }

  // P3: subtitle spans with phone pattern
  if (!phone) {
    var subtitleSelectors = [
      '[data-testid="conversation-info-header"] span[dir="auto"]:not([title])',
      'header span[dir="ltr"]',
      '#main header span[dir="ltr"]',
    ];
    for (var k = 0; k < subtitleSelectors.length; k++) {
      var se = document.querySelector(subtitleSelectors[k]);
      var txt = (se && se.textContent && se.textContent.trim()) || '';
      if (/^\+?\d[\d\s\-(). ]{5,}$/.test(txt)) { phone = sanitizePhone(txt); break; }
    }
  }

  return { name: name || null, phone: phone ? sanitizePhone(phone) : null };
}

// ── Debounced detection ────────────────────────────────────────────────────────
function scheduleDetection() {
  clearTimeout(detectionTimer);
  detectionTimer = setTimeout(runDetection, 600);
}

function runDetection() {
  var info = getActiveContactInfo();
  var key  = info.name + '|' + info.phone;
  if (key === lastDetectedKey) return;
  lastDetectedKey = key;
  currentPhone = info.phone;
  currentName  = info.name;
  refreshSidebar(info.name, info.phone);
}

// ── Sidebar Refresh ────────────────────────────────────────────────────────────
function refreshSidebar(name, phone) {
  updateContactHeader(name, phone);
  updateAuthBanner();

  if (!name && !phone) {
    showNoChatState();
    return;
  }

  showFormBody();

  if (!isAuthenticated) {
    populateForm({ name: name || '', phone: phone || '', email: '', lead_type: 'prospect', temperature: 'cold', tags: [], notes: '' });
    showStatus('info', '🔐 Log in via the extension popup to save contacts');
    return;
  }

  if (!phone) {
    populateForm({ name: name || '', phone: '', email: '', lead_type: 'prospect', temperature: 'cold', tags: [], notes: '' });
    showStatus('info', '⚠️ Phone not detected — enter manually');
    setTimeout(clearStatus, 4000);
    return;
  }

  showStatus('loading', '⏳ Loading contact…');

  loadContactViaBackground(phone, function(response) {
    if (response && response.success) {
      currentContact = response.contact;
      if (response.contact) {
        populateForm(response.contact);
        showStatus('success', '✅ Contact loaded');
      } else {
        populateForm({ name: name || '', phone: phone, email: '', lead_type: 'prospect', temperature: 'cold', tags: [], notes: '' });
        showStatus('info', '📋 New contact — fill in and save');
      }
    } else {
      log('Load error', response && response.error);
      populateForm({ name: name || '', phone: phone, email: '', lead_type: 'prospect', temperature: 'cold', tags: [], notes: '' });
      showStatus('error', '❌ ' + ((response && response.error) || 'Load failed'));
    }
    setTimeout(clearStatus, 3500);
  });
}

// ── Header ─────────────────────────────────────────────────────────────────────
function updateContactHeader(name, phone) {
  var nameEl   = document.getElementById('vanto-hdr-name');
  var phoneEl  = document.getElementById('vanto-hdr-phone');
  var avatarEl = document.getElementById('vanto-avatar');
  if (nameEl)   nameEl.textContent  = name  || 'Select a chat';
  if (phoneEl)  phoneEl.textContent = phone ? '+' + phone : '—';
  if (avatarEl) avatarEl.textContent = (name || '?')[0].toUpperCase();
}

// ── Form populate ──────────────────────────────────────────────────────────────
function populateForm(data) {
  function setField(id, val) {
    var el = document.getElementById(id);
    if (!el) return;
    el.value    = val || '';
    el.disabled = false;
    el.readOnly = false;
  }
  setField('vanto-f-name',        data.name        || '');
  // Prefer phone_raw (user-entered) if available, otherwise empty so user fills it
  setField('vanto-f-phone',       data.phone_raw   || data.phone_normalized || '');
  setField('vanto-f-email',       data.email       || '');
  setField('vanto-f-lead-type',   data.lead_type   || 'prospect');
  setField('vanto-f-temperature', data.temperature || 'cold');
  setField('vanto-f-notes',       data.notes       || '');

  // Assign To
  var assignSel = document.getElementById('vanto-f-assigned-to');
  if (assignSel) assignSel.value = data.assigned_to || '';

  currentTags = Array.isArray(data.tags) ? data.tags.slice() : [];
  renderTags();
}

// ── Show/Hide states ───────────────────────────────────────────────────────────
function showNoChatState() {
  var nc = document.getElementById('vanto-no-chat');
  var fb = document.getElementById('vanto-form-body');
  if (nc) nc.style.display = 'flex';
  if (fb) fb.style.display = 'none';
  clearStatus();
}

function showFormBody() {
  var nc = document.getElementById('vanto-no-chat');
  var fb = document.getElementById('vanto-form-body');
  if (nc) nc.style.display = 'none';
  if (fb) fb.style.display = 'block';
}

// ── Tags ───────────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderTags() {
  var container = document.getElementById('vanto-tags-display');
  if (!container) return;
  if (currentTags.length === 0) {
    container.innerHTML = '<span style="color:hsl(215,20%,35%);font-size:11px;">No tags yet</span>';
  } else {
    container.innerHTML = currentTags.map(function(t) {
      return '<span class="vanto-tag-chip">' + escapeHtml(t) +
        '<button class="vanto-tag-remove" data-tag="' + escapeHtml(t) + '" title="Remove">×</button></span>';
    }).join('');
  }
  container.querySelectorAll('.vanto-tag-remove').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      currentTags = currentTags.filter(function(x) { return x !== btn.dataset.tag; });
      renderTags();
    });
  });
}

function addTag(raw) {
  var tag = raw.trim().toLowerCase().replace(/[^a-z0-9_\-]/g, '');
  if (tag && currentTags.indexOf(tag) === -1) {
    currentTags.push(tag);
    renderTags();
  }
}

// ── Status Banner ──────────────────────────────────────────────────────────────
function showStatus(type, msg) {
  var el = document.getElementById('vanto-status');
  if (!el) return;
  el.textContent = msg;
  el.className   = 'vanto-status show ' + type;
}

function clearStatus() {
  var el = document.getElementById('vanto-status');
  if (el) el.className = 'vanto-status';
}

// ── Save ───────────────────────────────────────────────────────────────────────
function handleSave() {
  if (!isAuthenticated) {
    showStatus('error', '🔐 Please log in via the extension popup first');
    setTimeout(clearStatus, 5000);
    return;
  }

  var nameEl  = document.getElementById('vanto-f-name');
  var phoneEl = document.getElementById('vanto-f-phone');
  var emailEl = document.getElementById('vanto-f-email');
  var ltEl    = document.getElementById('vanto-f-lead-type');
  var tempEl  = document.getElementById('vanto-f-temperature');
  var notesEl = document.getElementById('vanto-f-notes');

  // phone = what user typed in the Phone field (user-entered, human-readable)
  var userPhone = ((phoneEl && phoneEl.value) || '').trim();
  // whatsapp_id = WA internal number extracted from DOM (may be a JID number)
  var waId      = currentPhone || null; // currentPhone is always the DOM-extracted raw digits

  var name = ((nameEl && nameEl.value) || '').trim() || currentName || '';

  if (!userPhone && !waId) {
    showStatus('error', '❌ Phone number required — enter in the Phone field');
    setTimeout(clearStatus, 4000);
    return;
  }
  if (!name) {
    showStatus('error', '❌ Name is required');
    setTimeout(clearStatus, 3000);
    return;
  }

  var assignEl = document.getElementById('vanto-f-assigned-to');
  var assignedTo = (assignEl && assignEl.value) || null;

  var payload = {
    name:         name,
    phone:        userPhone || null,
    whatsapp_id:  waId      || null,
    email:        ((emailEl && emailEl.value) || '').trim() || null,
    lead_type:    (ltEl && ltEl.value)    || 'prospect',
    temperature:  (tempEl && tempEl.value) || 'cold',
    tags:         currentTags.slice(),
    notes:        ((notesEl && notesEl.value) || '').trim() || null,
    assigned_to:  assignedTo,
  };

  log('Saving contact via background', payload);

  var saveBtn = document.getElementById('vanto-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Saving…'; }
  showStatus('loading', '⏳ Saving contact…');

  saveContactViaBackground(payload, function(response) {
    if (response && response.success) {
      currentContact = response.contact;
      // Show the user-entered phone in the toast, not WA internal
      var displayPhone = (response.contact && response.contact.phone_raw) || userPhone || waId || '';
      showStatus('success', '✅ Saved: ' + name + ' • ' + displayPhone);
      if (saveBtn) saveBtn.textContent = '✅ Saved!';
      setTimeout(function() {
        if (saveBtn) { saveBtn.textContent = '💾 Save Contact'; saveBtn.disabled = false; }
        clearStatus();
      }, 2500);
    } else {
      var errCode = (response && response.error) || 'unknown';
      var errMsg;
      if (errCode === 'not_logged_in') {
        errMsg = '🔐 Session expired — log in via popup';
        isAuthenticated = false;
        updateAuthBanner();
      } else if (errCode === 'token_expired') {
        errMsg = '🔐 Token expired — please log in again';
        isAuthenticated = false;
        updateAuthBanner();
      } else if (errCode === 'network_timeout') {
        errMsg = '🌐 Network timeout — try again';
      } else {
        errMsg = '❌ ' + errCode;
      }
      log('Save error', errCode);
      showStatus('error', errMsg);
      if (saveBtn) { saveBtn.textContent = '💾 Save Contact'; saveBtn.disabled = false; }
      setTimeout(clearStatus, 5000);
    }
  });
}

// ── Sidebar HTML ───────────────────────────────────────────────────────────────
function buildSidebarHTML() {
  return [
    '<div id="' + SIDEBAR_ID + '">',

    '  <div class="vanto-header">',
    '    <span class="vanto-logo">⚡ Vanto CRM</span>',
    '    <button class="vanto-close" id="vanto-close-btn" title="Hide sidebar">✕</button>',
    '  </div>',

    '  <div id="vanto-auth-banner" style="display:none;padding:8px 12px;background:hsl(33,90%,12%);border-bottom:1px solid hsl(33,90%,25%);font-size:11px;color:hsl(33,90%,70%);">',
    '    🔐 Log in via the extension popup to save contacts.',
    '  </div>',

    '  <div class="vanto-contact-card">',
    '    <div class="vanto-avatar" id="vanto-avatar">?</div>',
    '    <div class="vanto-contact-meta">',
    '      <p class="vanto-contact-name-display" id="vanto-hdr-name">Select a chat</p>',
    '      <p class="vanto-contact-phone-display" id="vanto-hdr-phone">—</p>',
    '    </div>',
    '  </div>',

    '  <div class="vanto-status" id="vanto-status"></div>',

    '  <div class="vanto-body">',
    '    <div id="vanto-no-chat" class="vanto-no-chat">',
    '      <span class="vanto-no-chat-icon">💬</span>',
    '      <span>Open a WhatsApp chat to load or create a contact.</span>',
    '    </div>',

    '    <div id="vanto-form-body" style="display:none;">',

    '      <div class="vanto-section">',
    '        <p class="vanto-section-title">Contact Info</p>',
    '        <div class="vanto-field">',
    '          <label class="vanto-label" for="vanto-f-name">Full Name</label>',
    '          <input class="vanto-input" id="vanto-f-name" type="text" placeholder="e.g. Olivier Agnin" autocomplete="off" />',
    '        </div>',
    '        <div class="vanto-field">',
    '          <label class="vanto-label" for="vanto-f-phone">Phone Number</label>',
    '          <input class="vanto-input" id="vanto-f-phone" type="text" placeholder="e.g. 27821234567" autocomplete="off" />',
    '        </div>',
    '        <div class="vanto-field">',
    '          <label class="vanto-label" for="vanto-f-email">Email Address</label>',
    '          <input class="vanto-input" id="vanto-f-email" type="email" placeholder="email@example.com" autocomplete="off" />',
    '        </div>',
    '      </div>',

    '      <div class="vanto-section">',
    '        <p class="vanto-section-title">Lead Classification</p>',
    '        <div class="vanto-field">',
    '          <label class="vanto-label" for="vanto-f-lead-type">Lead Type</label>',
    '          <select class="vanto-select" id="vanto-f-lead-type">',
    '            <option value="prospect">Prospect</option>',
    '            <option value="registered">Registered_Nopurchase</option>',
    '            <option value="buyer">Purchase_Nostatus</option>',
    '            <option value="vip">Purchase_Status</option>',
    '            <option value="expired">Expired</option>',
    '          </select>',
    '        </div>',
    '        <div class="vanto-field">',
    '          <label class="vanto-label" for="vanto-f-temperature">Temperature</label>',
    '          <select class="vanto-select" id="vanto-f-temperature">',
    '            <option value="hot">🔥 Hot</option>',
    '            <option value="warm">🌤 Warm</option>',
    '            <option value="cold">❄️ Cold</option>',
    '          </select>',
    '        </div>',
    '      </div>',

     '      <div class="vanto-section">',
    '        <p class="vanto-section-title">Assignment</p>',
    '        <div class="vanto-field">',
    '          <label class="vanto-label" for="vanto-f-assigned-to">Assign To</label>',
    '          <select class="vanto-select" id="vanto-f-assigned-to">',
    '            <option value="">— Unassigned —</option>',
    '          </select>',
    '        </div>',
    '      </div>',

    '      <div class="vanto-section">',
    '        <p class="vanto-section-title">Tags</p>',
    '        <div class="vanto-tags-display" id="vanto-tags-display"></div>',
    '        <div style="display:flex;gap:6px;margin-top:6px;">',
    '          <input class="vanto-input" id="vanto-tag-input" type="text" placeholder="Add tag, press Enter" style="flex:1;" autocomplete="off" />',
    '          <button class="vanto-btn" id="vanto-tag-add" style="width:auto;padding:7px 12px;flex-shrink:0;">+</button>',
    '        </div>',
    '      </div>',

    '      <div class="vanto-section">',
    '        <p class="vanto-section-title">Notes</p>',
    '        <textarea class="vanto-textarea" id="vanto-f-notes" placeholder="Add notes about this contact…"></textarea>',
    '      </div>',

    '      <div class="vanto-section">',
    '        <button class="vanto-btn vanto-btn-primary" id="vanto-save-btn">💾 Save Contact</button>',
    '      </div>',

    '    </div>',
    '  </div>',

    '  <div class="vanto-footer">',
    '    <a href="https://chat-friend-crm.lovable.app" target="_blank" class="vanto-footer-link">Open Vanto Dashboard ↗</a>',
    '  </div>',

    '</div>',
  ].join('\n');
}

// ── Toggle Button ──────────────────────────────────────────────────────────────
function buildToggleButton() {
  var btn = document.createElement('button');
  btn.id    = TOGGLE_ID;
  btn.title = 'Open Vanto CRM';
  btn.innerHTML = '⚡';
  btn.addEventListener('click', showSidebar);
  return btn;
}

// ── Show/Hide Sidebar ──────────────────────────────────────────────────────────
function showSidebar() {
  var el = document.getElementById(SIDEBAR_ID);
  var tg = document.getElementById(TOGGLE_ID);
  if (el) el.style.display = 'flex';
  if (tg) tg.style.display = 'none';
  sidebarVisible = true;
}

function hideSidebar() {
  var el = document.getElementById(SIDEBAR_ID);
  var tg = document.getElementById(TOGGLE_ID);
  if (el) el.style.display = 'none';
  if (tg) tg.style.display = 'flex';
  sidebarVisible = false;
}

// ── Wire Events ────────────────────────────────────────────────────────────────
function wireEvents() {
  var closeBtn = document.getElementById('vanto-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', hideSidebar);

  var saveBtn = document.getElementById('vanto-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', handleSave);

  var tagAddBtn = document.getElementById('vanto-tag-add');
  if (tagAddBtn) {
    tagAddBtn.addEventListener('click', function() {
      var inp = document.getElementById('vanto-tag-input');
      if (inp && inp.value.trim()) { addTag(inp.value); inp.value = ''; inp.focus(); }
    });
  }

  var tagInput = document.getElementById('vanto-tag-input');
  if (tagInput) {
    tagInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (tagInput.value.trim()) { addTag(tagInput.value); tagInput.value = ''; }
      }
    });
  }

  // Prevent keyboard events from leaking to WhatsApp
  var sidebar = document.getElementById(SIDEBAR_ID);
  if (sidebar) {
    ['keydown', 'keyup', 'keypress', 'click'].forEach(function(evt) {
      sidebar.addEventListener(evt, function(e) { e.stopPropagation(); });
    });
  }
}

// ── MutationObserver ───────────────────────────────────────────────────────────
function watchChatChanges() {
  pollInterval = setInterval(function() { scheduleDetection(); }, 1500);

  var titleEl = document.querySelector('title');
  if (titleEl) {
    new MutationObserver(function() { scheduleDetection(); })
      .observe(titleEl, { childList: true, characterData: true, subtree: true });
  }

  new MutationObserver(function() { scheduleDetection(); })
    .observe(document.body, { childList: true, subtree: false });

  function tryAttachHeaderObserver() {
    var header =
      document.querySelector('#main header') ||
      document.querySelector('[data-testid="conversation-header"]') ||
      document.querySelector('header');

    if (header) {
      if (headerObserver) headerObserver.disconnect();
      headerObserver = new MutationObserver(function() { scheduleDetection(); });
      headerObserver.observe(header, { childList: true, subtree: true, characterData: true });
      log('Header observer attached');
    } else {
      setTimeout(tryAttachHeaderObserver, 1200);
    }
  }
  tryAttachHeaderObserver();
}

// ── Inject ─────────────────────────────────────────────────────────────────────
function injectSidebar() {
  if (document.getElementById(SIDEBAR_ID)) return;

  var wrapper = document.createElement('div');
  wrapper.innerHTML = buildSidebarHTML();
  document.body.appendChild(wrapper.firstElementChild);
  document.body.appendChild(buildToggleButton());

  wireEvents();
  watchChatChanges();

  // Check auth then trigger first detection
  checkAuthState(function() {
    if (isAuthenticated) loadTeamMembers();
    setTimeout(runDetection, 1200);
  });

  log('Sidebar injected v4.0');
}

// ── Boot ───────────────────────────────────────────────────────────────────────
function boot() {
  if (document.getElementById('app')) {
    setTimeout(injectSidebar, 1500);
    return;
  }
  var obs = new MutationObserver(function() {
    if (document.getElementById('app')) {
      obs.disconnect();
      setTimeout(injectSidebar, 1500);
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

boot();
