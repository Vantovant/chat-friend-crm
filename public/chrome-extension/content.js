/**
 * Vanto CRM — WhatsApp Web Content Script v2.0
 * Overlay sidebar — does NOT shift WhatsApp layout.
 * Fully editable fields. Saves to Supabase via REST API.
 */

// ── Config ─────────────────────────────────────────────────────────────────
const SUPABASE_URL      = 'https://nqyyvqcmcyggvlcswkio.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xeXl2cWNtY3lnZ3ZsY3N3a2lvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NDYxMjYsImV4cCI6MjA4NzEyMjEyNn0.oK04GkXogHo9pohYd4A7XAV0-Q-qSu-uUiGWaj4ClM8';
const SAVE_CONTACT_URL  = `${SUPABASE_URL}/functions/v1/save-contact`;
const SIDEBAR_ID        = 'vanto-crm-sidebar';
const TOGGLE_ID         = 'vanto-crm-toggle';

// ── State ──────────────────────────────────────────────────────────────────
let currentPhone     = null;
let currentName      = null;
let currentContact   = null;
let sidebarVisible   = true;
let detectionTimer   = null;
let headerObserver   = null;
let pollInterval     = null;
let lastDetectedKey  = '';
let currentTags      = [];
let authToken        = null; // JWT from chrome.storage if available

// ── Logging ────────────────────────────────────────────────────────────────
function log(msg, data) {
  if (data !== undefined) {
    console.log(`[Vanto CRM] ${msg}`, data);
  } else {
    console.log(`[Vanto CRM] ${msg}`);
  }
}

// ── Auth Token — load from chrome.storage and listen for updates ──────────
function loadAuthToken() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['vanto_auth_token'], (result) => {
        if (result && result.vanto_auth_token) {
          authToken = result.vanto_auth_token;
          log('Auth token loaded from storage');
        } else {
          log('No auth token found — saves will fail RLS. Log in via the extension popup.');
        }
      });

      // Listen for token updates from popup login
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === 'VANTO_TOKEN_UPDATED') {
          chrome.storage.local.get(['vanto_auth_token'], (result) => {
            if (result && result.vanto_auth_token) {
              authToken = result.vanto_auth_token;
              log('Auth token refreshed after popup login');
            }
          });
        }
      });
    }
  } catch (e) {
    log('Storage not available', e.message);
  }
}

// ── Supabase REST helpers ──────────────────────────────────────────────────
async function sbFetch(path, options = {}) {
  const url   = `${SUPABASE_URL}/rest/v1${path}`;
  const token = authToken || SUPABASE_ANON_KEY;
  // Merge caller headers OVER defaults so 'Prefer' can be overridden per-call
  const headers = {
    'apikey':        SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${token}`,
    'Content-Type':  'application/json',
    'Prefer':        'return=representation',
    ...(options.headers || {}),
  };
  const res  = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body:   options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`[${res.status}] ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// Load contact by phone number
async function loadContactByPhone(phone) {
  log('Querying Supabase for phone', phone);
  const rows = await sbFetch(`/contacts?phone=eq.${encodeURIComponent(phone)}&limit=1`);
  log('Contact loaded from Supabase', rows && rows.length > 0 ? rows[0] : null);
  return rows && rows.length > 0 ? rows[0] : null;
}

// Upsert contact via edge function (service role server-side — no auth required)
async function upsertContact(payload) {
  log('Calling save-contact edge function', payload);
  const res = await fetch(SAVE_CONTACT_URL, {
    method: 'POST',
    headers: {
      'apikey':        SUPABASE_ANON_KEY,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`[${res.status}] ${text}`);
  }
  const data = text ? JSON.parse(text) : null;
  log('Contact saved via edge function', data?.contact?.id);
  return data?.contact || null;
}

// ── Phone Sanitizer ────────────────────────────────────────────────────────
function sanitizePhone(raw) {
  return (raw || '').replace(/\D/g, '');
}

// ── Chat Detection — multiple fallback strategies ─────────────────────────
function getActiveContactInfo() {
  let name  = null;
  let phone = null;

  // ── Name strategies ──────────────────────────────────────────────────────
  const nameSelectors = [
    '[data-testid="conversation-header"] span[title]',
    '[data-testid="conversation-info-header-chat-title"] span',
    '[data-testid="conversation-info-header-chat-title"]',
    'header [data-testid="conversation-info-header"] span[title]',
    'header span[dir="auto"][title]',
    '#main header span[title]',
    '#main header span[dir="auto"]',
    '#main header > div > div > div > div span[title]',
    '#main header > div > div span[dir="auto"]',
  ];

  for (const sel of nameSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const t = el.getAttribute('title') || el.textContent?.trim();
      if (t && t.length > 0 && t.length < 200) {
        name = t;
        break;
      }
    }
  }

  // ── Phone strategies ─────────────────────────────────────────────────────

  // P0 — #main panel itself may carry a data-id like "27821234567@s.whatsapp.net"
  if (!phone) {
    const mainPanel = document.getElementById('main');
    if (mainPanel) {
      const did = mainPanel.getAttribute('data-id') || '';
      const m   = did.match(/(\d{7,15})@/);
      if (m) phone = m[1];
    }
  }

  // P1 — URL hash (legacy WhatsApp Web)
  if (!phone) {
    const hashMatch = window.location.hash.match(/\/chat\/(\d{7,15})@/);
    if (hashMatch) phone = hashMatch[1];
  }

  // P2 — URL search param ?phone=
  if (!phone) {
    const p = new URLSearchParams(window.location.search).get('phone');
    if (p) phone = sanitizePhone(p);
  }

  // P3 — header subtitle / secondary text contains a phone number
  if (!phone) {
    const subtitleSelectors = [
      '[data-testid="conversation-info-header"] span[dir="auto"]:not([title])',
      'header span[dir="ltr"]',
      '#main header div:last-child span',
      '#main header span[dir="ltr"]',
      '#main header > div > div > div > div > span:not([title])',
    ];
    for (const sel of subtitleSelectors) {
      const el  = document.querySelector(sel);
      const txt = el?.textContent?.trim() || '';
      if (/^\+?\d[\d\s\-(). ]{5,}$/.test(txt)) {
        phone = sanitizePhone(txt);
        break;
      }
    }
  }

  // P4 — scan ALL spans in #main header for a phone-shaped number
  if (!phone) {
    const allSpans = document.querySelectorAll('#main header span');
    for (const span of allSpans) {
      const txt = span.textContent?.trim() || '';
      if (/^\+?\d{7,15}$/.test(txt.replace(/[\s\-().]/g, ''))) {
        phone = sanitizePhone(txt);
        break;
      }
    }
  }

  // P5 — selected chat row data-id (PHONE@s.whatsapp.net)
  if (!phone) {
    const chatRowSelectors = [
      'div[aria-selected="true"]',
      '[data-testid="cell-frame-container"][aria-selected="true"]',
      'div[role="row"][aria-selected="true"]',
    ];
    for (const sel of chatRowSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const withId = el.querySelector('[data-id]') || el.closest('[data-id]');
        if (withId) {
          const did = withId.getAttribute('data-id') || '';
          const m   = did.match(/(\d{7,15})@/);
          if (m) { phone = m[1]; break; }
        }
        const rowId = el.getAttribute('data-id') || '';
        const rm    = rowId.match(/(\d{7,15})@/);
        if (rm) { phone = rm[1]; break; }
      }
    }
  }

  // P6 — any element with a JID data-id near top of viewport
  if (!phone) {
    const allWithDataId = document.querySelectorAll('[data-id*="@s.whatsapp"], [data-id*="@c.us"]');
    for (const el of allWithDataId) {
      const rect = el.getBoundingClientRect();
      if (rect.top > 0 && rect.top < 200) {
        const did = el.getAttribute('data-id') || '';
        const m   = did.match(/(\d{7,15})@/);
        if (m) { phone = m[1]; break; }
      }
    }
  }

  // P7 — scan ALL elements in #main for any data-id with a JID
  if (!phone) {
    const allInMain = document.querySelectorAll('#main [data-id]');
    for (const el of allInMain) {
      const did = el.getAttribute('data-id') || '';
      const m   = did.match(/(\d{7,15})@/);
      if (m) { phone = m[1]; break; }
    }
  }

  // P8 — tab title (sometimes contains phone)
  if (!phone) {
    const titleMatch = (document.title || '').match(/\+?(\d{7,15})/);
    if (titleMatch) phone = titleMatch[1];
  }

  log('Chat detected', { name, phone });
  return { name: name || null, phone: phone ? sanitizePhone(phone) : null };
}

// ── Debounced detection ────────────────────────────────────────────────────
function scheduleDetection() {
  clearTimeout(detectionTimer);
  detectionTimer = setTimeout(runDetection, 500);
}

async function runDetection() {
  const { name, phone } = getActiveContactInfo();
  const key = `${name}|${phone}`;
  if (key === lastDetectedKey) return;
  lastDetectedKey = key;
  currentPhone    = phone;
  currentName     = name;
  log('New chat detected', { name, phone });
  await refreshSidebar(name, phone);
}

// ── Sidebar Refresh ────────────────────────────────────────────────────────
async function refreshSidebar(name, phone) {
  updateContactHeader(name, phone);

  // Always show the form if we have at least a name — never hide it
  if (!name && !phone) {
    showNoChatState();
    return;
  }

  showFormBody();

  if (!phone) {
    // Name detected but no phone — pre-fill name, let user save manually
    log('Name detected but no phone number found', name);
    populateForm({
      name:        name || '',
      phone:       '',
      email:       '',
      lead_type:   'prospect',
      temperature: 'cold',
      tags:        [],
      notes:       '',
    });
    showStatus('info', '⚠️ Phone not detected — add manually if needed');
    setTimeout(clearStatus, 4000);
    return;
  }

  showStatus('loading', '⏳ Loading contact…');

  try {
    const contact = await loadContactByPhone(phone);
    currentContact = contact;

    if (contact) {
      populateForm(contact);
      showStatus('success', '✅ Contact loaded');
    } else {
      log('No existing contact — initializing empty form for', phone);
      populateForm({
        name:        name || '',
        phone:       phone,
        email:       '',
        lead_type:   'prospect',
        temperature: 'cold',
        tags:        [],
        notes:       '',
      });
      showStatus('info', '📋 New contact — fill and save');
    }
  } catch (err) {
    log('Error loading contact', err.message);
    showStatus('error', '❌ Load failed: ' + err.message);
  }

  setTimeout(clearStatus, 3500);
}

// ── Header ─────────────────────────────────────────────────────────────────
function updateContactHeader(name, phone) {
  const nameEl   = document.getElementById('vanto-hdr-name');
  const phoneEl  = document.getElementById('vanto-hdr-phone');
  const avatarEl = document.getElementById('vanto-avatar');
  if (nameEl)   nameEl.textContent  = name  || 'Select a chat';
  if (phoneEl)  phoneEl.textContent = phone ? `+${phone}` : '—';
  if (avatarEl) avatarEl.textContent = (name || '?')[0].toUpperCase();
}

// ── Form populate — fills all fields, enables editing ─────────────────────
function populateForm(data) {
  function setField(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value      = val || '';
    el.disabled   = false;
    el.readOnly   = false;
    el.style.pointerEvents = 'auto';
    el.style.opacity       = '1';
  }

  setField('vanto-f-name',        data.name        || '');
  setField('vanto-f-phone',       data.phone       || currentPhone || '');
  setField('vanto-f-email',       data.email       || '');
  setField('vanto-f-lead-type',   data.lead_type   || 'prospect');
  setField('vanto-f-temperature', data.temperature || 'cold');
  setField('vanto-f-notes',       data.notes       || '');

  currentTags = Array.isArray(data.tags) ? [...data.tags] : [];
  renderTags();
}

// ── Show / Hide states ─────────────────────────────────────────────────────
function showNoChatState() {
  const noChatEl = document.getElementById('vanto-no-chat');
  const formEl   = document.getElementById('vanto-form-body');
  if (noChatEl) noChatEl.style.display = 'flex';
  if (formEl)   formEl.style.display   = 'none';
  clearStatus();
}

function showFormBody() {
  const noChatEl = document.getElementById('vanto-no-chat');
  const formEl   = document.getElementById('vanto-form-body');
  if (noChatEl) noChatEl.style.display = 'none';
  if (formEl)   formEl.style.display   = 'block';
}

// ── Tags ───────────────────────────────────────────────────────────────────
function renderTags() {
  const container = document.getElementById('vanto-tags-display');
  if (!container) return;
  container.innerHTML = currentTags.length === 0
    ? '<span style="color:hsl(215,20%,35%);font-size:11px;">No tags yet</span>'
    : currentTags.map(t => `
        <span class="vanto-tag-chip">
          ${escapeHtml(t)}
          <button class="vanto-tag-remove" data-tag="${escapeHtml(t)}" title="Remove tag">×</button>
        </span>
      `).join('');

  container.querySelectorAll('.vanto-tag-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      currentTags = currentTags.filter(x => x !== btn.dataset.tag);
      renderTags();
    });
  });
}

function addTag(raw) {
  const tag = raw.trim().toLowerCase().replace(/[^a-z0-9_\-]/g, '');
  if (tag && !currentTags.includes(tag)) {
    currentTags.push(tag);
    renderTags();
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Status Banner ──────────────────────────────────────────────────────────
function showStatus(type, msg) {
  const el = document.getElementById('vanto-status');
  if (!el) return;
  el.textContent = msg;
  el.className   = `vanto-status show ${type}`;
}

function clearStatus() {
  const el = document.getElementById('vanto-status');
  if (el) el.className = 'vanto-status';
}

// ── Save ───────────────────────────────────────────────────────────────────
async function handleSave() {
  const nameEl   = document.getElementById('vanto-f-name');
  const phoneEl  = document.getElementById('vanto-f-phone');
  const emailEl  = document.getElementById('vanto-f-email');
  const ltEl     = document.getElementById('vanto-f-lead-type');
  const tempEl   = document.getElementById('vanto-f-temperature');
  const notesEl  = document.getElementById('vanto-f-notes');

  // Phone: prefer auto-detected, fall back to what user typed in the field
  const phone = sanitizePhone(currentPhone || phoneEl?.value || '');

  if (!phone) {
    showStatus('error', '❌ Phone number is required — type it in the Phone field');
    setTimeout(clearStatus, 4000);
    return;
  }

  const name        = (nameEl?.value || '').trim() || currentName || '';
  const email       = (emailEl?.value || '').trim() || null;
  const lead_type   = ltEl?.value  || 'prospect';
  const temperature = tempEl?.value || 'cold';
  const notes       = (notesEl?.value || '').trim() || null;

  if (!name) {
    showStatus('error', '❌ Name is required');
    setTimeout(clearStatus, 3000);
    return;
  }

  const isExisting = !!(currentContact && currentContact.id);

  const payload = {
    name,
    phone,
    email,
    lead_type,
    temperature,
    tags:  currentTags,
    notes,
  };

  log('Saving contact', payload);

  const saveBtn = document.getElementById('vanto-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Saving…'; }
  showStatus('loading', '⏳ Saving contact…');

  try {
    const saved = await upsertContact(payload);
    currentContact = saved;
    // Update currentPhone in case it was typed manually
    currentPhone = phone;

    const msg = isExisting ? '✅ Contact Updated' : '✅ Contact Saved';
    showStatus('success', msg);
    if (saveBtn) saveBtn.textContent = '✅ Saved!';

    setTimeout(() => {
      if (saveBtn) { saveBtn.textContent = '💾 Save Contact'; saveBtn.disabled = false; }
      clearStatus();
    }, 2500);

  } catch (err) {
    log('Error saving contact', err.message);
    const errMsg = err.message.includes('42501') || err.message.includes('permission')
      ? '❌ Permission denied — log in to Vanto first'
      : '❌ Save failed: ' + err.message;
    showStatus('error', errMsg);
    if (saveBtn) { saveBtn.textContent = '💾 Save Contact'; saveBtn.disabled = false; }
    setTimeout(clearStatus, 5000);
  }
}

// ── Sidebar HTML ───────────────────────────────────────────────────────────
function buildSidebarHTML() {
  return `
<div id="${SIDEBAR_ID}">

  <!-- Header -->
  <div class="vanto-header">
    <span class="vanto-logo">⚡ Vanto CRM</span>
    <button class="vanto-close" id="vanto-close-btn" title="Hide sidebar">✕</button>
  </div>

  <!-- Contact card -->
  <div class="vanto-contact-card">
    <div class="vanto-avatar" id="vanto-avatar">?</div>
    <div class="vanto-contact-meta">
      <p class="vanto-contact-name-display" id="vanto-hdr-name">Select a chat</p>
      <p class="vanto-contact-phone-display" id="vanto-hdr-phone">—</p>
    </div>
  </div>

  <!-- Status -->
  <div class="vanto-status" id="vanto-status"></div>

  <!-- Body -->
  <div class="vanto-body">

    <!-- No chat selected -->
    <div id="vanto-no-chat" class="vanto-no-chat">
      <span class="vanto-no-chat-icon">💬</span>
      <span>Open a WhatsApp chat to load or create a contact.</span>
    </div>

    <!-- Editable form (hidden until chat is selected) -->
    <div id="vanto-form-body" style="display:none;">

      <div class="vanto-section">
        <p class="vanto-section-title">Contact Info</p>

        <div class="vanto-field">
          <label class="vanto-label" for="vanto-f-name">Full Name</label>
          <input class="vanto-input" id="vanto-f-name" type="text" placeholder="e.g. Olivier Agnin" autocomplete="off" />
        </div>

        <div class="vanto-field">
          <label class="vanto-label" for="vanto-f-phone">Phone Number</label>
          <input class="vanto-input" id="vanto-f-phone" type="text" placeholder="e.g. 27821234567" autocomplete="off" />
        </div>

        <div class="vanto-field">
          <label class="vanto-label" for="vanto-f-email">Email Address</label>
          <input class="vanto-input" id="vanto-f-email" type="email" placeholder="email@example.com" autocomplete="off" />
        </div>
      </div>

      <div class="vanto-section">
        <p class="vanto-section-title">Lead Classification</p>

        <div class="vanto-field">
          <label class="vanto-label" for="vanto-f-lead-type">Lead Type</label>
          <select class="vanto-select" id="vanto-f-lead-type">
            <option value="prospect">Prospect</option>
            <option value="registered">Registered</option>
            <option value="buyer">Buyer</option>
            <option value="vip">VIP</option>
          </select>
        </div>

        <div class="vanto-field">
          <label class="vanto-label" for="vanto-f-temperature">Temperature</label>
          <select class="vanto-select" id="vanto-f-temperature">
            <option value="hot">🔥 Hot</option>
            <option value="warm">🌤 Warm</option>
            <option value="cold">❄️ Cold</option>
          </select>
        </div>
      </div>

      <div class="vanto-section">
        <p class="vanto-section-title">Tags</p>
        <div class="vanto-tags-display" id="vanto-tags-display"></div>
        <div style="display:flex;gap:6px;margin-top:6px;">
          <input class="vanto-input" id="vanto-tag-input" type="text" placeholder="Add tag, press Enter" style="flex:1;" autocomplete="off" />
          <button class="vanto-btn" id="vanto-tag-add" style="width:auto;padding:7px 12px;flex-shrink:0;">+</button>
        </div>
      </div>

      <div class="vanto-section">
        <p class="vanto-section-title">Notes</p>
        <textarea class="vanto-textarea" id="vanto-f-notes" placeholder="Add notes about this contact…"></textarea>
      </div>

      <div class="vanto-section">
        <button class="vanto-btn vanto-btn-primary" id="vanto-save-btn">💾 Save Contact</button>
      </div>

    </div>
  </div>

  <!-- Footer -->
  <div class="vanto-footer">
    <a href="https://chat-friend-crm.lovable.app" target="_blank" class="vanto-footer-link">Open Vanto Dashboard ↗</a>
  </div>

</div>`;
}

// ── Toggle Button ──────────────────────────────────────────────────────────
function buildToggleButton() {
  const btn     = document.createElement('button');
  btn.id        = TOGGLE_ID;
  btn.title     = 'Open Vanto CRM';
  btn.innerHTML = '⚡';
  btn.addEventListener('click', showSidebar);
  return btn;
}

// ── Show / Hide Sidebar ────────────────────────────────────────────────────
function showSidebar() {
  const el = document.getElementById(SIDEBAR_ID);
  const tg = document.getElementById(TOGGLE_ID);
  if (el) el.style.display = 'flex';
  if (tg) tg.style.display = 'none';
  sidebarVisible = true;
}

function hideSidebar() {
  const el = document.getElementById(SIDEBAR_ID);
  const tg = document.getElementById(TOGGLE_ID);
  if (el) el.style.display = 'none';
  if (tg) tg.style.display = 'flex';
  sidebarVisible = false;
}

// ── Wire Events ────────────────────────────────────────────────────────────
function wireEvents() {
  document.getElementById('vanto-close-btn')?.addEventListener('click', hideSidebar);
  document.getElementById('vanto-save-btn')?.addEventListener('click', handleSave);

  // Tag — add button
  document.getElementById('vanto-tag-add')?.addEventListener('click', () => {
    const inp = document.getElementById('vanto-tag-input');
    if (inp?.value.trim()) {
      addTag(inp.value);
      inp.value = '';
      inp.focus();
    }
  });

  // Tag — Enter key
  document.getElementById('vanto-tag-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const inp = document.getElementById('vanto-tag-input');
      if (inp?.value.trim()) {
        addTag(inp.value);
        inp.value = '';
      }
    }
  });

  // Prevent sidebar input events from bubbling into WhatsApp
  const sidebar = document.getElementById(SIDEBAR_ID);
  if (sidebar) {
    sidebar.addEventListener('keydown', (e) => e.stopPropagation());
    sidebar.addEventListener('keyup',   (e) => e.stopPropagation());
    sidebar.addEventListener('keypress',(e) => e.stopPropagation());
    sidebar.addEventListener('click',   (e) => e.stopPropagation());
  }
}

// ── MutationObserver setup ─────────────────────────────────────────────────
function watchChatChanges() {
  // Polling every 1.5s as safety net
  pollInterval = setInterval(() => scheduleDetection(), 1500);

  // Observe document title for name changes
  const titleEl = document.querySelector('title');
  if (titleEl) {
    new MutationObserver(() => scheduleDetection())
      .observe(titleEl, { childList: true, characterData: true, subtree: true });
  }

  // Observe document body for structural changes (chat switching)
  new MutationObserver(() => scheduleDetection())
    .observe(document.body, { childList: true, subtree: false });

  // Attach focused observer on the WhatsApp main header
  function tryAttachHeaderObserver() {
    const header =
      document.querySelector('#main header') ||
      document.querySelector('[data-testid="conversation-header"]') ||
      document.querySelector('header');

    if (header) {
      if (headerObserver) headerObserver.disconnect();
      headerObserver = new MutationObserver(() => scheduleDetection());
      headerObserver.observe(header, { childList: true, subtree: true, characterData: true });
      log('Header observer attached');
    } else {
      setTimeout(tryAttachHeaderObserver, 1200);
    }
  }

  tryAttachHeaderObserver();
}

// ── Inject sidebar into page ───────────────────────────────────────────────
function injectSidebar() {
  if (document.getElementById(SIDEBAR_ID)) return; // Already injected

  const wrapper = document.createElement('div');
  wrapper.innerHTML = buildSidebarHTML();
  document.body.appendChild(wrapper.firstElementChild);
  document.body.appendChild(buildToggleButton());

  wireEvents();
  watchChatChanges();

  // Initial detection
  setTimeout(runDetection, 1200);

  log('Sidebar injected');
}

// ── Boot — wait for WhatsApp #app element ─────────────────────────────────
function boot() {
  loadAuthToken();

  if (document.getElementById('app')) {
    setTimeout(injectSidebar, 1500);
    return;
  }

  const obs = new MutationObserver(() => {
    if (document.getElementById('app')) {
      obs.disconnect();
      setTimeout(injectSidebar, 1500);
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

boot();
