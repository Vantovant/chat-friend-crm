// Vanto CRM Chrome Extension - Content Script v6.0
// LOVABLE EDITION - Uses chat.onlinecourseformlm.com
// Enhanced with microstage tracing, stage timeouts, and detailed logging

(function() {
  'use strict';

  // =====================================================
  // CONFIGURATION - LOVABLE EDITION
  // =====================================================
  const VERSION = '6.0.0 (Lovable)';
  const DASHBOARD_URL = 'https://chat.onlinecourseformlm.com';
  const DETECTION_DEBOUNCE_MS = 600;
  const POLLING_INTERVAL_MS = 1500;

  // Microstage timeouts (in milliseconds) - increased for reliability
  const STAGE_TIMEOUTS = {
    open_search: 10000,      // 10s to open search
    search_group: 15000,     // 15s to search for group
    select_group: 8000,      // 8s to select group
    wait_chat_open: 12000,   // 12s to wait for chat to open
    find_input: 10000,       // 10s to find input box
    inject_message: 8000,    // 8s to inject message
    find_send_button: 10000, // 10s to find send button
    click_send: 8000,        // 8s to click send
    confirm_sent: 12000      // 12s to confirm message sent
  };

  // Total execution timeout
  const TOTAL_EXECUTION_TIMEOUT = 90000; // 90 seconds

  // =====================================================
  // LOGGING UTILITY
  // =====================================================
  let executionId = 0;

  function log(message, data = null) {
    const timestamp = new Date().toISOString();
    const prefix = `[VANTO CS (Lovable) v${VERSION} ${timestamp}]`;
    if (data) {
      console.log(prefix, message, data);
    } else {
      console.log(prefix, message);
    }
  }

  function logStage(stage, status, data = null) {
    const eid = executionId;
    const msg = `[EXEC ${eid}] Stage: ${stage} - ${status}`;
    log(msg, data);
  }

  function logError(message, error = null) {
    const timestamp = new Date().toISOString();
    const prefix = `[VANTO CS ERROR (Lovable) ${timestamp}]`;
    if (error) {
      console.error(prefix, message, error);
    } else {
      console.error(prefix, message);
    }
  }

  // =====================================================
  // STATE
  // =====================================================
  let sidebar = null;
  let toggleButton = null;
  let session = { token: null, email: null };
  let teamMembers = [];
  let detectionTimer = null;
  let lastDetectedPhone = null;
  let lastDetectedName = null;
  let isGroupChat = false;
  let currentGroupName = null;

  // Execution state tracking
  let currentExecution = null;

  // =====================================================
  // DOM SELECTOR CASCADES
  // =====================================================
  const SELECTORS = {
    // Contact name selectors (priority order)
    contactName: [
      '[data-testid="conversation-header"] span[title]',
      '[data-testid="conversation-info-header-chat-title"] span',
      '[data-testid="conversation-info-header-chat-title"]',
      'header [data-testid="conversation-info-header"] span[title]',
      'header span[dir="auto"][title]',
      '#main header span[title]',
      '#main header span[dir="auto"]',
      '#main header > div > div > div > div span[title]'
    ],

    // Phone number sources
    phoneFromMainDataId: '#main[data-id]',
    phoneFromUrl: () => window.location.hash,
    phoneFromElements: '#main [data-id]',

    // Search input
    searchInput: [
      '[data-testid="chat-list-search-input"]',
      'div[contenteditable="true"][data-tab="3"]',
      'div[role="textbox"][title="Search input textbox"]'
    ],

    // Search icon/button
    searchIcon: [
      '[data-testid="chat-list-search"]',
      '[data-icon="search"]',
      'button[aria-label="Search"]'
    ],

    // Message input
    messageInput: [
      '[data-testid="conversation-compose-box-input"]',
      'div[contenteditable="true"][data-tab="10"]',
      '#main footer div[contenteditable="true"]',
      'div[role="textbox"][title="Type a message"]',
      '#main footer [contenteditable="true"]'
    ],

    // Send button
    sendButton: [
      '[data-testid="send"]',
      'button[aria-label="Send"]',
      'span[data-icon="send"]',
      '[data-testid="compose-btn-send"]',
      'button[data-tab="11"]'
    ],

    // Clear search
    clearSearch: [
      '[data-testid="x-alt"]',
      '[data-icon="x-alt"]',
      '[data-testid="search-close"]',
      'button[aria-label="Cancel search"]'
    ],

    // Chat list items
    chatListItems: '#pane-side [role="listitem"]',
    groupIndicator: '[data-id*="@g.us"]'
  };

  // =====================================================
  // DOM UTILITIES
  // =====================================================
  function findElement(selectors, label = 'element') {
    for (const selector of selectors) {
      try {
        const element = document.querySelector(selector);
        if (element) {
          log(`Found ${label} with selector: ${selector}`);
          return element;
        }
      } catch (e) {
        logError(`Invalid selector for ${label}: ${selector}`, e);
      }
    }
    logError(`${label} not found with any selector`, selectors);
    return null;
  }

  function waitForElement(selectors, timeout = 5000, label = 'element') {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      function check() {
        const element = findElement(selectors, label);
        if (element) {
          resolve(element);
          return;
        }

        if (Date.now() - startTime > timeout) {
          reject(new Error(`${label} not found within ${timeout}ms`));
          return;
        }

        requestAnimationFrame(check);
      }

      check();
    });
  }

  // =====================================================
  // DETECTION FUNCTIONS
  // =====================================================
  function detectContactName() {
    for (const selector of SELECTORS.contactName) {
      try {
        const el = document.querySelector(selector);
        if (el && el.textContent) {
          return el.textContent.trim();
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    return null;
  }

  function detectPhoneNumber() {
    // Priority 0: From #main[data-id]
    const mainEl = document.querySelector(SELECTORS.phoneFromMainDataId);
    if (mainEl) {
      const dataId = mainEl.getAttribute('data-id');
      if (dataId) {
        const match = dataId.match(/(\d{7,15})@/);
        if (match) {
          log('Phone detected from #main[data-id]:', match[1]);
          return match[1];
        }
      }
    }

    // Priority 1: From URL hash
    const hash = SELECTORS.phoneFromUrl();
    if (hash) {
      const match = hash.match(/chat\/(\d{7,15})@/);
      if (match) {
        log('Phone detected from URL:', match[1]);
        return match[1];
      }
    }

    // Priority 2: From elements with data-id
    const dataIdElements = document.querySelectorAll(SELECTORS.phoneFromElements);
    for (const el of dataIdElements) {
      const dataId = el.getAttribute('data-id');
      if (dataId) {
        const match = dataId.match(/(\d{7,15})@/);
        if (match) {
          log('Phone detected from element data-id:', match[1]);
          return match[1];
        }
      }
    }

    // Priority 3: From header subtitle
    const headerSpans = document.querySelectorAll('#main header span');
    for (const span of headerSpans) {
      const text = span.textContent || '';
      if (/^\+?\d[\d\s\-(). ]{5,}$/.test(text)) {
        const phone = text.replace(/\D/g, '');
        if (phone.length >= 7) {
          log('Phone detected from header:', phone);
          return phone;
        }
      }
    }

    return null;
  }

  function detectGroupChat() {
    // Check for @g.us in data-id attributes
    const mainEl = document.querySelector('#main');
    if (mainEl) {
      const dataId = mainEl.getAttribute('data-id');
      if (dataId && dataId.includes('@g.us')) {
        log('Group chat detected from data-id');
        return true;
      }
    }

    // Check URL hash
    const hash = window.location.hash;
    if (hash && hash.includes('@g.us')) {
      log('Group chat detected from URL');
      return true;
    }

    // Check for group indicators in DOM
    const groupIndicator = document.querySelector(SELECTORS.groupIndicator);
    if (groupIndicator) {
      log('Group chat detected from DOM indicator');
      return true;
    }

    return false;
  }

  function detectGroupName() {
    // Get group name from contact name detection
    return detectContactName();
  }

  // =====================================================
  // SIDEBAR UI
  // =====================================================
  function createSidebar() {
    if (sidebar) return;

    log('Creating sidebar...');

    sidebar = document.createElement('div');
    sidebar.id = 'vanto-crm-sidebar';
    sidebar.innerHTML = `
      <div class="vanto-header">
        <div class="vanto-logo">Vanto CRM</div>
        <button class="vanto-close-btn" id="vanto-close">&times;</button>
      </div>
      <div id="vanto-auth-banner" class="vanto-auth-banner" style="display: none;">
        <p>Please log in to save contacts</p>
        <a href="${DASHBOARD_URL}" target="_blank">Open Dashboard</a>
      </div>
      <div class="vanto-contact-card">
        <div class="vanto-avatar" id="vanto-avatar">?</div>
        <div class="vanto-contact-info">
          <div class="vanto-contact-name" id="vanto-display-name">No chat selected</div>
          <div class="vanto-contact-phone" id="vanto-display-phone"></div>
        </div>
      </div>
      <div class="vanto-status" id="vanto-status" style="display: none;"></div>
      <div class="vanto-body">
        <div id="vanto-no-chat">
          <p>Click on a WhatsApp chat to capture contact details</p>
        </div>
        <div id="vanto-group-banner" style="display: none;">
          <div class="vanto-group-icon">👥</div>
          <p>Group Chat Detected</p>
          <p class="vanto-group-name" id="vanto-group-name"></p>
          <button class="vanto-btn vanto-btn-primary" id="vanto-save-group">Save Group</button>
        </div>
        <div id="vanto-form-body" style="display: none;">
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
            <input type="email" id="vanto-email" class="vanto-input" placeholder="Email address">
          </div>
          <div class="vanto-field">
            <label>Lead Type</label>
            <select id="vanto-lead-type" class="vanto-select">
              <option value="prospect">Prospect</option>
              <option value="registered">Registered</option>
              <option value="buyer">Buyer</option>
              <option value="vip">VIP</option>
              <option value="expired">Expired</option>
            </select>
          </div>
          <div class="vanto-field">
            <label>Temperature</label>
            <select id="vanto-temperature" class="vanto-select">
              <option value="warm">Warm</option>
              <option value="hot">Hot</option>
              <option value="cold">Cold</option>
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
            <input type="text" id="vanto-tags" class="vanto-input" placeholder="Comma separated tags">
          </div>
          <div class="vanto-field">
            <label>Notes</label>
            <textarea id="vanto-notes" class="vanto-textarea" placeholder="Add notes..."></textarea>
          </div>
          <button class="vanto-btn vanto-btn-primary" id="vanto-save">Save Contact</button>
        </div>
      </div>
      <div class="vanto-footer">
        <a href="${DASHBOARD_URL}" target="_blank">Open Dashboard →</a>
      </div>
    `;

    // Prevent events from propagating to WhatsApp
    ['keydown', 'keyup', 'keypress', 'click'].forEach(function(evt) {
      sidebar.addEventListener(evt, function(e) {
        e.stopPropagation();
      });
    });

    document.body.appendChild(sidebar);
    wireEvents();
    log('Sidebar created');
  }

  function createToggleButton() {
    if (toggleButton) return;

    toggleButton = document.createElement('button');
    toggleButton.id = 'vanto-crm-toggle';
    toggleButton.innerHTML = 'V';
    toggleButton.title = 'Toggle Vanto CRM Sidebar';
    toggleButton.addEventListener('click', () => {
      if (sidebar) {
        sidebar.classList.toggle('hidden');
        toggleButton.classList.toggle('active');
      }
    });

    document.body.appendChild(toggleButton);
    log('Toggle button created');
  }

  // =====================================================
  // EVENT WIRING
  // =====================================================
  function wireEvents() {
    // Close button
    const closeBtn = document.getElementById('vanto-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        sidebar.classList.add('hidden');
        toggleButton.classList.add('active');
      });
    }

    // Save contact button
    const saveBtn = document.getElementById('vanto-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', saveContact);
    }

    // Save group button
    const saveGroupBtn = document.getElementById('vanto-save-group');
    if (saveGroupBtn) {
      saveGroupBtn.addEventListener('click', saveGroup);
    }
  }

  // =====================================================
  // SAVE FUNCTIONS
  // =====================================================
  async function saveContact() {
    if (!session.token) {
      showStatus('Please log in first', 'error');
      return;
    }

    const payload = {
      name: document.getElementById('vanto-name').value,
      phone: document.getElementById('vanto-phone').value,
      email: document.getElementById('vanto-email').value || null,
      lead_type: document.getElementById('vanto-lead-type').value,
      temperature: document.getElementById('vanto-temperature').value,
      assigned_to: document.getElementById('vanto-assigned-to').value || null,
      tags: document.getElementById('vanto-tags').value.split(',').map(t => t.trim()).filter(Boolean),
      notes: document.getElementById('vanto-notes').value || null,
      whatsapp_id: lastDetectedPhone || null
    };

    log('Saving contact:', payload);

    showStatus('Saving...', 'loading');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'VANTO_SAVE_CONTACT',
        payload
      });

      if (response.success) {
        showStatus('Contact saved!', 'success');
      } else {
        showStatus('Error: ' + response.error, 'error');
      }
    } catch (error) {
      logError('Save contact error', error);
      showStatus('Error saving contact', 'error');
    }
  }

  async function saveGroup() {
    if (!session.token) {
      showStatus('Please log in first', 'error');
      return;
    }

    if (!currentGroupName) {
      showStatus('No group detected', 'error');
      return;
    }

    log('Saving group:', currentGroupName);
    showStatus('Saving group...', 'loading');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'VANTO_UPSERT_GROUP',
        groupName: currentGroupName
      });

      if (response.success) {
        showStatus('Group saved!', 'success');
      } else {
        showStatus('Error: ' + response.error, 'error');
      }
    } catch (error) {
      logError('Save group error', error);
      showStatus('Error saving group', 'error');
    }
  }

  // =====================================================
  // UI UPDATE FUNCTIONS
  // =====================================================
  function showStatus(message, type = 'info') {
    const statusEl = document.getElementById('vanto-status');
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.className = 'vanto-status ' + type;
      statusEl.style.display = 'block';

      if (type === 'success') {
        setTimeout(() => {
          statusEl.style.display = 'none';
        }, 3000);
      }
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
    const groupNameEl = document.getElementById('vanto-group-name');

    // Show auth banner if not logged in
    if (authBannerEl) {
      authBannerEl.style.display = session.token ? 'none' : 'block';
    }

    // Update display name
    if (displayNameEl) {
      displayNameEl.textContent = lastDetectedName || 'No chat selected';
    }

    // Update avatar
    if (avatarEl && lastDetectedName) {
      avatarEl.textContent = lastDetectedName.charAt(0).toUpperCase();
    }

    if (isGroupChat) {
      // Show group banner
      if (noChatEl) noChatEl.style.display = 'none';
      if (formBodyEl) formBodyEl.style.display = 'none';
      if (groupBannerEl) {
        groupBannerEl.style.display = 'block';
        if (groupNameEl) groupNameEl.textContent = currentGroupName || 'Group';
      }
      if (displayPhoneEl) displayPhoneEl.textContent = 'Group Chat';
    } else if (lastDetectedPhone || lastDetectedName) {
      // Show contact form
      if (noChatEl) noChatEl.style.display = 'none';
      if (groupBannerEl) groupBannerEl.style.display = 'none';
      if (formBodyEl) formBodyEl.style.display = 'block';

      // Update display phone
      if (displayPhoneEl) {
        displayPhoneEl.textContent = lastDetectedPhone || '';
      }

      // Pre-fill form
      const nameInput = document.getElementById('vanto-name');
      const phoneInput = document.getElementById('vanto-phone');
      if (nameInput && lastDetectedName && !nameInput.value) {
        nameInput.value = lastDetectedName;
      }
      if (phoneInput && lastDetectedPhone && !phoneInput.value) {
        phoneInput.value = lastDetectedPhone;
      }
    } else {
      // Show no chat message
      if (noChatEl) noChatEl.style.display = 'block';
      if (formBodyEl) formBodyEl.style.display = 'none';
      if (groupBannerEl) groupBannerEl.style.display = 'none';
      if (displayPhoneEl) displayPhoneEl.textContent = '';
    }
  }

  // =====================================================
  // TEAM MEMBERS
  // =====================================================
  async function loadTeamMembers() {
    if (!session.token) return;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'VANTO_LOAD_TEAM'
      });

      if (response.success && response.data) {
        teamMembers = response.data;
        const selectEl = document.getElementById('vanto-assigned-to');
        if (selectEl) {
          selectEl.innerHTML = '<option value="">Unassigned</option>';
          teamMembers.forEach(member => {
            const option = document.createElement('option');
            option.value = member.id;
            option.textContent = member.full_name || member.email;
            selectEl.appendChild(option);
          });
        }
        log('Loaded ' + teamMembers.length + ' team members');
      }
    } catch (error) {
      logError('Load team members error', error);
    }
  }

  // =====================================================
  // DETECTION FLOW
  // =====================================================
  function scheduleDetection() {
    if (detectionTimer) {
      clearTimeout(detectionTimer);
    }
    detectionTimer = setTimeout(runDetection, DETECTION_DEBOUNCE_MS);
  }

  function runDetection() {
    log('Running detection...');

    // Detect name
    const name = detectContactName();
    if (name !== lastDetectedName) {
      lastDetectedName = name;
      log('Name detected:', name);
    }

    // Check if group chat
    isGroupChat = detectGroupChat();

    if (isGroupChat) {
      currentGroupName = detectGroupName();
      lastDetectedPhone = null;
      log('Group chat:', currentGroupName);
    } else {
      // Detect phone
      const phone = detectPhoneNumber();
      if (phone !== lastDetectedPhone) {
        lastDetectedPhone = phone;
        log('Phone detected:', phone);
      }
      currentGroupName = null;
    }

    updateUI();
  }

  // =====================================================
  // WATCH CHANGES
  // =====================================================
  function watchChatChanges() {
    // Polling fallback
    setInterval(() => {
      scheduleDetection();
    }, POLLING_INTERVAL_MS);

    // MutationObserver for title changes
    const titleObserver = new MutationObserver(() => {
      scheduleDetection();
    });

    const titleEl = document.querySelector('title');
    if (titleEl) {
      titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }

    // MutationObserver for body changes
    const bodyObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.target.id === 'main' ||
            (mutation.target.closest && mutation.target.closest('#main'))) {
          scheduleDetection();
          break;
        }
      }
    });

    bodyObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-id']
    });

    log('Change watchers installed');
  }

  // =====================================================
  // AUTH CHECK
  // =====================================================
  async function checkAuthState() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'VANTO_GET_SESSION'
      });

      if (response && response.token) {
        session.token = response.token;
        session.email = response.email;
        log('Session restored for:', session.email);
        await loadTeamMembers();
      } else {
        log('No active session');
      }
    } catch (error) {
      logError('Auth check error', error);
    }

    updateUI();
  }

  // =====================================================
  // AUTO-POSTER EXECUTION ENGINE
  // =====================================================
  async function executeGroupPost(post) {
    executionId++;
    const eid = executionId;
    currentExecution = { id: eid, postId: post.id, startTime: Date.now() };

    log(`[EXEC ${eid}] Starting execution for post:`, post);

    const totalTimeout = setTimeout(() => {
      logStage('total', 'TIMEOUT', { elapsed: Date.now() - currentExecution.startTime });
      reportResult(post.id, false, 'Total execution timeout (90s)');
    }, TOTAL_EXECUTION_TIMEOUT);

    try {
      // Stage 1: Open Search
      logStage('open_search', 'START');
      const searchOpened = await openSearch();
      if (!searchOpened) {
        throw new Error('Failed to open search');
      }
      logStage('open_search', 'SUCCESS');

      // Stage 2: Search for Group
      logStage('search_group', 'START', { groupName: post.target_group_name });
      const groupFound = await searchForGroup(post.target_group_name);
      if (!groupFound) {
        throw new Error(`Group not found: ${post.target_group_name}`);
      }
      logStage('search_group', 'SUCCESS');

      // Stage 3: Select Group
      logStage('select_group', 'START');
      const groupSelected = await selectGroup(post.target_group_name);
      if (!groupSelected) {
        throw new Error('Failed to select group');
      }
      logStage('select_group', 'SUCCESS');

      // Stage 4: Wait for Chat to Open
      logStage('wait_chat_open', 'START');
      await waitForChatToOpen();
      logStage('wait_chat_open', 'SUCCESS');

      // Stage 5: Find Input
      logStage('find_input', 'START');
      const inputEl = await findMessageInput();
      if (!inputEl) {
        throw new Error('Message input not found');
      }
      logStage('find_input', 'SUCCESS');

      // Stage 6: Inject Message
      logStage('inject_message', 'START');
      const messageInjected = await injectMessage(inputEl, post.message_content);
      if (!messageInjected) {
        throw new Error('Failed to inject message');
      }
      logStage('inject_message', 'SUCCESS');

      // Stage 7: Find Send Button
      logStage('find_send_button', 'START');
      const sendBtn = await findSendButton();
      if (!sendBtn) {
        throw new Error('Send button not found');
      }
      logStage('find_send_button', 'SUCCESS');

      // Stage 8: Click Send
      logStage('click_send', 'START');
      const sent = await clickSendButton(sendBtn);
      if (!sent) {
        throw new Error('Failed to click send button');
      }
      logStage('click_send', 'SUCCESS');

      // Stage 9: Confirm Sent
      logStage('confirm_sent', 'START');
      await confirmMessageSent();
      logStage('confirm_sent', 'SUCCESS');

      clearTimeout(totalTimeout);
      log(`[EXEC ${eid}] COMPLETED SUCCESSFULLY`, { elapsed: Date.now() - currentExecution.startTime });
      reportResult(post.id, true);
      currentExecution = null;

    } catch (error) {
      clearTimeout(totalTimeout);
      logError(`[EXEC ${eid}] FAILED at stage`, error);
      reportResult(post.id, false, error.message);
      currentExecution = null;
    }
  }

  // =====================================================
  // STAGE IMPLEMENTATIONS
  // =====================================================
  async function openSearch() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logError('open_search timeout');
        resolve(false);
      }, STAGE_TIMEOUTS.open_search);

      (async () => {
        // Try to find search input
        let searchInput = findElement(SELECTORS.searchInput, 'search input');

        if (!searchInput) {
          // Try to click search icon first
          const searchIcon = findElement(SELECTORS.searchIcon, 'search icon');
          if (searchIcon) {
            searchIcon.click();
            await sleep(500);
            searchInput = findElement(SELECTORS.searchInput, 'search input');
          }
        }

        clearTimeout(timeout);
        resolve(!!searchInput);
      })();
    });
  }

  async function searchForGroup(groupName) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logError('search_group timeout');
        resolve(false);
      }, STAGE_TIMEOUTS.search_group);

      (async () => {
        const searchInput = findElement(SELECTORS.searchInput, 'search input');
        if (!searchInput) {
          clearTimeout(timeout);
          resolve(false);
          return;
        }

        // Clear existing content
        searchInput.focus();
        searchInput.textContent = '';

        // Inject group name
        document.execCommand('insertText', false, groupName);

        // Wait for results
        await sleep(1500);

        clearTimeout(timeout);
        resolve(true);
      })();
    });
  }

  async function selectGroup(groupName) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logError('select_group timeout');
        resolve(false);
      }, STAGE_TIMEOUTS.select_group);

      (async () => {
        // Find chat list items
        const chatItems = document.querySelectorAll(SELECTORS.chatListItems);
        log(`Found ${chatItems.length} chat items`);

        let foundItem = null;

        // Try exact match first
        for (const item of chatItems) {
          const titleEl = item.querySelector('[title]');
          if (titleEl && titleEl.getAttribute('title') === groupName) {
            foundItem = item;
            log('Found exact match for group');
            break;
          }
        }

        // Try partial match
        if (!foundItem) {
          for (const item of chatItems) {
            const titleEl = item.querySelector('[title]');
            const title = titleEl?.getAttribute('title') || titleEl?.textContent || '';
            if (title.includes(groupName) || groupName.includes(title)) {
              foundItem = item;
              log('Found partial match for group:', title);
              break;
            }
          }
        }

        // Just click first result
        if (!foundItem && chatItems.length > 0) {
          foundItem = chatItems[0];
          log('Using first available chat item');
        }

        if (foundItem) {
          foundItem.click();
          await sleep(500);
        }

        clearTimeout(timeout);
        resolve(!!foundItem);
      })();
    });
  }

  async function waitForChatToOpen() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logError('wait_chat_open timeout');
        resolve(false);
      }, STAGE_TIMEOUTS.wait_chat_open);

      (async () => {
        // Wait for main chat area to be ready
        const startTime = Date.now();

        while (Date.now() - startTime < STAGE_TIMEOUTS.wait_chat_open) {
          const mainEl = document.querySelector('#main');
          const headerEl = mainEl?.querySelector('header');

          if (headerEl && mainEl) {
            clearTimeout(timeout);
            resolve(true);
            return;
          }

          await sleep(500);
        }

        clearTimeout(timeout);
        resolve(false);
      })();
    });
  }

  async function findMessageInput() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logError('find_input timeout');
        resolve(null);
      }, STAGE_TIMEOUTS.find_input);

      (async () => {
        const input = await waitForElement(SELECTORS.messageInput, STAGE_TIMEOUTS.find_input, 'message input');
        clearTimeout(timeout);
        resolve(input);
      })().catch(() => {
        clearTimeout(timeout);
        resolve(null);
      });
    });
  }

  async function injectMessage(inputEl, message) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logError('inject_message timeout');
        resolve(false);
      }, STAGE_TIMEOUTS.inject_message);

      (async () => {
        inputEl.focus();

        // Clear existing content
        inputEl.textContent = '';

        // Inject message
        document.execCommand('insertText', false, message);

        // Dispatch input event
        const inputEvent = new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: message
        });
        inputEl.dispatchEvent(inputEvent);

        await sleep(500);

        clearTimeout(timeout);
        resolve(true);
      })();
    });
  }

  async function findSendButton() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logError('find_send_button timeout');
        resolve(null);
      }, STAGE_TIMEOUTS.find_send_button);

      (async () => {
        // Wait a bit for send button to appear
        await sleep(300);

        const sendBtn = await waitForElement(SELECTORS.sendButton, STAGE_TIMEOUTS.find_send_button, 'send button');
        clearTimeout(timeout);
        resolve(sendBtn);
      })().catch(() => {
        clearTimeout(timeout);
        resolve(null);
      });
    });
  }

  async function clickSendButton(sendBtn) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logError('click_send timeout');
        resolve(false);
      }, STAGE_TIMEOUTS.click_send);

      (async () => {
        sendBtn.click();
        await sleep(500);

        clearTimeout(timeout);
        resolve(true);
      })();
    });
  }

  async function confirmMessageSent() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        logError('confirm_sent timeout');
        resolve(false);
      }, STAGE_TIMEOUTS.confirm_sent);

      (async () => {
        // Wait for message to appear in chat
        await sleep(1000);

        // Check if input is now empty (message sent)
        const inputEl = findElement(SELECTORS.messageInput, 'message input');
        if (inputEl && inputEl.textContent.trim() === '') {
          log('Message sent confirmed - input is empty');
        }

        clearTimeout(timeout);
        resolve(true);
      })();
    });
  }

  // =====================================================
  // HELPER FUNCTIONS
  // =====================================================
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function reportResult(postId, success, error = null) {
    try {
      await chrome.runtime.sendMessage({
        type: 'VANTO_POST_RESULT',
        postId,
        success,
        error
      });
    } catch (e) {
      logError('Failed to report result', e);
    }
  }

  // =====================================================
  // MESSAGE LISTENER
  // =====================================================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    log('Received message:', message.type);

    switch (message.type) {
      case 'VANTO_SESSION_UPDATE':
        session.token = message.token;
        session.email = message.email;
        loadTeamMembers();
        updateUI();
        sendResponse({ success: true });
        break;

      case 'VANTO_TOKEN_CLEARED':
        session = { token: null, email: null };
        updateUI();
        sendResponse({ success: true });
        break;

      case 'VANTO_PING':
        log('Received heartbeat ping');
        sendResponse({ success: true, pong: true });
        break;

      case 'VANTO_EXECUTE_GROUP_POST':
        if (message.post) {
          executeGroupPost(message.post);
          sendResponse({ success: true, started: true });
        } else {
          sendResponse({ success: false, error: 'No post data' });
        }
        break;

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }

    return true;
  });

  // =====================================================
  // INITIALIZATION
  // =====================================================
  async function init() {
    log('Content script v' + VERSION + ' initializing...');

    // Wait for WhatsApp to load
    let attempts = 0;
    const maxAttempts = 60;

    while (attempts < maxAttempts) {
      const appEl = document.querySelector('#app');
      if (appEl && document.readyState === 'complete') {
        break;
      }
      await sleep(500);
      attempts++;
    }

    if (attempts >= maxAttempts) {
      logError('WhatsApp did not load within timeout');
      return;
    }

    log('WhatsApp loaded, creating sidebar...');

    createSidebar();
    createToggleButton();
    await checkAuthState();
    watchChatChanges();
    runDetection();

    log('Content script initialized');
  }

  // Start initialization
  init();

})();
