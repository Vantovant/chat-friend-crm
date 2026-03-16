// Vanto CRM Chrome Extension - Background Service Worker v6.2.6
// LOVABLE EDITION - Uses chat.onlinecourseformlm.com
// v6.2.6: Fixed content script injection for discarded/loading tabs with retry logic
// v6.2.3: Fixed RLS policy violation in handleUpsertGroup - now includes user_id from JWT token
// v6.2.1: Improved content script initialization with proactive tab injection
// v6.2: Added programmatic content script injection fallback
// v6.1: Fixed failure_reason column, added retry logic, content script ping check

// =====================================================
// CONFIGURATION - UPDATE ANON KEY BELOW
// =====================================================
const SUPABASE_URL = 'https://nqyyvqcmcyggvlcswkio.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xeXl2cWNtY3lnZ3ZsY3N3a2lvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1NDYxMjYsImV4cCI6MjA4NzEyMjEyNn0.oK04GkXogHo9pohYd4A7XAV0-Q-qSu-uUiGWaj4ClM8';
const EXECUTION_TIMEOUT = 90000; // 90 seconds (increased from 45s)
const DASHBOARD_URL = 'https://chat.onlinecourseformlm.com';

// =====================================================
// LOGGING UTILITY
// =====================================================
function log(message, data = null) {
  const timestamp = new Date().toISOString();
  const prefix = `[VANTO BG (Lovable) ${timestamp}]`;
  if (data) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
}

function logError(message, error = null) {
  const timestamp = new Date().toISOString();
  const prefix = `[VANTO BG ERROR (Lovable) ${timestamp}]`;
  if (error) {
    console.error(prefix, message, error);
  } else {
    console.error(prefix, message);
  }
}

// =====================================================
// SESSION MANAGEMENT
// =====================================================
const SESSION_KEYS = {
  token: 'vanto_token',
  email: 'vanto_email',
  refresh: 'vanto_refresh',
  expiresAt: 'vanto_expires_at'
};

async function getSession() {
  return new Promise((resolve) => {
    chrome.storage.local.get(Object.values(SESSION_KEYS), (result) => {
      resolve({
        token: result[SESSION_KEYS.token] || null,
        email: result[SESSION_KEYS.email] || null,
        refresh: result[SESSION_KEYS.refresh] || null,
        expiresAt: result[SESSION_KEYS.expiresAt] || null
      });
    });
  });
}

async function saveSession(data) {
  return new Promise((resolve) => {
    chrome.storage.local.set({
      [SESSION_KEYS.token]: data.access_token,
      [SESSION_KEYS.email]: data.user?.email,
      [SESSION_KEYS.refresh]: data.refresh_token,
      [SESSION_KEYS.expiresAt]: Date.now() + (data.expires_in * 1000)
    }, resolve);
  });
}

async function clearSession() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(Object.values(SESSION_KEYS), resolve);
  });
}

// =====================================================
// TOKEN REFRESH
// =====================================================
async function refreshTokenIfNeeded() {
  const session = await getSession();

  if (!session.token || !session.refresh) {
    log('No session to refresh');
    return null;
  }

  // Check if token expires in less than 5 minutes
  const bufferMs = 5 * 60 * 1000;
  if (session.expiresAt && session.expiresAt > Date.now() + bufferMs) {
    log('Token still valid');
    return session.token;
  }

  log('Refreshing token...');
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ refresh_token: session.refresh })
    });

    if (!response.ok) {
      logError('Token refresh failed');
      await clearSession();
      notifyTabsOfLogout();
      return null;
    }

    const data = await response.json();
    await saveSession(data);
    log('Token refreshed successfully');
    return data.access_token;
  } catch (error) {
    logError('Token refresh error', error);
    await clearSession();
    notifyTabsOfLogout();
    return null;
  }
}

// =====================================================
// TAB NOTIFICATION
// =====================================================
async function notifyTabsOfLogout() {
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'VANTO_TOKEN_CLEARED' });
    } catch (e) {
      // Tab might not have content script loaded
    }
  }
}

// =====================================================
// AUTH HANDLERS
// =====================================================
async function handleLogin(email, password) {
  log('Login attempt for:', email);
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (!response.ok) {
      logError('Login failed', data);
      return { success: false, error: data.error_description || data.error || 'Login failed' };
    }

    await saveSession(data);
    log('Login successful for:', email);

    // Notify WhatsApp tabs
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: 'VANTO_SESSION_UPDATE',
          token: data.access_token,
          email: data.user?.email
        });
      } catch (e) {
        // Tab might not have content script loaded
      }
    }

    return { success: true, email: data.user?.email };
  } catch (error) {
    logError('Login error', error);
    return { success: false, error: error.message };
  }
}

async function handleLogout() {
  log('Logout');
  await clearSession();
  await notifyTabsOfLogout();
  return { success: true };
}

async function handleResetPassword(email) {
  log('Password reset requested for:', email);
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ email })
    });

    if (!response.ok) {
      const data = await response.json();
      logError('Password reset failed', data);
      return { success: false, error: data.error_description || 'Reset failed' };
    }

    return { success: true };
  } catch (error) {
    logError('Password reset error', error);
    return { success: false, error: error.message };
  }
}

// =====================================================
// CONTACT CRUD
// =====================================================
async function handleSaveContact(payload, token) {
  log('Saving contact:', payload.name);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert-whatsapp-contact`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.text();
      logError('Save contact failed', error);
      return { success: false, error };
    }

    const data = await response.json();
    log('Contact saved successfully');
    return { success: true, data };
  } catch (error) {
    logError('Save contact error', error);
    return { success: false, error: error.message };
  }
}

async function handleLoadContact(phone, token) {
  log('Loading contact:', phone);
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/contacts?or=(phone_normalized.eq.${phone},whatsapp_id.eq.${phone})&select=*`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': SUPABASE_ANON_KEY
        }
      }
    );

    if (!response.ok) {
      const error = await response.text();
      logError('Load contact failed', error);
      return { success: false, error };
    }

    const data = await response.json();
    return { success: true, data: data[0] || null };
  } catch (error) {
    logError('Load contact error', error);
    return { success: false, error: error.message };
  }
}

async function handleLoadTeamMembers(token) {
  log('Loading team members');
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?select=id,full_name,email&order=full_name`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': SUPABASE_ANON_KEY
        }
      }
    );

    if (!response.ok) {
      const error = await response.text();
      logError('Load team failed', error);
      return { success: false, error };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    logError('Load team error', error);
    return { success: false, error: error.message };
  }
}

// =====================================================
// JWT HELPER - Extract user ID from token
// =====================================================
function getUserIdFromToken(token) {
  try {
    // JWT tokens have 3 parts: header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) {
      logError('Invalid JWT token format');
      return null;
    }
    // Decode the payload (middle part)
    const payload = JSON.parse(atob(parts[1]));
    // The user ID is in the 'sub' claim
    return payload.sub || null;
  } catch (error) {
    logError('Failed to decode JWT token', error);
    return null;
  }
}

// =====================================================
// GROUP UPSERT
// =====================================================
async function handleUpsertGroup(groupName, token, groupJid = null) {
  log('Upserting group:', groupName, 'with JID:', groupJid);
  
  // Validate token exists
  if (!token) {
    logError('Upsert group failed: No authentication token provided');
    return { success: false, error: '[auth_missing] No authentication token. Please log in again.' };
  }
  
  // Extract user ID from JWT token
  const userId = getUserIdFromToken(token);
  if (!userId) {
    logError('Upsert group failed: Could not extract user ID from token');
    return { success: false, error: '[auth_invalid] Invalid session. Please log in again.' };
  }
  
  log('Extracted user ID from token:', userId);
  
  try {
    // Build payload with user_id to satisfy RLS policy: auth.uid() = user_id
    const payload = {
      group_name: groupName,
      user_id: userId
    };
    
    // Include group_jid if provided (for stable WhatsApp group identifier)
    if (groupJid) {
      payload.group_jid = groupJid;
    }
    
    log('Sending group upsert payload:', payload);
    
    const response = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_groups?on_conflict=user_id,group_name`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY,
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMsg = errorText;
      
      // Parse structured error for better user feedback
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.code === '42501') {
          errorMsg = `[rls_violation] Row-level security policy violation. Ensure you are logged in.`;
        }
      } catch (e) {
        // Keep original error text
      }
      
      logError('Upsert group failed:', errorText);
      return { success: false, error: errorMsg };
    }

    log('Group upserted successfully for user:', userId);
    return { success: true };
  } catch (error) {
    logError('Upsert group error:', error);
    return { success: false, error: `[network_error] ${error.message}` };
  }
}

// =====================================================
// CONTENT SCRIPT INJECTION HELPER
// =====================================================

/**
 * Waits for a tab to finish loading.
 * @param {number} tabId - The tab ID to wait for
 * @param {number} timeoutMs - Maximum time to wait (default 5000ms)
 * @returns {Promise<boolean>} - True if tab loaded, false if timeout
 */
async function waitForTabToLoad(tabId, timeoutMs = 5000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') {
        log('Tab is now complete:', tabId);
        return true;
      }
      log('Tab still loading, waiting...', { tabId, status: tab.status });
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (e) {
      logError('Error checking tab status:', e);
      return false;
    }
  }
  
  logError('Timeout waiting for tab to load:', tabId);
  return false;
}

/**
 * Wakes up a discarded (sleeping) tab by making it active.
 * @param {number} tabId - The tab ID to wake up
 * @returns {Promise<boolean>} - True if successfully woken up
 */
async function wakeUpDiscardedTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    
    if (tab.discarded) {
      log('Tab is discarded (sleeping), waking it up:', tabId);
      
      // Make the tab active to force Chrome to reload it
      await chrome.tabs.update(tabId, { active: true });
      
      // Wait for the tab to load
      const loaded = await waitForTabToLoad(tabId, 10000);
      if (!loaded) {
        logError('Failed to wake up discarded tab');
        return false;
      }
      
      log('Discarded tab successfully woken up:', tabId);
      return true;
    }
    
    // Tab is not discarded
    return true;
  } catch (e) {
    logError('Error waking up tab:', e);
    return false;
  }
}

/**
 * Attempts to inject content script with retry logic.
 * @param {number} tabId - The tab ID to inject into
 * @param {number} maxRetries - Maximum injection attempts (default 2)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function injectContentScriptWithRetry(tabId, maxRetries = 2) {
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    log(`Injection attempt ${attempt}/${maxRetries} for tab:`, tabId);
    
    try {
      // First inject CSS
      try {
        await chrome.scripting.insertCSS({
          target: { tabId: tabId },
          files: ['sidebar.css']
        });
        log('CSS injected');
      } catch (cssError) {
        log('CSS injection skipped (may already exist):', cssError.message);
      }

      // Then inject JS
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });
      log('Content script injected programmatically');

      // Wait for initialization
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify injection worked - try to init if needed
      try {
        const verifyResponse = await chrome.tabs.sendMessage(tabId, { type: 'VANTO_INIT' });
        if (verifyResponse && verifyResponse.initialized) {
          log('Content script initialized successfully');
          return { success: true };
        }
      } catch (e) {
        log('Init message failed, trying ping...');
      }

      // Final ping check
      const pingResponse = await chrome.tabs.sendMessage(tabId, { type: 'VANTO_PING' });
      if (pingResponse && pingResponse.pong) {
        log('Content script responding to ping');
        return { success: true };
      }
      
      lastError = 'Content script injected but not responding';
    } catch (injectError) {
      lastError = injectError.message;
      logError(`Injection attempt ${attempt} failed:`, injectError);
      
      // Check for specific error types
      if (injectError.message.includes('Cannot access contents of url')) {
        // Tab might be sleeping or on a restricted page
        logError('Cannot access tab contents - tab may be sleeping or restricted');
        
        if (attempt < maxRetries) {
          log('Waiting 1 second before retry...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } else if (injectError.message.includes('The tab was closed')) {
        return { success: false, error: '[tab_closed] WhatsApp tab was closed during injection.' };
      }
    }
  }
  
  return { success: false, error: `[injection_failed] ${lastError}` };
}

/**
 * Ensures the content script is injected and ready on the WhatsApp tab.
 * Handles loading tabs, discarded tabs, and injection failures.
 * 
 * @param {number} tabId - The tab ID to check
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function ensureContentScriptInjected(tabId) {
  log('Ensuring content script is injected for tab:', tabId);
  
  // STEP 1: Get current tab state
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (e) {
    logError('Cannot get tab info:', e);
    return { success: false, error: '[no_tab] WhatsApp tab not found. It may have been closed.' };
  }
  
  // STEP 2: Handle discarded (sleeping) tabs
  if (tab.discarded) {
    log('Tab is discarded (sleeping), attempting to wake up...');
    const woken = await wakeUpDiscardedTab(tabId);
    if (!woken) {
      return { 
        success: false, 
        error: '[no_content_script] WhatsApp tab is sleeping or loading. Please open the tab.' 
      };
    }
    // Refresh tab info after wake up
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (e) {
      return { success: false, error: '[tab_closed] Tab was closed during wake up.' };
    }
  }
  
  // STEP 3: Handle loading tabs - wait for them to complete
  if (tab.status === 'loading') {
    log('Tab is loading, waiting for it to complete...');
    const loaded = await waitForTabToLoad(tabId, 5000);
    if (!loaded) {
      return { 
        success: false, 
        error: '[no_content_script] WhatsApp tab is still loading. Please wait for it to finish loading.' 
      };
    }
  }
  
  // STEP 4: Try to ping existing content script first
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'VANTO_PING' });
    if (response && response.pong) {
      // Content script exists, but check if initialized
      if (response.initialized) {
        log('Content script already active and initialized on tab:', tabId);
        return { success: true };
      } else {
        log('Content script exists but not initialized, sending init...');
        try {
          const initResponse = await chrome.tabs.sendMessage(tabId, { type: 'VANTO_INIT' });
          if (initResponse && initResponse.initialized) {
            return { success: true };
          }
        } catch (e) {
          logError('Failed to init content script:', e);
        }
      }
    }
  } catch (e) {
    log('Content script not responding, will inject programmatically:', e.message);
  }

  // STEP 5: Content script not loaded - inject it programmatically with retry
  const result = await injectContentScriptWithRetry(tabId, 2);
  
  if (!result.success) {
    logError('Content script injection failed after all attempts:', result.error);
    return { 
      success: false, 
      error: '[no_content_script] WhatsApp page not ready. Please refresh WhatsApp Web and try again.' 
    };
  }
  
  return { success: true };
}

// =====================================================
// GROUP POLLING ENGINE
// =====================================================
chrome.alarms.create('vanto-group-poll', { periodInMinutes: 1 });
chrome.alarms.create('vanto-heartbeat', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'vanto-group-poll') {
    await pollDuePosts();
  } else if (alarm.name === 'vanto-heartbeat') {
    await sendHeartbeat();
  }
});

async function sendHeartbeat() {
  const session = await getSession();
  if (!session.token) return;

  try {
    // Find WhatsApp tabs
    const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    const hasWhatsAppTab = tabs.length > 0;

    // Update heartbeat in integration_settings table (key: chrome_extension_heartbeat)
    try {
      const heartbeatData = {
        last_seen: new Date().toISOString(),
        whatsapp_ready: hasWhatsAppTab
      };

      // Use upsert via POST with on_conflict
      const response = await fetch(`${SUPABASE_URL}/rest/v1/integration_settings?on_conflict=key`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.token}`,
          'apikey': SUPABASE_ANON_KEY,
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify({
          key: 'chrome_extension_heartbeat',
          value: JSON.stringify(heartbeatData)
        })
      });

      if (response.ok) {
        log('Heartbeat recorded to integration_settings');
      } else {
        const errorText = await response.text();
        logError('Failed to record heartbeat:', errorText);
      }
    } catch (e) {
      logError('Heartbeat database error:', e);
    }

    // Ping content scripts
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'VANTO_PING' });
        log('Heartbeat sent to tab:', tab.id);
      } catch (e) {
        log('Tab not ready for heartbeat:', tab.id);
      }
    }
  } catch (error) {
    logError('Heartbeat error', error);
  }
}

async function pollDuePosts() {
  log('Polling for due posts...');
  const token = await refreshTokenIfNeeded();
  if (!token) {
    log('No token, skipping poll');
    return;
  }

  try {
    const now = new Date().toISOString();
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/scheduled_group_posts?status=eq.pending&scheduled_at=lte.${now}&select=*`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': SUPABASE_ANON_KEY
        }
      }
    );

    if (!response.ok) {
      logError('Poll posts failed');
      return;
    }

    const posts = await response.json();
    log(`Found ${posts.length} due posts`);

    for (const post of posts) {
      await executeGroupPost(post, token);
    }
  } catch (error) {
    logError('Poll posts error', error);
  }
}

async function executeGroupPost(post, token) {
  log('Executing post:', post.id, 'to group:', post.target_group_name);

  // Find WhatsApp tabs with retry logic
  let tabs = [];
  const maxRetries = 3;
  const retryDelay = 2000; // 2 seconds between retries

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    log(`Tab detection attempt ${attempt}/${maxRetries}`);
    tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    
    if (tabs.length > 0) {
      log('WhatsApp tab found:', tabs[0].id, tabs[0].title);
      break;
    }
    
    // Also try without trailing slash
    if (tabs.length === 0) {
      tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/' });
      if (tabs.length > 0) {
        log('WhatsApp tab found (alternate URL):', tabs[0].id);
        break;
      }
    }
    
    if (attempt < maxRetries) {
      log(`No tabs found, waiting ${retryDelay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }

  if (tabs.length === 0) {
    logError('No WhatsApp tabs found after all retries');
    await updatePostStatus(post.id, 'failed', '[no_tab] No WhatsApp Web tab open. Please open web.whatsapp.com and keep it active.', token);
    return;
  }

  const tab = tabs[0];

  // Mark as executing to prevent duplicate runs
  await updatePostStatus(post.id, 'executing', null, token);

  try {
    // Ensure content script is injected (with programmatic fallback)
    const injectResult = await ensureContentScriptInjected(tab.id);
    if (!injectResult.success) {
      logError('Content script injection failed:', injectResult.error);
      await updatePostStatus(post.id, 'failed', injectResult.error || '[no_content_script] Could not initialize extension on WhatsApp page.', token);
      return;
    }
    log('Content script verified ready');

    // Send execution message with longer timeout (content script has its own 90s timeout)
    const response = await Promise.race([
      chrome.tabs.sendMessage(tab.id, {
        type: 'VANTO_EXECUTE_GROUP_POST',
        post: {
          id: post.id,
          target_group_name: post.target_group_name,
          message_content: post.message_content
        }
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Execution timeout - no response from content script')), EXECUTION_TIMEOUT)
      )
    ]);

    log('Execution response:', response);

    if (response && response.success) {
      await updatePostStatus(post.id, 'sent', null, token);
      log('Post sent successfully:', post.id);
    } else {
      const errorMsg = response?.error || 'Unknown error from content script';
      await updatePostStatus(post.id, 'failed', errorMsg, token);
      logError('Post failed:', errorMsg);
    }
  } catch (error) {
    logError('Execute post error', error);
    await updatePostStatus(post.id, 'failed', `[exec_error] ${error.message}`, token);
  }
}

async function updatePostStatus(postId, status, errorMessage, token) {
  log('Updating post status:', postId, status);
  try {
    const updateData = { status };
    if (errorMessage) {
      updateData.failure_reason = errorMessage; // Fixed: was error_message, DB uses failure_reason
    }
    updateData.last_attempt_at = new Date().toISOString();
    updateData.attempt_count = 1; // Increment on each attempt

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/scheduled_group_posts?id=eq.${postId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': SUPABASE_ANON_KEY,
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(updateData)
      }
    );

    if (!response.ok) {
      logError('Update status failed');
    }
  } catch (error) {
    logError('Update status error', error);
  }
}

// =====================================================
// MESSAGE ROUTER
// =====================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log('Received message:', message.type);

  // Return true to indicate async response
  (async () => {
    let result;

    switch (message.type) {
      case 'VANTO_GET_SESSION':
        const session = await getSession();
        if (session.token) {
          const newToken = await refreshTokenIfNeeded();
          result = {
            token: newToken,
            email: session.email
          };
        } else {
          result = { token: null, email: null };
        }
        break;

      case 'VANTO_LOGIN':
        result = await handleLogin(message.email, message.password);
        break;

      case 'VANTO_LOGOUT':
        result = await handleLogout();
        break;

      case 'VANTO_RESET_PASSWORD':
        result = await handleResetPassword(message.email);
        break;

      case 'VANTO_SAVE_CONTACT':
        const saveToken = await refreshTokenIfNeeded();
        if (!saveToken) {
          result = { success: false, error: 'Not authenticated' };
        } else {
          result = await handleSaveContact(message.payload, saveToken);
        }
        break;

      case 'VANTO_LOAD_CONTACT':
        const loadToken = await refreshTokenIfNeeded();
        if (!loadToken) {
          result = { success: false, error: 'Not authenticated' };
        } else {
          result = await handleLoadContact(message.phone, loadToken);
        }
        break;

      case 'VANTO_LOAD_TEAM':
        const teamToken = await refreshTokenIfNeeded();
        if (!teamToken) {
          result = { success: false, error: 'Not authenticated' };
        } else {
          result = await handleLoadTeamMembers(teamToken);
        }
        break;

      case 'VANTO_UPSERT_GROUP':
        const groupToken = await refreshTokenIfNeeded();
        if (!groupToken) {
          result = { success: false, error: '[no_session] Not authenticated. Please log in to save groups.' };
        } else {
          result = await handleUpsertGroup(message.groupName, groupToken, message.groupJid || null);
        }
        break;

      case 'VANTO_POST_RESULT':
        log('Post result received:', message);
        result = { success: true };
        break;

      default:
        result = { success: false, error: 'Unknown message type' };
    }

    sendResponse(result);
  })();

  return true;
});

// =====================================================
// INITIALIZATION
// =====================================================
log('Background service worker started (Lovable Edition)');
log('Supabase URL:', SUPABASE_URL);
log('Dashboard URL:', DASHBOARD_URL);
log('Execution timeout:', EXECUTION_TIMEOUT, 'ms');

// =====================================================
// TAB UPDATE LISTENER - Proactive injection
// =====================================================
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only act when the tab is done loading and is WhatsApp Web
  if (changeInfo.status === 'complete' && tab.url && tab.url.includes('web.whatsapp.com')) {
    log('WhatsApp tab updated, ensuring content script is injected:', tabId);
    
    // Give WhatsApp a moment to render
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Ensure content script is injected
    const success = await ensureContentScriptInjected(tabId);
    if (success) {
      log('Content script ready on WhatsApp tab:', tabId);
    } else {
      logError('Failed to inject content script on WhatsApp tab:', tabId);
    }
  }
});
