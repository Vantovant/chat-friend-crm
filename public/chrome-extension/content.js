// Vanto CRM Chrome Extension — Content Script v7.0.0 (MVP)
// Purpose: detect the currently-open WhatsApp chat (name + phone) and let
// the user save it to Vanto CRM. Nothing else.
//
// Removed in v7.0.0 (handled by the web app now):
//   - Group campaign automation / scheduled posting / executeGroupPost
//   - WhatsApp Name Sync (bulk chat-list harvesting)
//   - Message injection / send button automation
//   - Search-input automation
//   - Alarms / polling / heartbeats

(function () {
  'use strict';

  const VERSION = '7.0.0 (MVP)';
  const DASHBOARD_URL = 'https://chat.onlinecourseformlm.com';
  const DETECTION_DEBOUNCE_MS = 600;
  const MAX_NAME_LENGTH = 255;

  function log(...args) { console.log(`[Vanto CS v${VERSION}]`, ...args); }
  function logError(...args) { console.error(`[Vanto CS v${VERSION}]`, ...args); }

  // ---------- State ----------
  let sidebar = null;
  let toggleButton = null;
  let session = { token: null, email: null };
  let teamMembers = [];
  let detectionTimer = null;
  let lastDetectedPhone = null;
  let lastDetectedName = null;
  let isGroupChat = false;

  // ---------- Selectors ----------
  const NAME_SELECTORS = [
    '[data-testid="conversation-header"] span[title]',
    '[data-testid="conversation-info-header-chat-title"] span',
    'header span[dir="auto"][title]',
    '#main header span[title]',
    '#main header span[dir="auto"]'
  ];

  // ---------- Sanitization ----------
  function sanitize(text) {
    if (!text) return null;
    const trimmed = String(text).trim();
    if (!trimmed) return null;
    if (trimmed.length > MAX_NAME_LENGTH) return null;
    const newlines = (trimmed.match(/\n/g) || []).length;
    if (newlines > 3) return null;
    return trimmed.substring(0, MAX_NAME_LENGTH).trim();
  }

  // ---------- Detection ----------
  function detectContactName() {
    for (const sel of NAME_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const title = el.getAttribute && el.getAttribute('title');
        const candidate = sanitize(title) || sanitize(el.textContent);
        if (candidate) return candidate;
      } catch (_) { /* try next */ }
    }
    return null;
  }

  function detectPhoneNumber() {
    // From #main[data-id]
    const mainEl = document.querySelector('#main[data-id]');
    if (mainEl) {
      const m = (mainEl.getAttribute('data-id') || '').match(/(\d{7,15})@/);
      if (m) return m[1];
    }
    // From URL hash
    const m2 = (window.location.hash || '').match(/chat\/(\d{7,15})@/);
    if (m2) return m2[1];
    // From any element with data-id inside #main
    const els = document.querySelectorAll('#main [data-id]');
    for (const el of els) {
      const m3 = (el.getAttribute('data-id') || '').match(/(\d{7,15})@/);
      if (m3) return m3[1];
    }
    // From header subtitle text
    const spans = document.querySelectorAll('#main header span');
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      if (/^\+?\d[\d\s\-(). ]{5,}$/.test(t)) {
        const digits = t.replace(/\D/g, '');
        if (digits.length >= 7) return digits;
      }
    }
    return null;
  }

  function detectIsGroup() {
    const mainEl = document.querySelector('#main');
    if (mainEl) {
      const id = mainEl.getAttribute('data-id') || '';
      if (id.includes('@g.us')) return true;
    }
    return (window.location.hash || '').includes('@g.us');
  }

  // ---------- Sidebar UI ----------
  function createSidebar() {
    if (sidebar) return;

    sidebar = document.createElement('div');
    sidebar.id = 'vanto-crm-sidebar';
    sidebar.innerHTML = `
      <div class="vanto-header">
        <div class="vanto-logo">Vanto CRM</div>
        <button class="vanto-close-btn" id="vanto-close">&times;</button>
      </div>

      <div id="vanto-auth-banner" class="vanto-auth-banner" style="display:none;">
        <p><strong>Extension not logged in</strong></p>
        <p style="font-size:12px;margin:6px 0;opacity:.9;">
          Click the Vanto extension icon in the Chrome toolbar and sign in with your CRM email & password.
        </p>
        <a href="${DASHBOARD_URL}" target="_blank" style="font-size:12px;">Open Dashboard →</a>
      </div>

      <div class="vanto-contact-card">
        <div class="vanto-avatar" id="vanto-avatar">?</div>
        <div class="vanto-contact-info">
          <div class="vanto-contact-name" id="vanto-display-name">No chat selected</div>
          <div class="vanto-contact-phone" id="vanto-display-phone"></div>
        </div>
      </div>

      <div class="vanto-status" id="vanto-status" style="display:none;"></div>

      <div class="vanto-body">
        <div id="vanto-no-chat">
          <p>Click on a WhatsApp chat to capture contact details.</p>
        </div>

        <div id="vanto-group-banner" style="display:none;">
          <div class="vanto-group-icon">👥</div>
          <p><strong>Group chat detected</strong></p>
          <p style="font-size:12px;opacity:.8;margin-top:6px;">
            Group campaigns are managed inside the Vanto CRM web app — open the dashboard to use them.
          </p>
        </div>

        <div id="vanto-form-body" style="display:none;">
          <div class="vanto-field">
            <label>Name</label>
            <input type="text" id="vanto-name" class="vanto-input" placeholder="Contact name">
          </div>
          <div class="vanto-field">
            <label>Phone</label>
            <input type="text" id="vanto-phone" class="vanto-input" placeholder="Phone number">
          </div>
          <div class="vanto-field">
            <label>Email</label>
            <input type="email" id="vanto-email" class="vanto-input" placeholder="Email (optional)">
          </div>
          <div class="vanto-field">
            <label>Lead Type</label>
            <select id="vanto-lead-type" class="vanto-select">
              <option value="Prospect">Prospect</option>
              <option value="Registered_Nopurchase">Registered (no purchase)</option>
              <option value="Purchase_Nostatus">Purchase (no status)</option>
              <option value="Purchase_Status">Purchase (status)</option>
              <option value="Expired">Expired</option>
            </select>
          </div>
          <div class="vanto-field">
            <label>Assign To</label>
            <select id="vanto-assigned-to" class="vanto-select">
              <option value="">Unassigned</option>
            </select>
          </div>
          <div class="vanto-field">
            <label>Tags</label>
            <input type="text" id="vanto-tags" class="vanto-input" placeholder="Comma separated">
          </div>
          <div class="vanto-field">
            <label>Notes</label>
            <textarea id="vanto-notes" class="vanto-textarea" placeholder="Add a quick note..."></textarea>
          </div>
          <button class="vanto-btn vanto-btn-primary" id="vanto-save">Save Contact</button>
        </div>
      </div>

      <div class="vanto-footer">
        <a href="${DASHBOARD_URL}" target="_blank">Open Dashboard →</a>
        <div style="font-size:10px;opacity:.5;margin-top:4px;">v${VERSION}</div>
      </div>
    `;

    // Prevent events from bubbling into WhatsApp
    ['keydown', 'keyup', 'keypress', 'click'].forEach((evt) => {
      sidebar.addEventListener(evt, (e) => e.stopPropagation());
    });

    document.body.appendChild(sidebar);
    wireEvents();
  }

  function createToggleButton() {
    if (toggleButton) return;
    toggleButton = document.createElement('button');
    toggleButton.id = 'vanto-crm-toggle';
    toggleButton.innerHTML = 'V';
    toggleButton.title = 'Toggle Vanto CRM';
    toggleButton.addEventListener('click', () => {
      if (sidebar) {
        sidebar.classList.toggle('hidden');
        toggleButton.classList.toggle('active');
      }
    });
    document.body.appendChild(toggleButton);
  }

  function wireEvents() {
    document.getElementById('vanto-close')?.addEventListener('click', () => {
      sidebar.classList.add('hidden');
      toggleButton?.classList.add('active');
    });
    document.getElementById('vanto-save')?.addEventListener('click', saveContact);
  }

  // ---------- UI updates ----------
  function showStatus(message, type = 'info') {
    const el = document.getElementById('vanto-status');
    if (!el) return;
    el.textContent = message;
    el.className = 'vanto-status ' + type;
    el.style.display = 'block';
    if (type === 'success') {
      setTimeout(() => { el.style.display = 'none'; }, 3000);
    }
  }

  function updateUI() {
    const noChatEl = document.getElementById('vanto-no-chat');
    const formBodyEl = document.getElementById('vanto-form-body');
    const groupBannerEl = document.getElementById('vanto-group-banner');
    const authBannerEl = document.getElementById('vanto-auth-banner');
    const displayNameEl = document.getElementById('vanto-display-name');
    const displayPhoneEl = document.getElementById('vanto-display-phone');
    const avatarEl = document.getElementById('vanto-avatar');

    if (authBannerEl) authBannerEl.style.display = session.token ? 'none' : 'block';
    if (displayNameEl) displayNameEl.textContent = lastDetectedName || 'No chat selected';
    if (avatarEl) avatarEl.textContent = (lastDetectedName || '?').charAt(0).toUpperCase();

    if (isGroupChat) {
      if (noChatEl) noChatEl.style.display = 'none';
      if (formBodyEl) formBodyEl.style.display = 'none';
      if (groupBannerEl) groupBannerEl.style.display = 'block';
      if (displayPhoneEl) displayPhoneEl.textContent = 'Group Chat';
    } else if (lastDetectedPhone || lastDetectedName) {
      if (noChatEl) noChatEl.style.display = 'none';
      if (groupBannerEl) groupBannerEl.style.display = 'none';
      if (formBodyEl) formBodyEl.style.display = 'block';
      if (displayPhoneEl) displayPhoneEl.textContent = lastDetectedPhone || '';

      const nameInput = document.getElementById('vanto-name');
      const phoneInput = document.getElementById('vanto-phone');
      if (nameInput && lastDetectedName && !nameInput.value) nameInput.value = lastDetectedName;
      if (phoneInput && lastDetectedPhone && !phoneInput.value) phoneInput.value = lastDetectedPhone;
    } else {
      if (noChatEl) noChatEl.style.display = 'block';
      if (formBodyEl) formBodyEl.style.display = 'none';
      if (groupBannerEl) groupBannerEl.style.display = 'none';
      if (displayPhoneEl) displayPhoneEl.textContent = '';
    }
  }

  // ---------- Save ----------
  async function saveContact() {
    if (!session.token) {
      showStatus('Click the Vanto extension icon and log in first.', 'error');
      return;
    }

    // Force fresh detection just before save
    const freshPhone = detectPhoneNumber();
    if (freshPhone) lastDetectedPhone = freshPhone;
    const freshName = detectContactName();
    if (freshName) lastDetectedName = freshName;

    const phoneFieldVal = (document.getElementById('vanto-phone').value || '').trim();
    const effectivePhone = phoneFieldVal || lastDetectedPhone || '';
    const effectiveWaId = lastDetectedPhone || (phoneFieldVal ? phoneFieldVal.replace(/\D/g, '') : null);

    if (!effectivePhone && !effectiveWaId) {
      showStatus('Open the chat fully (click into it) or enter the number manually.', 'error');
      return;
    }

    const payload = {
      name: document.getElementById('vanto-name').value,
      phone: effectivePhone,
      email: document.getElementById('vanto-email').value || null,
      lead_type: document.getElementById('vanto-lead-type').value,
      assigned_to: document.getElementById('vanto-assigned-to').value || null,
      tags: document.getElementById('vanto-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
      notes: document.getElementById('vanto-notes').value || null,
      whatsapp_id: effectiveWaId
    };

    showStatus('Saving...', 'loading');
    try {
      const response = await chrome.runtime.sendMessage({ type: 'VANTO_SAVE_CONTACT', payload });
      if (response && response.success) showStatus('Contact saved!', 'success');
      else showStatus('Error: ' + (response?.error || 'unknown'), 'error');
    } catch (err) {
      logError('Save contact error', err);
      showStatus('Error saving contact', 'error');
    }
  }

  // ---------- Team load (for Assign To dropdown) ----------
  async function loadTeamMembers() {
    if (!session.token) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'VANTO_LOAD_TEAM' });
      if (response && response.success && Array.isArray(response.data)) {
        teamMembers = response.data;
        const sel = document.getElementById('vanto-assigned-to');
        if (sel) {
          sel.innerHTML = '<option value="">Unassigned</option>';
          teamMembers.forEach((m) => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.textContent = m.full_name || m.email;
            sel.appendChild(opt);
          });
        }
      }
    } catch (e) { logError('loadTeamMembers', e); }
  }

  // ---------- Detection scheduling ----------
  function scheduleDetection() {
    if (detectionTimer) clearTimeout(detectionTimer);
    detectionTimer = setTimeout(runDetection, DETECTION_DEBOUNCE_MS);
  }

  function runDetection() {
    const name = detectContactName();
    if (name !== lastDetectedName) lastDetectedName = name;
    isGroupChat = detectIsGroup();
    if (isGroupChat) {
      lastDetectedPhone = null;
    } else {
      const phone = detectPhoneNumber();
      if (phone !== lastDetectedPhone) lastDetectedPhone = phone;
    }
    updateUI();
  }

  function watchChatChanges() {
    // Lightweight MutationObserver scoped to #main — no full-body polling
    const target = document.querySelector('#main') || document.body;
    const observer = new MutationObserver(scheduleDetection);
    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-id']
    });
    // Catch URL hash changes (chat switches)
    window.addEventListener('hashchange', scheduleDetection);
  }

  // ---------- Auth ----------
  async function checkAuthState() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'VANTO_GET_SESSION' });
      if (response && response.token) {
        session.token = response.token;
        session.email = response.email;
        await loadTeamMembers();
      }
    } catch (e) { logError('checkAuthState', e); }
    updateUI();
  }

  // ---------- Background → content messages ----------
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      switch (message.type) {
        case 'VANTO_SESSION_UPDATE':
          session.token = message.token;
          session.email = message.email;
          await loadTeamMembers();
          updateUI();
          sendResponse({ success: true });
          break;
        case 'VANTO_TOKEN_CLEARED':
          session = { token: null, email: null };
          teamMembers = [];
          updateUI();
          sendResponse({ success: true });
          break;
        case 'VANTO_PING':
          sendResponse({ success: true, pong: true });
          break;
        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    })();
    return true;
  });

  // ---------- Init ----------
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async function init() {
    log('Initializing MVP...');
    // Wait briefly for WhatsApp to render
    let attempts = 0;
    while (attempts < 20) {
      if (document.querySelector('#app')) break;
      await sleep(500);
      attempts++;
    }
    try {
      createSidebar();
      createToggleButton();
      await checkAuthState();
      watchChatChanges();
      runDetection();
      log('Initialized');
    } catch (e) {
      logError('init failed', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 100));
  } else {
    setTimeout(init, 500);
  }
})();
