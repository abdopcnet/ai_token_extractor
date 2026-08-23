// Popup script - handles UI interaction and token management

const providerSelect = document.getElementById('providerSelect');
const tokenInput = document.getElementById('tokenInput');
const copyBtn = document.getElementById('copyBtn');
const refreshBtn = document.getElementById('refreshBtn');
const statusEl = document.getElementById('status');

// Provider names for display
const PROVIDER_LABELS = {
  'deepseek': 'DeepSeek Web',
  'openai': 'OpenAI API',
  'anthropic': 'Anthropic Claude',
  'groq': 'Groq Cloud',
  'mistral': 'Mistral AI',
  'cohere': 'Cohere',
  'custom': 'Custom'
};

// Load tokens from storage and populate dropdown
async function loadTokens() {
  try {
    const result = await chrome.storage.local.get(['tokens', 'selectedProvider']);
    const tokens = result.tokens || {};
    const selected = result.selectedProvider || '';
    
    // Populate dropdown
    const providerKeys = Object.keys(tokens);
    providerSelect.innerHTML = '';
    
    if (providerKeys.length === 0) {
      providerSelect.innerHTML = '<option value="">No tokens found</option>';
      tokenInput.value = '';
      tokenInput.placeholder = 'No tokens available';
      return;
    }
    
    // Add placeholder option
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '-- Select a provider --';
    providerSelect.appendChild(placeholder);
    
    // Add provider options
    providerKeys.forEach(key => {
      const option = document.createElement('option');
      option.value = key;
      const label = PROVIDER_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1);
      option.textContent = `${label} ${tokens[key] ? '✓' : '⚠'}`;
      providerSelect.appendChild(option);
    });
    
    // Restore selection
    if (selected && tokens[selected]) {
      providerSelect.value = selected;
      updateTokenDisplay(selected, tokens[selected]);
    } else if (providerKeys.length > 0) {
      providerSelect.value = providerKeys[0];
      updateTokenDisplay(providerKeys[0], tokens[providerKeys[0]]);
    }
  } catch (error) {
    console.error('Error loading tokens:', error);
    setStatus('Error loading tokens', 'error');
  }
}

// Update the token input field
function updateTokenDisplay(provider, token) {
  if (token && token.startsWith('Bearer ')) {
    token = token.replace('Bearer ', '').trim();
  }
  tokenInput.value = token || '';
  tokenInput.placeholder = token ? '' : 'No token for this provider';
}

// Set status message
function setStatus(message, type = 'info') {
  statusEl.textContent = message;
  statusEl.className = 'status ' + type;
  setTimeout(() => {
    statusEl.className = 'status';
  }, 3000);
}

// Copy token to clipboard
async function copyToken() {
  const token = tokenInput.value.trim();
  if (!token) {
    setStatus('No token to copy', 'error');
    return;
  }
  try {
    await navigator.clipboard.writeText(token);
    setStatus('✅ Token copied!', 'success');
  } catch (error) {
    // Fallback: select and copy
    tokenInput.select();
    document.execCommand('copy');
    setStatus('✅ Token copied!', 'success');
  }
}

// Refresh tokens by asking background script to scan
async function refreshTokens() {
  setStatus('Scanning for tokens...', 'info');
  try {
    // Send message to background to trigger token scanning
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      await chrome.tabs.sendMessage(tabs[0].id, { action: 'scanTokens' });
    }
    // Also ask background to check its stored tokens
    const response = await chrome.runtime.sendMessage({ action: 'getTokens' });
    if (response && response.tokens) {
      await chrome.storage.local.set({ tokens: response.tokens });
      await loadTokens();
      setStatus('🔄 Tokens refreshed', 'success');
    } else {
      setStatus('No tokens found - open a provider page', 'info');
      await loadTokens();
    }
  } catch (error) {
    console.error('Error refreshing tokens:', error);
    setStatus('Could not refresh tokens', 'error');
    await loadTokens();
  }
}

// Event listeners
providerSelect.addEventListener('change', async () => {
  const provider = providerSelect.value;
  if (!provider) {
    tokenInput.value = '';
    return;
  }
  const result = await chrome.storage.local.get(['tokens']);
  const tokens = result.tokens || {};
  const token = tokens[provider] || '';
  updateTokenDisplay(provider, token);
  // Save selection
  await chrome.storage.local.set({ selectedProvider: provider });
});

copyBtn.addEventListener('click', copyToken);
refreshBtn.addEventListener('click', refreshTokens);

// Initialize
loadTokens();

// Listen for storage changes from background
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.tokens) {
    loadTokens();
  }
});
