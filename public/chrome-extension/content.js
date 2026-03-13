/**
 * Vanto CRM — WhatsApp Web Content Script v5.0
 * MV3 compliant: ALL auth + API calls delegated to background.js via sendMessage.
 * This script handles DOM detection, sidebar UI, group capture, and auto-poster execution.
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
var isAuthenticated = false;
var teamMembers     = [];
var isGroupChat     = false;

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

// Listen for auth changes and group post execution commands from background
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
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

  // ── Auto-poster execution engine ──────────────────────────────────────────
  if (msg.type === 'VANTO_EXECUTE_GROUP_POST') {
    log('Executing group post:', msg.groupName);
    // Check if WhatsApp main pane is ready
    var mainApp = document.getElementById('app') || document.getElementById('main');
    if (!mainApp) {
      sendResponse({ success: false, error: 'WhatsApp Web not fully loaded', stage: 'poll' });
      return true;
    }
    executeGroupPostInDOM(msg.groupName, msg.messageContent, function(result) {
      sendResponse(result);
    });
    return true; // async response
  }
});

// ── Execute group post in WhatsApp DOM ─────────────────────────────────────────
function executeGroupPostInDOM(groupName, messageContent, callback) {
  log('executeGroupPostInDOM started for group:', groupName);

  // Helper: try multiple selectors and return first match
  function findElement(selectors, label) {
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) return el;
    }
    console.log('[Vanto CRM] DOM element missing: ' + label + ' — tried selectors:', selectors.join(', '));
    return null;
  }

  // Step A: Open search
  var searchInput = findElement([
    '[data-testid="chat-list-search-input"]',
    'div[contenteditable="true"][data-tab="3"]',
    'div[contenteditable="true"][role="textbox"][title="Search input textbox"]',
  ], 'search-input');

  if (!searchInput) {
    var searchIcon = findElement([
      '[data-testid="chat-list-search"]',
      '[data-icon="search"]',
      'button[aria-label="Search"]',
      'header button span[data-icon="search"]',
    ], 'search-icon');
    if (searchIcon) {
      (searchIcon.closest('button') || searchIcon).click();
    } else {
      log('DOM element missing: search-icon — cannot open search');
      sendToBackground({ type: 'VANTO_GROUP_POST_FAILED', groupName: groupName, error: 'Search icon not found in DOM' });
      callback({ success: false, error: 'Search icon not found in DOM', stage: 'find_group' });
      return;
    }
  }

  setTimeout(function() {
    var input = findElement([
      '[data-testid="chat-list-search-input"]',
      'div[contenteditable="true"][data-tab="3"]',
      'div[contenteditable="true"][role="textbox"][title="Search input textbox"]',
    ], 'search-input-after-click');

    if (!input) {
      sendToBackground({ type: 'VANTO_GROUP_POST_FAILED', groupName: groupName, error: 'Search input not found after clicking search icon' });
      callback({ success: false, error: 'Search input not found after clicking search icon', stage: 'find_group' });
      return;
    }

    input.focus();
    input.textContent = '';
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, groupName);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: groupName }));

    setTimeout(function() {
      var chatItems = document.querySelectorAll('[data-testid="cell-frame-container"] span[title]');
      var foundGroup = null;

      // Exact match first
      for (var i = 0; i < chatItems.length; i++) {
        var title = chatItems[i].getAttribute('title') || '';
        if (title.toLowerCase() === groupName.toLowerCase()) {
          foundGroup = chatItems[i];
          break;
        }
      }

      // Partial match fallback
      if (!foundGroup) {
        for (var j = 0; j < chatItems.length; j++) {
          var t = chatItems[j].getAttribute('title') || '';
          if (t.toLowerCase().indexOf(groupName.toLowerCase()) !== -1) {
            foundGroup = chatItems[j];
            break;
          }
        }
      }

      // Additional fallback: listitem role
      if (!foundGroup) {
        var listItems = document.querySelectorAll('[role="listitem"] span[title]');
        for (var k = 0; k < listItems.length; k++) {
          var lt = listItems[k].getAttribute('title') || '';
          if (lt.toLowerCase().indexOf(groupName.toLowerCase()) !== -1) {
            foundGroup = listItems[k];
            break;
          }
        }
      }

      if (!foundGroup) {
        log('DOM element missing: group chat item for "' + groupName + '"');
        var clearBtn = findElement([
          '[data-testid="x-alt"]', '[data-icon="x-alt"]',
          '[data-testid="search-close"]', 'button[aria-label="Cancel search"]',
        ], 'search-clear');
        if (clearBtn) (clearBtn.closest('button') || clearBtn).click();
        sendToBackground({ type: 'VANTO_GROUP_POST_FAILED', groupName: groupName, error: 'Group not found: ' + groupName });
        callback({ success: false, error: 'Group not found in search results: ' + groupName, stage: 'find_group' });
        return;
      }

      var clickTarget = foundGroup.closest('[data-testid="cell-frame-container"]') || foundGroup.closest('[role="listitem"]') || foundGroup;
      clickTarget.click();

      setTimeout(function() {
        var clearBtn2 = findElement([
          '[data-testid="x-alt"]', '[data-icon="x-alt"]',
          '[data-testid="search-close"]', 'button[aria-label="Cancel search"]',
        ], 'search-clear-after-select');
        if (clearBtn2) (clearBtn2.closest('button') || clearBtn2).click();

        // Step C: Find message input
        var msgInput = findElement([
          '[data-testid="conversation-compose-box-input"]',
          'div[contenteditable="true"][data-tab="10"]',
          '#main footer div[contenteditable="true"]',
          'div[contenteditable="true"][role="textbox"][title="Type a message"]',
          '#main div[contenteditable="true"][role="textbox"]',
        ], 'message-input');

        if (!msgInput) {
          sendToBackground({ type: 'VANTO_GROUP_POST_FAILED', groupName: groupName, error: 'Chat input box not found' });
          callback({ success: false, error: 'Chat input box not found after opening group', stage: 'find_input' });
          return;
        }

        msgInput.focus();
        msgInput.textContent = '';
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, messageContent);
        msgInput.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: messageContent,
        }));

        setTimeout(function() {
          var sendBtn = findElement([
            '[data-testid="send"]',
            'button[aria-label="Send"]',
            'span[data-icon="send"]',
            '[data-testid="compose-btn-send"]',
            'footer button[aria-label="Send"]',
          ], 'send-button');

          if (!sendBtn) {
            sendToBackground({ type: 'VANTO_GROUP_POST_FAILED', groupName: groupName, error: 'Send button not found' });
            callback({ success: false, error: 'Send button not found after injecting message', stage: 'click_send' });
            return;
          }

          var btnToClick = sendBtn.closest('button') || sendBtn;
          btnToClick.click();

          log('Message sent to group:', groupName);
          callback({ success: true });
        }, 500);
      }, 1500);
    }, 1500);
  }, 500);
}

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

// ── Detect if current chat is a group ──────────────────────────────────────────
function detectIfGroupChat() {
  // Groups typically show member count or "click here for group info"
  var groupIndicators = [
    '[data-testid="conversation-info-header"] span[data-testid="conversation-subtitle"]',
    '#main header span[title*=","]', // group members listed with commas
  ];

  // Check for group data-id pattern (ends with @g.us)
  var mainPanel = document.getElementById('main');
  if (mainPanel) {
    var dataId = mainPanel.getAttribute('data-id') || '';
    if (dataId.indexOf('@g.us') !== -1) return true;
  }

  // Check URL hash
  var hash = window.location.hash || '';
  if (hash.indexOf('@g.us') !== -1) return true;

  // Check for data-id in sub elements
  var els = document.querySelectorAll('#main [data-id]');
  for (var i = 0; i < els.length; i++) {
    if ((els[i].getAttribute('data-id') || '').indexOf('@g.us') !== -1) return true;
  }

  // Check subtitle for member indicators (e.g., "You, Alice, Bob")
  var subtitles = document.querySelectorAll('#main header span[dir="auto"]:not([title])');
  for (var j = 0; j < subtitles.length; j++) {
    var txt = (subtitles[j].textContent || '').trim();
    // If it contains commas and names, likely a group
    if (txt.indexOf(',') !== -1 && txt.length > 5 && !/^\+?\d/.test(txt)) return true;
  }

  return false;
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

  // Detect if this is a group chat
  isGroupChat = detectIfGroupChat();

  if (isGroupChat && info.name && isAuthenticated) {
    // Capture the group name to Supabase
    log('Group detected — capturing:', info.name);
    sendToBackground({ type: 'VANTO_UPSERT_GROUP', groupName: info.name }, function(resp) {
      if (resp && resp.success) {
        log('Group captured successfully:', info.name);
      } else {
        log('Group capture failed:', resp && resp.error);
      }
    });
  }

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

  // For group chats, show a different message
  if (isGroupChat) {
    showFormBody();
    var groupBanner = document.getElementById('vanto-group-banner');
    var formFields = document.getElementById('vanto-form-fields');
    if (groupBanner) groupBanner.style.display = 'block';
    if (formFields) formFields.style.display = 'none';
    return;
  }

  // Regular contact chat
  var groupBanner2 = document.getElementById('vanto-group-banner');
  var formFields2 = document.getElementById('vanto-form-fields');
  if (groupBanner2) groupBanner2.style.display = 'none';
  if (formFields2) formFields2.style.display = 'block';

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
  if (phoneEl)  phoneEl.textContent = isGroupChat ? '👥 Group' : (phone ? '+' + phone : '—');
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
  setField('vanto-f-phone',       data.phone_raw   || data.phone_normalized || '');
  setField('vanto-f-email',       data.email       || '');
  setField('vanto-f-lead-type',   data.lead_type   || 'prospect');
  setField('vanto-f-temperature', data.temperature || 'cold');
  setField('vanto-f-notes',       data.notes       || '');

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

  var userPhone = ((phoneEl && phoneEl.value) || '').trim();
  var waId      = currentPhone || null;

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

    '      <div id="vanto-group-banner" style="display:none;padding:16px 12px;text-align:center;">',
    '        <span style="font-size:32px;">👥</span>',
    '        <p style="font-size:13px;font-weight:600;color:hsl(172,66%,50%);margin:8px 0 4px;">Group Chat Captured!</p>',
    '        <p style="font-size:11px;color:hsl(215,20%,55%);">This group has been saved to your Group Campaigns. Schedule posts from the Vanto dashboard.</p>',
    '        <a href="https://chat-friend-crm.lovable.app" target="_blank" style="display:inline-block;margin-top:10px;font-size:11px;color:hsl(172,66%,50%);text-decoration:underline;">Open Dashboard →</a>',
    '      </div>',

    '      <div id="vanto-form-fields">',
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

    '      </div>', // end vanto-form-fields

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

  log('Sidebar injected v5.0 (with Group Campaigns)');
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
