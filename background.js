// Background service worker - intercepts and stores tokens from web requests

// Store tokens by provider
let tokenStore = {};

// Provider detection patterns
const PROVIDER_PATTERNS = [
  { pattern: /chat\.deepseek\.com/, provider: 'deepseek' },
  { pattern: /www\.kimi\.ai/, provider: 'kimi' },
];

// Detect provider from URL
function detectProvider(url) {
  for (const { pattern, provider } of PROVIDER_PATTERNS) {
    if (pattern.test(url)) {
      return provider;
    }
  }
  return null;
}

// Extract bearer token from headers
function extractBearerToken(headers) {
  for (const header of headers) {
    if (header.name.toLowerCase() === 'authorization') {
      const value = header.value || '';
      const match = value.match(/^Bearer\s+(.+)$/i);
      if (match) {
        return match[1];
      }
    }
  }
  return null;
}

// Intercept web requests
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const provider = detectProvider(details.url);
    if (!provider) return;

    const token = extractBearerToken(details.requestHeaders);
    if (token) {
      tokenStore[provider] = token;
      // Save to storage for persistence
      chrome.storage.local.set({ tokens: tokenStore });
      console.log(`[Token Extractor] Stored ${provider} token: ${token.substring(0, 20)}...`);
    }
  },
  {
    urls: [
      'https://chat.deepseek.com/*',
      'https://www.kimi.ai/*'
    ],
    types: ['xmlhttprequest']
  },
  ['requestHeaders']
);

// Load stored tokens on startup
chrome.storage.local.get(['tokens'], (result) => {
  if (result.tokens) {
    tokenStore = result.tokens;
    console.log('[Token Extractor] Loaded tokens from storage:', Object.keys(tokenStore));
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getTokens') {
    sendResponse({ tokens: tokenStore });
    return true;
  }
  if (message.action === 'refreshTokens') {
    // Trigger a scan by visiting a known provider page
    // The content script will handle this
    sendResponse({ status: 'scanning' });
    return true;
  }
});

console.log('[Token Extractor] Background service worker initialized');
