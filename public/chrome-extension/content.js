/**
 * Vanto CRM — WhatsApp Web Content Script
 * Injects the CRM sidebar into the WhatsApp Web interface.
 */

const VANTO_SIDEBAR_ID = 'vanto-crm-sidebar';
const VANTO_TOGGLE_ID = 'vanto-crm-toggle';

// ── State ────────────────────────────────────────────────────────────────────
let currentPhone = null;
let currentName = null;
let sidebarVisible = true;

// ── Helpers ──────────────────────────────────────────────────────────────────
function sanitizePhone(raw) {
  return (raw || '').replace(/\D/g, '');
}

function getActiveContactInfo() {
  // --- Name: try multiple WhatsApp Web selectors (WA updates DOM often) ---
  let name = null;
  const nameSelectors = [
    '[data-testid="conversation-header"] span[title]',
    'header [data-testid="conversation-info-header"] span[title]',
    'header span[dir="auto"][title]',
    '[data-testid="conv-header-participant"] span[title]',
    'header ._21S-L span[title]',
  ];
  for (const sel of nameSelectors) {
    const el = document.querySelector(sel);
    if (el && el.getAttribute('title')) {
      name = el.getAttribute('title');
      break;
    }
  }

  // --- Phone: try URL patterns WhatsApp Web uses ---
  let phone = null;

  // Pattern 1: hash-based (old) — #/chat/27821234567@s.whatsapp.net
  const hash = window.location.hash;
  const hashMatch = hash.match(/\/chat\/(\d+)@/);
  if (hashMatch) phone = hashMatch[1];

  // Pattern 2: search param — ?phone=27821234567
  if (!phone) {
    const params = new URLSearchParams(window.location.search);
    const p = params.get('phone');
    if (p) phone = sanitizePhone(p);
  }

  // Pattern 3: DOM — phone number often visible in header subtitle
  if (!phone) {
    const subtitleSelectors = [
      '[data-testid="conversation-header"] span[title]:last-child',
      'header [data-testid="conversation-info-header"] div:last-child span',
      'header ._21S-L + div span',
      '[data-testid="conv-header-participant"] div span',
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

  // Pattern 4: look in <title> tag — WhatsApp Web sets tab title to contact name / number
  if (!phone) {
    const titleText = document.title || '';
    const titleMatch = titleText.match(/\+?(\d{7,15})/);
    if (titleMatch) phone = titleMatch[1];
  }

  return { name, phone };
}

// ── Sidebar HTML ─────────────────────────────────────────────────────────────
function buildSidebarHTML() {
  return `
    <div id="${VANTO_SIDEBAR_ID}" class="vanto-sidebar">
      <div class="vanto-header">
        <span class="vanto-logo">⚡ Vanto CRM</span>
        <button class="vanto-close" id="vanto-close-btn" title="Hide sidebar">✕</button>
      </div>

      <div class="vanto-contact-card" id="vanto-contact-card">
        <div class="vanto-avatar" id="vanto-avatar">?</div>
        <div class="vanto-contact-info">
          <p class="vanto-contact-name" id="vanto-contact-name">Select a chat</p>
          <p class="vanto-contact-phone" id="vanto-contact-phone">—</p>
        </div>
      </div>

      <div class="vanto-tags-row">
        <span class="vanto-tag vanto-tag-hot" id="vanto-tag-temp">—</span>
        <span class="vanto-tag vanto-tag-stage" id="vanto-tag-stage">—</span>
      </div>

      <div class="vanto-section">
        <p class="vanto-section-title">Quick Actions</p>
        <div class="vanto-actions">
          <button class="vanto-btn vanto-btn-primary" id="vanto-save-btn">💾 Save Contact</button>
          <button class="vanto-btn" id="vanto-note-btn">📝 Add Note</button>
          <button class="vanto-btn" id="vanto-ai-btn">🤖 AI Reply</button>
        </div>
      </div>

      <div class="vanto-section" id="vanto-note-area" style="display:none;">
        <p class="vanto-section-title">Add Note</p>
        <textarea class="vanto-textarea" id="vanto-note-input" placeholder="Enter note..."></textarea>
        <button class="vanto-btn vanto-btn-primary" id="vanto-note-save">Save Note</button>
      </div>

      <div class="vanto-section" id="vanto-ai-area" style="display:none;">
        <p class="vanto-section-title">🤖 AI Suggestion</p>
        <div class="vanto-ai-bubble" id="vanto-ai-bubble">Generating reply…</div>
        <button class="vanto-btn" id="vanto-ai-copy">Copy to Clipboard</button>
      </div>

      <div class="vanto-section">
        <p class="vanto-section-title">Notes</p>
        <div class="vanto-notes-list" id="vanto-notes-list">
          <p class="vanto-empty">No notes yet</p>
        </div>
      </div>

      <div class="vanto-footer">
        <a href="https://chat-friend-crm.lovable.app" target="_blank" class="vanto-footer-link">Open Vanto Dashboard ↗</a>
      </div>
    </div>
  `;
}

// ── Toggle Button ─────────────────────────────────────────────────────────────
function buildToggleButton() {
  const btn = document.createElement('button');
  btn.id = VANTO_TOGGLE_ID;
  btn.className = 'vanto-toggle-btn';
  btn.title = 'Open Vanto CRM';
  btn.innerHTML = '⚡';
  btn.addEventListener('click', showSidebar);
  return btn;
}

// ── Sidebar Controls ──────────────────────────────────────────────────────────
function showSidebar() {
  const sidebar = document.getElementById(VANTO_SIDEBAR_ID);
  const toggle = document.getElementById(VANTO_TOGGLE_ID);
  if (sidebar) sidebar.style.display = 'flex';
  if (toggle) toggle.style.display = 'none';
  sidebarVisible = true;
}

function hideSidebar() {
  const sidebar = document.getElementById(VANTO_SIDEBAR_ID);
  const toggle = document.getElementById(VANTO_TOGGLE_ID);
  if (sidebar) sidebar.style.display = 'none';
  if (toggle) toggle.style.display = 'flex';
  sidebarVisible = false;
}

// ── Update Sidebar UI with contact ───────────────────────────────────────────
function updateSidebarContact(name, phone) {
  const nameEl = document.getElementById('vanto-contact-name');
  const phoneEl = document.getElementById('vanto-contact-phone');
  const avatarEl = document.getElementById('vanto-avatar');
  if (nameEl) nameEl.textContent = name || 'Unknown';
  if (phoneEl) phoneEl.textContent = phone ? `+${phone}` : '—';
  if (avatarEl) avatarEl.textContent = (name || '?')[0].toUpperCase();

  // Load from storage
  loadContactData(phone);
}

// ── Storage Helpers ───────────────────────────────────────────────────────────
function storageKey(phone) {
  return `vanto_contact_${phone}`;
}

function loadContactData(phone) {
  if (!phone) return;
  chrome.storage.local.get([storageKey(phone)], (result) => {
    const data = result[storageKey(phone)] || {};
    renderNotes(data.notes || []);
    updateTags(data.temperature || null, data.stage || null);
  });
}

function saveContactData(phone, patch) {
  if (!phone) return;
  const key = storageKey(phone);
  chrome.storage.local.get([key], (result) => {
    const existing = result[key] || {};
    const updated = { ...existing, ...patch };
    chrome.storage.local.set({ [key]: updated });
  });
}

function renderNotes(notes) {
  const list = document.getElementById('vanto-notes-list');
  if (!list) return;
  if (!notes.length) {
    list.innerHTML = '<p class="vanto-empty">No notes yet</p>';
    return;
  }
  list.innerHTML = notes.map(n => `
    <div class="vanto-note-item">
      <p class="vanto-note-text">${n.text}</p>
      <p class="vanto-note-date">${n.date}</p>
    </div>
  `).join('');
}

function updateTags(temperature, stage) {
  const tempEl = document.getElementById('vanto-tag-temp');
  const stageEl = document.getElementById('vanto-tag-stage');
  if (tempEl) {
    tempEl.textContent = temperature ? `🔥 ${temperature}` : '—';
    tempEl.className = `vanto-tag vanto-tag-${temperature || 'default'}`;
  }
  if (stageEl) stageEl.textContent = stage || '—';
}

// ── AI Reply Stub ─────────────────────────────────────────────────────────────
function generateAIReply() {
  const bubble = document.getElementById('vanto-ai-bubble');
  if (bubble) bubble.textContent = 'Generating reply…';

  // Get last message from WA DOM
  const messages = document.querySelectorAll('[data-testid="msg-container"]');
  const lastMsg = messages.length ? messages[messages.length - 1].innerText : '';

  setTimeout(() => {
    const replies = [
      `Thanks for reaching out! I'd love to help you with that. Could you share more details?`,
      `Great question! Let me get back to you shortly with the best option.`,
      `Hi ${currentName || 'there'}! Appreciate your message. I'll follow up very soon.`,
      `Of course! Happy to assist. Let me check and revert to you within the hour.`,
    ];
    const reply = replies[Math.floor(Math.random() * replies.length)];
    if (bubble) bubble.textContent = reply;
  }, 800);
}

// ── Event Wiring ──────────────────────────────────────────────────────────────
function wireEvents() {
  document.getElementById('vanto-close-btn')?.addEventListener('click', hideSidebar);

  document.getElementById('vanto-save-btn')?.addEventListener('click', () => {
    if (!currentPhone) return alert('Open a WhatsApp chat first.');
    saveContactData(currentPhone, { name: currentName, phone: currentPhone, savedAt: new Date().toISOString() });
    const btn = document.getElementById('vanto-save-btn');
    if (btn) { btn.textContent = '✅ Saved!'; setTimeout(() => { btn.textContent = '💾 Save Contact'; }, 2000); }
  });

  document.getElementById('vanto-note-btn')?.addEventListener('click', () => {
    const area = document.getElementById('vanto-note-area');
    if (area) area.style.display = area.style.display === 'none' ? 'block' : 'none';
  });

  document.getElementById('vanto-note-save')?.addEventListener('click', () => {
    const input = document.getElementById('vanto-note-input');
    const text = input?.value?.trim();
    if (!text || !currentPhone) return;
    const key = storageKey(currentPhone);
    chrome.storage.local.get([key], (result) => {
      const data = result[key] || {};
      const notes = data.notes || [];
      notes.unshift({ text, date: new Date().toLocaleDateString() });
      chrome.storage.local.set({ [key]: { ...data, notes } }, () => {
        renderNotes(notes);
        if (input) input.value = '';
        const area = document.getElementById('vanto-note-area');
        if (area) area.style.display = 'none';
      });
    });
  });

  document.getElementById('vanto-ai-btn')?.addEventListener('click', () => {
    const area = document.getElementById('vanto-ai-area');
    if (area) area.style.display = area.style.display === 'none' ? 'block' : 'none';
    generateAIReply();
  });

  document.getElementById('vanto-ai-copy')?.addEventListener('click', () => {
    const text = document.getElementById('vanto-ai-bubble')?.textContent;
    if (text) navigator.clipboard.writeText(text);
  });
}

// ── Chat change detection via MutationObserver on the header ─────────────────
function watchChatChanges() {
  // Poll as fallback every second for URL/title changes
  let lastKey = '';
  setInterval(() => {
    const { name, phone } = getActiveContactInfo();
    const key = `${name}|${phone}`;
    if (key !== lastKey) {
      lastKey = key;
      currentPhone = phone;
      currentName = name;
      updateSidebarContact(name, phone);
    }
  }, 800);

  // Also watch DOM mutations on the header area so we react faster
  const headerObserver = new MutationObserver(() => {
    const { name, phone } = getActiveContactInfo();
    const key = `${name}|${phone}`;
    if (key !== lastKey) {
      lastKey = key;
      currentPhone = phone;
      currentName = name;
      updateSidebarContact(name, phone);
    }
  });

  // Observe the header element once it exists
  function attachHeaderObserver() {
    const header = document.querySelector('header') ||
                   document.querySelector('[data-testid="conversation-header"]');
    if (header) {
      headerObserver.observe(header, { childList: true, subtree: true, characterData: true });
    } else {
      // Retry if header not yet in DOM
      setTimeout(attachHeaderObserver, 1000);
    }
  }
  attachHeaderObserver();
}

// ── Inject Sidebar ────────────────────────────────────────────────────────────
function injectSidebar() {
  if (document.getElementById(VANTO_SIDEBAR_ID)) return;

  // Inject sidebar wrapper
  const wrapper = document.createElement('div');
  wrapper.innerHTML = buildSidebarHTML();
  document.body.appendChild(wrapper.firstElementChild);

  // Inject toggle button
  document.body.appendChild(buildToggleButton());

  wireEvents();
  watchChatChanges();
}

// ── Wait for WA to load, then inject ─────────────────────────────────────────
function waitForWhatsApp() {
  const observer = new MutationObserver(() => {
    const app = document.getElementById('app');
    if (app) {
      observer.disconnect();
      setTimeout(injectSidebar, 1500);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

waitForWhatsApp();
