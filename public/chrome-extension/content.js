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
var heartbeatTimer  = null;
var heartbeatHooksBound = false;
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

// ── Live heartbeat from WhatsApp tab ───────────────────────────────────────────
function isWhatsAppDomReady() {
  return !!(document.getElementById('app') && document.getElementById('main'));
}

function sendLiveHeartbeat(source) {
  sendToBackground({
    type: 'VANTO_HEARTBEAT_PING',
    whatsappReady: isWhatsAppDomReady(),
    source: source || 'content_script',
  }, function(response) {
    if (response && response.success) return;
    log('Heartbeat ping failed', response && response.error ? response.error : 'no_response');
  });
}

function startHeartbeatLoop() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);

  sendLiveHeartbeat('content_init');
  heartbeatTimer = setInterval(function() {
    sendLiveHeartbeat('content_interval');
  }, 30000);

  if (!heartbeatHooksBound) {
    heartbeatHooksBound = true;
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) sendLiveHeartbeat('content_visible');
    });
    window.addEventListener('focus', function() {
      sendLiveHeartbeat('content_focus');
    });
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

// Listen for auth changes, pings, and group post execution commands from background
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (!msg || !msg.type) {
    sendResponse({ error: 'no_type' });
    return false;
  }

  // ── Ping/pong for liveness check ──────────────────────────────────────────
  if (msg.type === 'VANTO_PING') {
    sendResponse({ pong: true, ready: isWhatsAppDomReady(), timestamp: Date.now() });
    return false;
  }

  if (msg.type === 'VANTO_TOKEN_UPDATED') {
    isAuthenticated = true;
    log('Token updated — refreshing');
    updateAuthBanner();
    loadTeamMembers();
    runDetection();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'VANTO_TOKEN_CLEARED') {
    isAuthenticated = false;
    log('Token cleared');
    updateAuthBanner();
    sendResponse({ ok: true });
    return false;
  }

  // ── Auto-poster execution engine ──────────────────────────────────────────
  if (msg.type === 'VANTO_EXECUTE_GROUP_POST') {
    log('Executing group post:', msg.groupName);
    // Check if WhatsApp main pane is ready
    var appEl = document.getElementById('app');
    if (!appEl) {
      sendResponse({ success: false, error: 'WhatsApp Web DOM not ready (#app missing)', stage: 'dom_not_ready' });
      return false;
    }
    try {
      executeGroupPostInDOM(msg.groupName, msg.messageContent, function(result) {
        try {
          sendResponse(result);
        } catch (e) {
          log('sendResponse failed (channel closed):', e.message);
        }
      });
    } catch (err) {
      log('executeGroupPostInDOM threw:', err.message);
      sendResponse({ success: false, error: 'Execution exception: ' + err.message, stage: 'exception' });
      return false;
    }
    return true; // keep channel open for async response
  }

  // Default: respond to avoid dangling channels
  sendResponse({ ok: false, error: 'unknown_type' });
  return false;
});

// ── Normalize group name for comparison (light clean, preserves meaningful symbols) ──
function normalizeGroupName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')   // zero-width chars
    .replace(/\s+/g, ' ')                      // collapse whitespace
    .trim();
}

// Heavy normalize: strips ALL symbols for fuzzy fallback only
function heavyNormalize(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[|•·—–\-_~&]+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Build search queries in priority order: raw first, then cleaned
function buildSearchQueries(rawName) {
  if (!rawName) return [];
  var queries = [];
  // Stage A: exact raw (trimmed)
  var raw = rawName.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  if (raw) queries.push(raw);
  // Stage B: first significant word (4+ chars) for broader search
  var words = raw.split(/[\s|•·—–\-_~&]+/).filter(function(w) { return w.length >= 4; });
  if (words.length > 0 && words[0] !== raw) queries.push(words[0]);
  // Stage C: heavy cleaned
  var heavy = heavyNormalize(rawName);
  if (heavy && queries.indexOf(heavy) === -1) {
    var heavyWords = heavy.split(' ').filter(function(w) { return w.length > 0; });
    if (heavyWords.length <= 4) {
      queries.push(heavy);
    } else {
      queries.push(heavyWords.slice(0, 3).join(' '));
    }
  }
  return queries;
}

// ── Stage-level execution engine ───────────────────────────────────────────────

var STAGE_TIMEOUTS = {
  open_search:      5000,
  search_group:     8000,
  select_group:     5000,
  wait_chat_open:   8000,
  find_input:       5000,
  inject_message:   5000,
  find_send_button: 5000,
  click_send:       5000,
  confirm_sent:     8000,
};

function pollUntil(conditionFn, timeoutMs, intervalMs) {
  return new Promise(function(resolve) {
    var elapsed = 0;
    var iv = intervalMs || 400;
    function check() {
      var result = conditionFn();
      if (result) { resolve(result); return; }
      elapsed += iv;
      if (elapsed >= timeoutMs) { resolve(null); return; }
      setTimeout(check, iv);
    }
    check();
  });
}

function findElement(selectors) {
  for (var i = 0; i < selectors.length; i++) {
    var el = document.querySelector(selectors[i]);
    if (el) return el;
  }
  return null;
}

// ── Execute group post in WhatsApp DOM ─────────────────────────────────────────
function executeGroupPostInDOM(groupName, messageContent, callback) {
  log('executeGroupPostInDOM started for group:', groupName);

  var searchQueries = buildSearchQueries(groupName);
  var normalizedTarget = normalizeGroupName(groupName);
  var heavyTarget = heavyNormalize(groupName);
  var stageTrace = { completed: [], failed_stage: null, error_code: null, details: {} };
  var callbackCalled = false;

  function safeCallback(result) {
    if (callbackCalled) return;
    callbackCalled = true;
    callback(result);
  }

  function stageOk(name) { stageTrace.completed.push(name); log('Stage OK:', name); }
  function stageFail(name, code, details) {
    stageTrace.failed_stage = name;
    stageTrace.error_code = code;
    if (details) stageTrace.details = details;
    var last = stageTrace.completed.length > 0 ? stageTrace.completed[stageTrace.completed.length - 1] : 'none';
    var errorMsg = '[' + name + '] ' + code + ' — last completed: ' + last +
      (details ? ' | ' + JSON.stringify(details) : '');
    log('Stage FAILED:', errorMsg);
    safeCallback({
      success: false,
      error: errorMsg,
      error_code: code,
      failed_stage: name,
      last_completed_stage: last,
      details: details || {},
      stage: name,
    });
  }

  function matchGroupTitle(title) {
    var norm = normalizeGroupName(title);
    if (norm === normalizedTarget) return 'exact';
    if (norm.indexOf(normalizedTarget) !== -1 || normalizedTarget.indexOf(norm) !== -1) return 'partial';
    var targetWords = heavyTarget.split(' ').filter(function(w) { return w.length > 2; });
    if (targetWords.length > 0) {
      var hc = heavyNormalize(title);
      var ok = true;
      for (var w = 0; w < targetWords.length; w++) {
        if (hc.indexOf(targetWords[w]) === -1) { ok = false; break; }
      }
      if (ok) return 'fuzzy';
    }
    return null;
  }

  function gatherCandidates() {
    var sels = [
      '[data-testid="cell-frame-container"] span[title]',
      '[role="listitem"] span[title]',
      '[data-testid="chat-list"] span[title]',
      'div[aria-label="Search results"] span[title]',
    ];
    var seen = []; var out = [];
    for (var s = 0; s < sels.length; s++) {
      var nodes = document.querySelectorAll(sels[s]);
      for (var n = 0; n < nodes.length; n++) {
        if (seen.indexOf(nodes[n]) === -1) { seen.push(nodes[n]); out.push(nodes[n]); }
      }
    }
    return out;
  }

  function findMatchInCandidates(candidates) {
    var types = ['exact', 'partial', 'fuzzy'];
    for (var pass = 0; pass < 3; pass++) {
      for (var i = 0; i < candidates.length; i++) {
        var t = candidates[i].getAttribute('title') || '';
        if (matchGroupTitle(t) === types[pass]) return { el: candidates[i], type: types[pass], title: t };
      }
    }
    return null;
  }

  function clearSearch() {
    var btn = findElement([
      '[data-testid="x-alt"]', '[data-icon="x-alt"]',
      '[data-testid="search-close"]', 'button[aria-label="Cancel search"]',
    ]);
    if (btn) (btn.closest('button') || btn).click();
  }

  var searchInputSels = [
    '[data-testid="chat-list-search-input"]',
    'div[contenteditable="true"][data-tab="3"]',
    'div[contenteditable="true"][role="textbox"][title="Search input textbox"]',
  ];
  var searchIconSels = [
    '[data-testid="chat-list-search"]', '[data-icon="search"]',
    'button[aria-label="Search"]', 'header button span[data-icon="search"]',
  ];
  var msgInputSels = [
    '[data-testid="conversation-compose-box-input"]',
    'div[contenteditable="true"][data-tab="10"]',
    '#main footer div[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"][title="Type a message"]',
    '#main div[contenteditable="true"][role="textbox"]',
  ];
  var sendBtnSels = [
    '[data-testid="send"]', 'button[aria-label="Send"]',
    'span[data-icon="send"]', '[data-testid="compose-btn-send"]',
  ];

  // ── STAGE 1: open_search ────────────────────────────────────────────────────
  var existingInput = findElement(searchInputSels);
  if (!existingInput) {
    var icon = findElement(searchIconSels);
    if (icon) (icon.closest('button') || icon).click();
  }

  pollUntil(function() { return findElement(searchInputSels); }, STAGE_TIMEOUTS.open_search)
    .then(function(input) {
      if (!input) { stageFail('open_search', 'OPEN_SEARCH_TIMEOUT', { msg: 'Search input never appeared' }); return; }
      stageOk('open_search');
      runSearchStages(input);
    });

  // ── STAGE 2: search_group ───────────────────────────────────────────────────
  function runSearchStages() {
    var qIdx = 0;
    var triedQ = [];
    var candTitles = [];

    function tryQuery() {
      if (qIdx >= searchQueries.length) {
        clearSearch();
        stageFail('search_group', 'GROUP_NOT_FOUND', {
          raw_title: groupName, queries_tried: triedQ, normalized: normalizedTarget,
          heavy: heavyTarget, visible_count: candTitles.length, visible_titles: candTitles.slice(0, 10),
        });
        return;
      }
      var query = searchQueries[qIdx]; triedQ.push(query); qIdx++;
      clearSearch();

      setTimeout(function() {
        var inp = findElement(searchInputSels);
        if (!inp) { stageFail('search_group', 'SEARCH_GROUP_TIMEOUT', { msg: 'Search input lost' }); return; }
        inp.focus(); inp.textContent = '';
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, query);
        inp.dispatchEvent(new InputEvent('input', { bubbles: true, data: query }));
        log('Search query:', query);

        pollUntil(function() {
          var c = gatherCandidates();
          var m = findMatchInCandidates(c);
          if (m) return { match: m, candidates: c };
          for (var i = 0; i < Math.min(c.length, 10); i++) {
            var t = c[i].getAttribute('title') || '';
            if (t && candTitles.indexOf(t) === -1) candTitles.push(t);
          }
          return null;
        }, STAGE_TIMEOUTS.search_group, 600)
          .then(function(r) {
            if (r && r.match) {
              log('Match (' + r.match.type + '):', r.match.title);
              stageOk('search_group');
              runSelectStage(r.match);
            } else {
              var fc = gatherCandidates();
              for (var i = 0; i < Math.min(fc.length, 10); i++) {
                var t = fc[i].getAttribute('title') || '';
                if (t && candTitles.indexOf(t) === -1) candTitles.push(t);
              }
              clearSearch();
              setTimeout(tryQuery, 400);
            }
          });
      }, 500);
    }
    tryQuery();
  }

  // ── STAGE 3: select_group ───────────────────────────────────────────────────
  function runSelectStage(match) {
    var target = match.el.closest('[data-testid="cell-frame-container"]') || match.el.closest('[role="listitem"]') || match.el;
    target.click();
    stageOk('select_group');

    // ── STAGE 4: wait_chat_open ─────────────────────────────────────────────
    pollUntil(function() {
      var h = findElement([
        '[data-testid="conversation-header"] span[title]',
        '#main header span[title]', '#main header span[dir="auto"]',
      ]);
      if (h) { var t = h.getAttribute('title') || h.textContent || ''; if (t.length > 0) return t; }
      return null;
    }, STAGE_TIMEOUTS.wait_chat_open)
      .then(function(ht) {
        if (!ht) { stageFail('wait_chat_open', 'CHAT_OPEN_TIMEOUT', { msg: 'Header never appeared' }); return; }
        log('Chat header:', ht);
        stageOk('wait_chat_open');
        clearSearch();
        runFindInputStage();
      });
  }

  // ── STAGE 5: find_input ─────────────────────────────────────────────────────
  function runFindInputStage() {
    pollUntil(function() { return findElement(msgInputSels); }, STAGE_TIMEOUTS.find_input)
      .then(function(msgInput) {
        if (!msgInput) { stageFail('find_input', 'INPUT_NOT_FOUND', { tried_count: msgInputSels.length }); return; }
        stageOk('find_input');
        runInjectStage(msgInput);
      });
  }

  // ── STAGE 6: inject_message ─────────────────────────────────────────────────
  function runInjectStage(msgInput) {
    try {
      msgInput.focus(); msgInput.textContent = '';
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, messageContent);
      msgInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: messageContent }));
    } catch (e) {
      stageFail('inject_message', 'INJECT_MESSAGE_TIMEOUT', { error: e.message }); return;
    }

    pollUntil(function() {
      var txt = msgInput.textContent || msgInput.innerText || '';
      return txt.length > 0 ? true : null;
    }, STAGE_TIMEOUTS.inject_message, 300)
      .then(function(ok) {
        if (!ok) { stageFail('inject_message', 'INJECT_MESSAGE_TIMEOUT', { msg: 'Text not visible in input' }); return; }
        stageOk('inject_message');
        runSendStage();
      });
  }

  // ── STAGE 7+8+9: send ──────────────────────────────────────────────────────
  function runSendStage() {
    pollUntil(function() { return findElement(sendBtnSels); }, STAGE_TIMEOUTS.find_send_button)
      .then(function(sendBtn) {
        if (!sendBtn) { stageFail('find_send_button', 'SEND_BUTTON_NOT_FOUND', { tried_count: sendBtnSels.length }); return; }
        stageOk('find_send_button');

        try { (sendBtn.closest('button') || sendBtn).click(); }
        catch (e) { stageFail('click_send', 'CLICK_SEND_TIMEOUT', { error: e.message }); return; }
        stageOk('click_send');

        pollUntil(function() {
          var inp = findElement([
            '[data-testid="conversation-compose-box-input"]',
            '#main footer div[contenteditable="true"]',
          ]);
          if (inp) { var t = inp.textContent || inp.innerText || ''; if (t.trim().length === 0) return true; }
          return null;
        }, STAGE_TIMEOUTS.confirm_sent, 500)
          .then(function(cleared) {
            if (!cleared) log('confirm_sent: input still has text — cautious success');
            stageOk('confirm_sent');
            log('All stages complete — sent to:', groupName);
            safeCallback({ success: true, stages_completed: stageTrace.completed });
          });
      });
  }
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
    // Extract group JID if available
    var groupJid = null;
    var mainPanel = document.getElementById('main');
    if (mainPanel) {
      var dataId = mainPanel.getAttribute('data-id') || '';
      if (dataId.indexOf('@g.us') !== -1) groupJid = dataId;
    }
    if (!groupJid) {
      var els = document.querySelectorAll('#main [data-id]');
      for (var gi = 0; gi < els.length; gi++) {
        var gid = els[gi].getAttribute('data-id') || '';
        if (gid.indexOf('@g.us') !== -1) { groupJid = gid; break; }
      }
    }

    log('Group detected — capturing:', info.name, groupJid ? '(JID: ' + groupJid + ')' : '');
    sendToBackground({ type: 'VANTO_UPSERT_GROUP', groupName: info.name, groupJid: groupJid }, function(resp) {
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
    startHeartbeatLoop();
    if (isAuthenticated) loadTeamMembers();
    setTimeout(runDetection, 1200);
  });

  log('Sidebar injected v5.1 (with live heartbeat)');
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
