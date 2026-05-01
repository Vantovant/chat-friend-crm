// Vanto CRM Chrome Extension - Content Script v6.2.5
// LOVABLE EDITION - Uses chat.onlinecourseformlm.com
// v6.2.5: Fixed select_group stage - relaxed text matching for pipe symbols, better search result selectors

(function() {
  'use strict';

  // =====================================================
  // CONFIGURATION - LOVABLE EDITION
  // =====================================================
  const VERSION = '6.2.5 (Lovable)';
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

  // Maximum allowed characters for group/contact names (PostgreSQL B-tree index limit)
  const MAX_NAME_LENGTH = 255;

  // =====================================================
  // LOGGING UTILITY
  // =====================================================
  let executionId = 0;

  function log(message, data = null) {
    const timestamp = new Date().toISOString();
    const prefix = `[VANTO CS v${VERSION} ${timestamp}]`;
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
    const prefix = `[VANTO CS ERROR ${timestamp}]`;
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

    // Chat list items (general sidebar)
    chatListItems: '#pane-side [role="listitem"]',
    
    // Search results container and items (for select_group stage)
    searchResultsContainer: [
      'div[aria-label="Search results"]',
      'div[data-testid="search-results"]',
      '#pane-side div[role="listbox"]',
      '#search-results'
    ],
    searchResultItems: [
      'div[aria-label="Search results"] [role="listitem"]',
      'div[aria-label="Search results"] > div > div',
      '#pane-side [role="listbox"] [role="listitem"]',
      'div[aria-label*="result"] [role="listitem"]'
    ],
    // Chat title within search results
    chatTitleSpan: [
      'div[data-testid="cell-frame-title"] span[title]',
      'span[dir="auto"][title]',
      'span[title]',
      '[data-testid="cell-frame-title"]'
    ],
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
  // TEXT NORMALIZATION & SANITIZATION
  // =====================================================
  /**
   * Normalizes text for comparison by removing special characters,
   * zero-width chars, and collapsing multiple spaces.
   * This helps match group names like "APLGO | Health and Biz" against
   * DOM text that might render differently.
   * 
   * @param {string} text - The text to normalize
   * @returns {string} - Normalized text for comparison
   */
  function normalizeText(text) {
    if (!text) return '';
    return text
      // Remove zero-width characters
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      // Replace multiple spaces/tabs with single space
      .replace(/\s+/g, ' ')
      // Remove common decorative separators (pipe, dash) with spaces around them
      .replace(/\s*\|\s*/g, ' ')
      .replace(/\s*-\s*/g, ' ')
      // Remove parentheses and brackets content (emoji indicators etc)
      .replace(/[\[\](){}]/g, '')
      // Final trim and lowercase
      .trim()
      .toLowerCase();
  }

  /**
   * Checks if normalized target text matches normalized DOM text.
   * Uses both exact match and word-based partial matching.
   * 
   * @param {string} targetName - The group name we're looking for
   * @param {string} domText - The text from DOM element
   * @returns {object} - { exact: boolean, partial: boolean, score: number }
   */
  function matchGroupNames(targetName, domText) {
    const normalizedTarget = normalizeText(targetName);
    const normalizedDom = normalizeText(domText);
    
    // Exact match after normalization
    const exact = normalizedTarget === normalizedDom;
    
    // Partial match - one contains the other
    const partial = normalizedTarget.includes(normalizedDom) || normalizedDom.includes(normalizedTarget);
    
    // Word-based matching - count how many significant words match
    const targetWords = normalizedTarget.split(/\s+/).filter(w => w.length > 1);
    const domWords = normalizedDom.split(/\s+/).filter(w => w.length > 1);
    const matchingWords = targetWords.filter(w => domWords.includes(w)).length;
    const score = targetWords.length > 0 ? matchingWords / targetWords.length : 0;
    
    return { exact, partial, score };
  }

  /**
   * Sanitizes extracted text to prevent database index overflow.
   * PostgreSQL B-tree index has a max size of ~2704 bytes.
   * We limit to 255 chars to stay well under the limit.
   * 
   * @param {string} text - The raw extracted text
   * @param {string} context - Context for logging (e.g., 'group name', 'contact name')
   * @returns {string|null} - Sanitized text or null if invalid
   */
  function sanitizeExtractedText(text, context = 'text') {
    if (!text) return null;
    
    const trimmed = text.trim();
    
    // Check for excessive length - indicates DOM selector grabbed junk
    if (trimmed.length > MAX_NAME_LENGTH) {
      logError(`${context} extraction grabbed too much text (${trimmed.length} chars). First 100 chars:`, trimmed.substring(0, 100));
      console.error(`%c[VANTO CS ERROR] ${context} extraction grabbed too much text (${trimmed.length} chars). DOM selector may need updating.`, 'background: #ff6b6b; color: #fff; padding: 4px 8px;');
      return null;
    }
    
    // Check for suspicious patterns that indicate junk data
    // Multiple newlines or excessive whitespace often indicates innerText of large containers
    const newlineCount = (trimmed.match(/\n/g) || []).length;
    if (newlineCount > 3) {
      logError(`${context} contains ${newlineCount} newlines - likely grabbed container innerText. Aborting.`);
      return null;
    }
    
    // Final safe trim
    return trimmed.substring(0, MAX_NAME_LENGTH).trim();
  }

  // =====================================================
  // DETECTION FUNCTIONS
  // =====================================================
  function detectContactName() {
    for (const selector of SELECTORS.contactName) {
      try {
        const el = document.querySelector(selector);
        if (!el) continue;
        
        // PRIORITY 1: Use 'title' attribute (most reliable, always short)
        // WhatsApp uses title attributes for display names which are clean and concise
        const titleAttr = el.getAttribute ? el.getAttribute('title') : null;
        if (titleAttr && titleAttr.trim()) {
          const sanitized = sanitizeExtractedText(titleAttr, 'Contact name (title attr)');
          if (sanitized) {
            log('Contact name from title attribute:', sanitized);
            return sanitized;
          }
        }
        
        // PRIORITY 2: Fall back to textContent (can be risky)
        // Only use if element has direct text (not nested children with lots of text)
        if (el.textContent && el.textContent.trim()) {
          // Check if this element has direct text content (not inherited from children)
          const directText = Array.from(el.childNodes)
            .filter(node => node.nodeType === Node.TEXT_NODE)
            .map(node => node.textContent)
            .join('')
            .trim();
          
          // Prefer direct text over full textContent
          const textToUse = directText || el.textContent;
          const sanitized = sanitizeExtractedText(textToUse, 'Contact name (textContent)');
          if (sanitized) {
            log('Contact name from textContent:', sanitized);
            return sanitized;
          }
        }
      } catch (e) {
        // Continue to next selector
        logError('Error in detectContactName selector:', e);
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
    // Get group name from contact name detection with additional validation
    const rawName = detectContactName();
    
    if (!rawName) {
      log('No group name detected');
      return null;
    }
    
    // Additional validation for group names
    // Group names should not contain certain patterns that indicate DOM junk
    const suspiciousPatterns = [
      /click to view/,           // UI helper text
      /search\s*contacts/i,      // Search placeholder text
      /type a message/i,         // Input placeholder
      /\d+\s*participants/i,     // Participant count (not the name)
    ];
    
    for (const pattern of suspiciousPatterns) {
      if (pattern.test(rawName)) {
        logError('Group name matched suspicious pattern, rejecting:', rawName.substring(0, 50));
        return null;
      }
    }
    
    log('Group name validated:', rawName);
    return rawName;
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
        <p><strong>Extension not logged in</strong></p>
        <p style="font-size: 12px; margin: 6px 0; opacity: 0.9;">Logging into the web dashboard is separate from the extension. Click the Vanto extension icon in your Chrome toolbar (top-right) and sign in with the same email & password.</p>
        <a href="${DASHBOARD_URL}" target="_blank" style="font-size: 12px;">Forgot password? Open Dashboard →</a>
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
      showStatus('Click the Vanto extension icon (top-right) and log in first', 'error');
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

    // Final sanitization before sending to background script
    const safeGroupName = sanitizeExtractedText(currentGroupName, 'Group name (save)');
    if (!safeGroupName) {
      showStatus('Invalid group name (too long or corrupted)', 'error');
      logError('Group name failed final sanitization before save');
      return;
    }

    log('Saving group:', safeGroupName, `(${safeGroupName.length} chars)`);
    showStatus('Saving group...', 'loading');

    try {
      // Extract group JID from DOM if available (more stable than name)
      const mainEl = document.querySelector('#main');
      let groupJid = null;
      if (mainEl) {
        const dataId = mainEl.getAttribute('data-id');
        if (dataId && dataId.includes('@g.us')) {
          groupJid = dataId;
          log('Group JID extracted:', groupJid);
        }
      }

      const response = await chrome.runtime.sendMessage({
        type: 'VANTO_UPSERT_GROUP',
        groupName: safeGroupName,
        groupJid: groupJid
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

    let executionResult = { success: false, error: null };

    const totalTimeout = setTimeout(() => {
      logStage('total', 'TIMEOUT', { elapsed: Date.now() - currentExecution.startTime });
      executionResult = { success: false, error: 'Total execution timeout (90s)' };
      currentExecution = null;
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
      executionResult = { success: true, error: null };
      currentExecution = null;

    } catch (error) {
      clearTimeout(totalTimeout);
      logError(`[EXEC ${eid}] FAILED at stage`, error);
      executionResult = { success: false, error: error.message };
      currentExecution = null;
    }

    return executionResult;
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
        logError('select_group timeout - no clickable search result found');
        resolve(false);
      }, STAGE_TIMEOUTS.select_group);

      (async () => {
        log(`select_group: Looking for "${groupName}"`);
        
        // Wait a moment for search results to render
        await sleep(500);
        
        // STEP 1: Try to find search results using multiple selector strategies
        let resultItems = [];
        
        // Try search result-specific selectors first
        for (const selector of SELECTORS.searchResultItems) {
          try {
            const items = document.querySelectorAll(selector);
            if (items.length > 0) {
              log(`select_group: Found ${items.length} results with selector: ${selector}`);
              resultItems = Array.from(items);
              break;
            }
          } catch (e) {
            logError(`Invalid selector: ${selector}`, e);
          }
        }
        
        // Fallback to general chat list items
        if (resultItems.length === 0) {
          const generalItems = document.querySelectorAll(SELECTORS.chatListItems);
          if (generalItems.length > 0) {
            log(`select_group: Falling back to ${generalItems.length} general chat items`);
            resultItems = Array.from(generalItems);
          }
        }
        
        log(`select_group: Total ${resultItems.length} items to search`);
        
        if (resultItems.length === 0) {
          clearTimeout(timeout);
          logError('select_group: No search results found at all');
          resolve(false);
          return;
        }
        
        // STEP 2: Try to find best match
        let bestMatch = null;
        let bestScore = 0;
        let exactMatch = null;
        
        for (const item of resultItems) {
          // Try multiple ways to get the title/name from the item
          let title = '';
          
          // Method 1: title attribute on the item itself
          title = item.getAttribute('title') || '';
          
          // Method 2: Look for title span inside
          if (!title) {
            for (const titleSelector of SELECTORS.chatTitleSpan) {
              const titleEl = item.querySelector(titleSelector);
              if (titleEl) {
                title = titleEl.getAttribute('title') || titleEl.textContent || '';
                if (title) break;
              }
            }
          }
          
          // Method 3: Any element with title attribute inside
          if (!title) {
            const titleEl = item.querySelector('[title]');
            if (titleEl) {
              title = titleEl.getAttribute('title') || '';
            }
          }
          
          // Method 4: textContent fallback (be careful with this)
          if (!title) {
            const textContent = item.textContent || '';
            // Only use if it's reasonably short (likely a name, not full message preview)
            const firstLine = textContent.split('\n')[0];
            if (firstLine && firstLine.length < 100) {
              title = firstLine.trim();
            }
          }
          
          if (!title) continue;
          
          // STEP 2A: Check for exact match (after normalization)
          const match = matchGroupNames(groupName, title);
          
          if (match.exact) {
            exactMatch = item;
            log(`select_group: EXACT match found: "${title}"`);
            break;
          }
          
          // STEP 2B: Track best partial match
          if (match.score > bestScore) {
            bestScore = match.score;
            bestMatch = item;
            log(`select_group: Partial match candidate: "${title}" (score: ${match.score.toFixed(2)})`);
          }
        }
        
        // STEP 3: Click the match
        let foundItem = exactMatch || bestMatch;
        
        // STEP 3C: First result fallback (after 3 seconds of searching)
        // If we haven't found a good match after searching, use the first result
        // This is safe because Stage 2 (search_group) already filtered the list
        if (!foundItem && resultItems.length > 0) {
          // Check if the first item is a reasonable candidate
          const firstItem = resultItems[0];
          const firstItemClickable = firstItem && (
            firstItem.getAttribute('role') === 'listitem' ||
            firstItem.querySelector('[role="listitem"]') ||
            firstItem.hasAttribute('data-id') ||
            firstItem.querySelector('[data-id]')
          );
          
          if (firstItemClickable) {
            foundItem = firstItem;
            log('select_group: Using first result fallback (search already filtered list)');
          }
        }
        
        if (foundItem) {
          // Try to find the actual clickable element
          let clickTarget = foundItem;
          
          // Some WhatsApp versions require clicking a specific child
          const clickableChild = foundItem.querySelector('[role="button"]') || 
                                 foundItem.querySelector('[data-testid="cell-frame-container"]');
          if (clickableChild) {
            clickTarget = clickableChild;
          }
          
          log(`select_group: Clicking on result`);
          clickTarget.click();
          await sleep(500);
          
          clearTimeout(timeout);
          resolve(true);
        } else {
          logError('select_group: No suitable match found in search results');
          clearTimeout(timeout);
          resolve(false);
        }
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

    // Handle async operations properly
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
          updateUI();
          sendResponse({ success: true });
          break;

        case 'VANTO_PING':
          log('Received heartbeat ping');
          sendResponse({ success: true, pong: true, initialized: isInitialized });
          break;

        case 'VANTO_INIT':
          log('Received manual init request');
          const initResult = await init();
          sendResponse({ success: initResult, initialized: isInitialized });
          break;

        case 'VANTO_EXECUTE_GROUP_POST':
          if (message.post) {
            log('Starting group post execution, will wait for completion...');
            try {
              const result = await executeGroupPost(message.post);
              log('Execution completed, sending result:', result);
              sendResponse(result);
            } catch (error) {
              logError('Execution error:', error);
              sendResponse({ success: false, error: error.message });
            }
          } else {
            sendResponse({ success: false, error: 'No post data' });
          }
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    })();

    // Return true to indicate async response
    return true;
  });

  // =====================================================
  // INITIALIZATION
  // =====================================================
  let isInitialized = false;

  async function init() {
    // Prevent double initialization
    if (isInitialized) {
      log('Already initialized, skipping');
      return true;
    }

    log('Content script v' + VERSION + ' initializing...');
    console.log('%c[VANTO CRM] Content script v' + VERSION + ' starting...', 'background: #00d4aa; color: #000; padding: 4px 8px; font-weight: bold;');

    // Wait for WhatsApp to load - check for main elements
    let attempts = 0;
    const maxAttempts = 30; // 15 seconds max

    while (attempts < maxAttempts) {
      const appEl = document.querySelector('#app');
      const paneSide = document.querySelector('#pane-side');
      
      // WhatsApp is ready when we have #app AND either document is complete OR we can see the chat list
      if (appEl && (document.readyState === 'complete' || paneSide)) {
        log('WhatsApp DOM detected, readyState:', document.readyState);
        break;
      }
      
      log('Waiting for WhatsApp... attempt', attempts + 1, 'readyState:', document.readyState);
      await sleep(500);
      attempts++;
    }

    if (attempts >= maxAttempts) {
      logError('WhatsApp did not load within timeout');
      console.log('%c[VANTO CRM] WhatsApp load timeout - will try anyway', 'background: #ff6b6b; color: #fff; padding: 4px 8px;');
      // Don't return - try to create sidebar anyway
    }

    try {
      log('Creating sidebar and toggle button...');
      createSidebar();
      createToggleButton();
      
      // Verify elements were created
      const sidebarEl = document.getElementById('vanto-crm-sidebar');
      const toggleEl = document.getElementById('vanto-crm-toggle');
      
      if (!sidebarEl || !toggleEl) {
        logError('Failed to create UI elements');
        return false;
      }
      
      console.log('%c[VANTO CRM] Sidebar and toggle button created!', 'background: #00d4aa; color: #000; padding: 4px 8px; font-weight: bold;');
      
      isInitialized = true;
      
      await checkAuthState();
      watchChatChanges();
      runDetection();

      log('Content script initialized successfully');
      return true;
    } catch (error) {
      logError('Initialization error', error);
      return false;
    }
  }

  // Start initialization when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(init, 100);
    });
  } else {
    // DOM already loaded, wait a bit for WhatsApp to render
    setTimeout(init, 500);
  }

})();
