// Vanto CRM Popup Script v6.0 - Lovable Edition

document.addEventListener('DOMContentLoaded', init);

async function init() {
  // Check session
  const session = await sendMessage({ type: 'VANTO_GET_SESSION' });

  if (session && session.token) {
    showView('loggedin');
    document.getElementById('user-email').textContent = session.email || 'User';
  } else {
    showView('login');
  }

  // Wire up events
  wireEvents();
}

function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + viewId).classList.add('active');
}

function showError(elementId, message) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.style.display = 'block';
}

function hideError(elementId) {
  document.getElementById(elementId).style.display = 'none';
}

function showSuccess(elementId, message) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.style.display = 'block';
}

function hideSuccess(elementId) {
  document.getElementById(elementId).style.display = 'none';
}

function wireEvents() {
  // Login button
  document.getElementById('login-btn').addEventListener('click', handleLogin);

  // Enter key on password field
  document.getElementById('login-password').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleLogin();
  });

  // Forgot password button
  document.getElementById('forgot-btn').addEventListener('click', () => {
    hideError('login-error');
    showView('forgot');
  });

  // Back to login
  document.getElementById('back-to-login').addEventListener('click', () => {
    hideError('forgot-error');
    hideSuccess('forgot-success');
    showView('login');
  });

  // Reset password button
  document.getElementById('reset-btn').addEventListener('click', handleResetPassword);

  // Logout button
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
}

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (!email || !password) {
    showError('login-error', 'Please enter email and password');
    return;
  }

  hideError('login-error');
  document.getElementById('login-btn').disabled = true;
  document.getElementById('login-btn').textContent = 'Logging in...';

  const response = await sendMessage({
    type: 'VANTO_LOGIN',
    email,
    password
  });

  document.getElementById('login-btn').disabled = false;
  document.getElementById('login-btn').textContent = 'Log In';

  if (response.success) {
    document.getElementById('user-email').textContent = response.email || email;
    showView('loggedin');
  } else {
    showError('login-error', response.error || 'Login failed');
  }
}

async function handleResetPassword() {
  const email = document.getElementById('forgot-email').value.trim();

  if (!email) {
    showError('forgot-error', 'Please enter your email');
    return;
  }

  hideError('forgot-error');
  hideSuccess('forgot-success');
  document.getElementById('reset-btn').disabled = true;
  document.getElementById('reset-btn').textContent = 'Sending...';

  const response = await sendMessage({
    type: 'VANTO_RESET_PASSWORD',
    email
  });

  document.getElementById('reset-btn').disabled = false;
  document.getElementById('reset-btn').textContent = 'Send Reset Link';

  if (response.success) {
    showSuccess('forgot-success', 'Reset link sent! Check your email.');
  } else {
    showError('forgot-error', response.error || 'Failed to send reset link');
  }
}

async function handleLogout() {
  await sendMessage({ type: 'VANTO_LOGOUT' });
  showView('login');
  document.getElementById('login-email').value = '';
  document.getElementById('login-password').value = '';
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(response || { success: false, error: 'No response' });
      }
    });
  });
}
