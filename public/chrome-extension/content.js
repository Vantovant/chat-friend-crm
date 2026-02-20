/**
 * Vanto CRM — WhatsApp Web Content Script v1.1
 * Overlay sidebar only — does NOT shift WhatsApp layout
 */

// ── Config ─────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://nqyyvqcmcyggvlcswkio.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xeXl2cWNtY3lnZ3ZsY3N3a2lvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NDYxMjYsImV4cCI6MjA4NzEyMjEyNn0.oK04GkXogHo9pohYd4A7XAV0-Q-qSu-uUiGWaj4ClM8';

const SIDEBAR_ID = 'vanto-crm-sidebar';
const TOGGLE_ID  = 'vanto-crm-toggle';

// ── State ──────────────────────────────────────────────────────────────────
let currentPhone    = null;
let currentName     = null;
let currentContact  = null;  // loaded from Supabase
let sidebarVisible  = true;
let detectionTimer  = null;
let headerObserver  = null;
let pollInterval    = null;
let lastDetectedKey = '';
let currentTags     = [];    // local tag array

// ── Logging ────────────────────────────────────────────────────────────────
function log(msg, data) {
  if (data !== undefined) {
    console.log(`[Vanto CRM] ${msg}`, data);
  } else {
    console.log(`[Vanto CRM] ${msg}`);
  }
}

// ── Supabase REST helpers ──────────────────────────────────────────────────
async function sbFetch(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': options.prefer || 'return=representation',
    ...(options.headers || {}),
  };
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`[${res.status}] ${text}`);
  return text ? JSON.parse(text) : null;
}

async function loadContactByPhone(phone) {
  log('Querying Supabase for phone', phone);
  const rows = await sbFetch(`/contacts?phone=eq.${encodeURIComponent(phone)}&limit=1`);
  return rows && rows.length > 0 ? rows[0] : null;
}

async function upsertContact(payload) {
  log('Upserting contact', payload);
  const rows = await sbFetch('/contacts?on_conflict=phone', {
    method: 'POST',
    prefer: 'return=representation,resolution=merge-duplicates',
    body: payload,
  });
  return rows && rows.length > 0 ? rows[0] : null;
}

// ── Phone Sanitizer ────────────────────────────────────────────────────────
function sanitizePhone(raw) {
  return (raw || '').replace(/\D/g, '');
}

// ── Chat Detection — 5 fallback strategies ─────────────────────────────────
function getActiveContactInfo() {
  let name  = null;
  let phone = null;

  // Strategy 1 — DOM header name selectors
  const nameSelectors = [
    '[data-testid="conversation-header"] span[title]',
    'header [data-testid="conversation-info-header"] span[title]',
    'header span[dir="auto"][title]',
    '[data-testid="conv-header-participant"] span[title]',
    '[data-testid="conversation-header"] ._21S-L span[title]',
    'header ._21S-L span[title]',
    '#main header span[dir="auto"]',
    '#main header span[title]',
  ];
  for (const sel of nameSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      const t = el.getAttribute('title') || el.textContent?.trim();
      if (t && t.length > 0) { name = t; break; }
    }
  }

  // Strategy 2 — URL hash (legacy)
  const hashMatch = window.location.hash.match(/\/chat\/(\d+)@/);
  if (hashMatch) phone = hashMatch[1];

  // Strategy 3 — URL search param ?phone=
  if (!phone) {
    const p = new URLSearchParams(window.location.search).get('phone');
    if (p) phone = sanitizePhone(p);
  }

  // Strategy 4 — phone in header subtitle text
  if (!phone) {
    const subtitleSelectors = [
      'header [data-testid="conversation-info-header"] div:last-child span',
      'header ._21S-L + div span',
      '[data-testid="conv-header-participant"] div span',
      '#main header div:last-child span',
      '#main header span[dir="ltr"]',
    ];
    for (const sel of subtitleSelectors) {
      const el = document.querySelector(sel);
      const txt = el?.textContent?.trim() || '';
      if (/^\+?\d[\d\s\-()]{6,}$/.test(txt)) {
        phone = sanitizePhone(txt);
        break;
      }
    }
  }

  // Strategy 5 — tab title contains a number
  if (!phone) {
    const titleMatch = (document.title || '').match(/\+?(\d{7,15})/);
    if (titleMatch) phone = titleMatch[1];
  }

  // Strategy 6 — data-id attribute on selected chat list item
  if (!phone) {
    const activeChat = document.querySelector(
      '[data-testid="cell-frame-container"][class*="selected"] [data-testid="cell-frame-container-false"],' +
      'div[aria-selected="true"] [data-id],' +
      '._2Ts6i[data-id]'
    );
    if (activeChat) {
      const did = activeChat.getAttribute('data-id') || '';
      const m = did.match(/(\d{7,15})@/);
      if (m) phone = m[1];
    }
  }

  log('Chat detected', { name, phone });
  return { name: name || null, phone: phone || null };
}

// ── Debounced detection trigger ────────────────────────────────────────────
function scheduleDetection() {
  clearTimeout(detectionTimer);
  detectionTimer = setTimeout(runDetection, 500);
}

async function runDetection() {
  const { name, phone } = getActiveContactInfo();
  const key = `${name}|${phone}`;
  if (key === lastDetectedKey) return;
  lastDetectedKey = key;
  currentPhone = phone;
  currentName  = name;
  log('New chat detected', { name, phone });
  await refreshSidebar(name, phone);
}

// ── Sidebar Data Refresh ───────────────────────────────────────────────────
async function refreshSidebar(name, phone) {
  updateContactHeader(name, phone);

  if (!phone) {
    showNoChatState();
    return;
  }

  showStatus('loading', '⏳ Loading contact…');
  showFormSkeleton();

  try {
    const contact = await loadContactByPhone(phone);
    currentContact = contact;
    log('Contact loaded from Supabase', contact);

    if (contact) {
      populateForm(contact);
      showStatus('success', '✅ Contact loaded');
    } else {
      log('No existing contact — showing empty form for', phone);
      populateForm({ name: name || '', phone, email: '', lead_type: 'prospect', temperature: 'cold', tags: [], notes: '' });
      showStatus('success', '📋 New contact — fill and save');
    }
  } catch (err) {
    log('Error loading contact', err.message);
    showStatus('error', '❌ Failed to load: ' + err.message);
  }

  setTimeout(clearStatus, 3500);
}

// ── Header update (always visible) ────────────────────────────────────────
function updateContactHeader(name, phone) {
  const nameEl   = document.getElementById('vanto-hdr-name');
  const phoneEl  = document.getElementById('vanto-hdr-phone');
  const avatarEl = document.getElementById('vanto-avatar');
  if (nameEl)   nameEl.textContent  = name  || 'Select a chat';
  if (phoneEl)  phoneEl.textContent = phone ? `+${phone}` : '—';
  if (avatarEl) avatarEl.textContent = (name || '?')[0].toUpperCase();
}

// ── Form Populate ──────────────────────────────────────────────────────────
function populateForm(data) {
  setVal('vanto-f-name',        data.name        || '');
  setVal('vanto-f-email',       data.email       || '');
  setVal('vanto-f-lead-type',   data.lead_type   || 'prospect');
  setVal('vanto-f-temperature', data.temperature || 'cold');
  setVal('vanto-f-notes',       data.notes       || '');
  currentTags = Array.isArray(data.tags) ? [...data.tags] : [];
  renderTags();
  showFormBody();
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

// ── Tags ───────────────────────────────────────────────────────────────────
function renderTags() {
  const container = document.getElementById('vanto-tags-display');
  if (!container) return;
  container.innerHTML = currentTags.map(t => `
    <span class="vanto-tag-chip">
      ${t}
      <button class="vanto-tag-remove" data-tag="${t}" title="Remove tag">×</button>
    </span>
  `).join('');
  container.querySelectorAll('.vanto-tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTags = currentTags.filter(x => x !== btn.dataset.tag);
      renderTags();
    });
  });
}

function addTag(raw) {
  const tag = raw.trim().toLowerCase();
  if (tag && !currentTags.includes(tag)) {
    currentTags.push(tag);
    renderTags();
  }
}

// ── Show / Hide states ─────────────────────────────────────────────────────
function showNoChatState() {
  const noChatEl  = document.getElementById('vanto-no-chat');
  const formBody  = document.getElementById('vanto-form-body');
  if (noChatEl) noChatEl.style.display = 'block';
  if (formBody) formBody.style.display  = 'none';
  clearStatus();
}

function showFormSkeleton() {
  const noChatEl = document.getElementById('vanto-no-chat');
  const formBody = document.getElementById('vanto-form-body');
  if (noChatEl) noChatEl.style.display = 'none';
  if (formBody) formBody.style.display  = 'block';
}

function showFormBody() {
  showFormSkeleton();
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
  if (!currentPhone) {
    showStatus('error', '❌ No chat selected');
    setTimeout(clearStatus, 3000);
    return;
  }

  const name        = document.getElementById('vanto-f-name')?.value.trim()      || currentName || '';
  const email       = document.getElementById('vanto-f-email')?.value.trim()     || null;
  const lead_type   = document.getElementById('vanto-f-lead-type')?.value        || 'prospect';
  const temperature = document.getElementById('vanto-f-temperature')?.value      || 'cold';
  const notes       = document.getElementById('vanto-f-notes')?.value.trim()     || null;

  if (!name) {
    showStatus('error', '❌ Name is required');
    setTimeout(clearStatus, 3000);
    return;
  }

  const payload = {
    name,
    phone: currentPhone,
    email,
    lead_type,
    temperature,
    tags: currentTags,
    notes,
  };

  const saveBtn = document.getElementById('vanto-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
  showStatus('loading', '⏳ Saving contact…');

  try {
    const saved = await upsertContact(payload);
    currentContact = saved;
    log('Contact saved', saved);
    const isNew = !currentContact || (currentContact && !currentContact.id);
    showStatus('success', currentContact ? '✅ Contact updated' : '✅ Contact saved');
    if (saveBtn) saveBtn.textContent = '✅ Saved!';
    setTimeout(() => {
      if (saveBtn) { saveBtn.textContent = '💾 Save Contact'; saveBtn.disabled = false; }
      clearStatus();
    }, 2500);
  } catch (err) {
    log('Error saving contact', err.message);
    showStatus('error', '❌ Save failed: ' + err.message);
    if (saveBtn) { saveBtn.textContent = '💾 Save Contact'; saveBtn.disabled = false; }
    setTimeout(clearStatus, 4000);
  }
}

// ── Sidebar HTML ───────────────────────────────────────────────────────────
function buildSidebarHTML() {
  return `
<div id="${SIDEBAR_ID}">

  <div class="vanto-header">
    <span class="vanto-logo">⚡ Vanto CRM</span>
    <button class="vanto-close" id="vanto-close-btn" title="Hide sidebar">✕</button>
  </div>

  <div class="vanto-contact-card">
    <div class="vanto-avatar" id="vanto-avatar">?</div>
    <div class="vanto-contact-meta">
      <p class="vanto-contact-name-display" id="vanto-hdr-name">Select a chat</p>
      <p class="vanto-contact-phone-display" id="vanto-hdr-phone">—</p>
    </div>
  </div>

  <div class="vanto-status" id="vanto-status"></div>

  <div class="vanto-body">

    <div id="vanto-no-chat" class="vanto-no-chat">
      <span class="vanto-no-chat-icon">💬</span>
      Open a WhatsApp chat to load or create a contact.
    </div>

    <div id="vanto-form-body" style="display:none;">

      <div class="vanto-section">
        <p class="vanto-section-title">Contact Info</p>

        <div class="vanto-field">
          <label class="vanto-label" for="vanto-f-name">Full Name</label>
          <input class="vanto-input" id="vanto-f-name" type="text" placeholder="e.g. Olivier Agnin" />
        </div>

        <div class="vanto-field">
          <label class="vanto-label" for="vanto-f-email">Email Address</label>
          <input class="vanto-input" id="vanto-f-email" type="email" placeholder="email@example.com" />
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
        <div style="display:flex;gap:6px;">
          <input class="vanto-input" id="vanto-tag-input" type="text" placeholder="Add tag, press Enter" style="flex:1;" />
          <button class="vanto-btn" id="vanto-tag-add" style="width:auto;padding:7px 10px;">+</button>
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

  <div class="vanto-footer">
    <a href="https://chat-friend-crm.lovable.app" target="_blank" class="vanto-footer-link">Open Vanto Dashboard ↗</a>
  </div>
</div>`;
}

// ── Toggle Button ──────────────────────────────────────────────────────────
function buildToggleButton() {
  const btn = document.createElement('button');
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

  // Tag add via button
  document.getElementById('vanto-tag-add')?.addEventListener('click', () => {
    const inp = document.getElementById('vanto-tag-input');
    if (inp?.value) { addTag(inp.value); inp.value = ''; }
  });

  // Tag add via Enter key
  document.getElementById('vanto-tag-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const inp = document.getElementById('vanto-tag-input');
      if (inp?.value) { addTag(inp.value); inp.value = ''; }
    }
  });
}

// ── MutationObserver — watch header for chat changes ─────────────────────
function watchChatChanges() {
  // Polling fallback every 1.5s
  pollInterval = setInterval(() => scheduleDetection(), 1500);

  // MutationObserver on document body — fires on WA re-renders
  const bodyObserver = new MutationObserver(() => scheduleDetection());

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

  // Also observe body for larger structural changes (chat list click)
  bodyObserver.observe(document.body, { childList: true, subtree: false });

  // Observe title changes
  const titleEl = document.querySelector('title');
  if (titleEl) {
    new MutationObserver(() => scheduleDetection()).observe(titleEl, { childList: true, characterData: true, subtree: true });
  }

  tryAttachHeaderObserver();
}

// ── Inject ────────────────────────────────────────────────────────────────
function injectSidebar() {
  if (document.getElementById(SIDEBAR_ID)) return;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = buildSidebarHTML();
  document.body.appendChild(wrapper.firstElementChild);
  document.body.appendChild(buildToggleButton());

  wireEvents();
  watchChatChanges();

  // Initial detection after a short delay
  setTimeout(runDetection, 1000);

  log('Sidebar injected');
}

// ── Boot — wait for WhatsApp to load ──────────────────────────────────────
function boot() {
  const app = document.getElementById('app');
  if (app) {
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
