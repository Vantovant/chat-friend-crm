// Vanto CRM Chrome Extension - Background Service Worker v6.0
// LOVABLE EDITION - Uses OLD Supabase
// Updated with enhanced logging and 90s timeout

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
// GROUP UPSERT
// =====================================================
async function handleUpsertGroup(groupName, token) {
  log('Upserting group:', groupName);
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/whatsapp_groups`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': SUPABASE_ANON_KEY,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({ group_name: groupName })
    });

    if (!response.ok) {
      const error = await response.text();
      logError('Upsert group failed', error);
      return { success: false, error };
    }

    log('Group upserted successfully');
    return { success: true };
  } catch (error) {
    logError('Upsert group error', error);
    return { success: false, error: error.message };
  }
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

    // Send heartbeat to extension_heartbeats table (upsert)
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/extension_heartbeats?on_conflict=user_id`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.token}`,
          'apikey': SUPABASE_ANON_KEY,
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify({
          user_id: session.email, // This will be replaced by auth.uid() on server
          whatsapp_tab_open: hasWhatsAppTab,
          extension_version: '6.0.0'
        })
      });

      if (response.ok) {
        log('Heartbeat recorded to extension_heartbeats table');
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

  // Find WhatsApp tabs
  const tabs = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
  if (tabs.length === 0) {
    logError('No WhatsApp tabs found');
    await updatePostStatus(post.id, 'failed', 'No WhatsApp tab open', token);
    return;
  }

  const tab = tabs[0];

  // Mark as executing to prevent duplicate runs
  await updatePostStatus(post.id, 'executing', null, token);

  try {
    // Send execution message with timeout
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
        setTimeout(() => reject(new Error('Tab message timeout')), 5000)
      )
    ]);

    log('Execution response:', response);

    if (response && response.success) {
      await updatePostStatus(post.id, 'sent', null, token);
      log('Post sent successfully:', post.id);
    } else {
      const errorMsg = response?.error || 'Unknown error';
      await updatePostStatus(post.id, 'failed', errorMsg, token);
      logError('Post failed:', errorMsg);
    }
  } catch (error) {
    logError('Execute post error', error);
    await updatePostStatus(post.id, 'failed', error.message, token);
  }
}

async function updatePostStatus(postId, status, errorMessage, token) {
  log('Updating post status:', postId, status);
  try {
    const updateData = { status };
    if (errorMessage) {
      updateData.error_message = errorMessage;
    }

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
          result = { success: false, error: 'Not authenticated' };
        } else {
          result = await handleUpsertGroup(message.groupName, groupToken);
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
