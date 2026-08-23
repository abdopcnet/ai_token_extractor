// Content script - injects token extraction logic into the page

console.log('[Token Extractor] Content script loaded');

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'scanTokens') {
    // Try to extract token from the page's network requests
    // Since we can't intercept network requests directly from content script,
    // we'll check for any exposed tokens in the page context
    scanForTokens();
    sendResponse({ status: 'scanning' });
  }
  return true;
});

// Function to scan for tokens in the page
function scanForTokens() {
  // This is a fallback - the background script handles main token extraction
  // We can also try to extract tokens from the page's global variables or DOM
  try {
    // Check for common token storage patterns
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const content = script.textContent;
      if (content) {
        // Look for JWT tokens in the page source
        const jwtMatch = content.match(/Bearer\s+([a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+\.[a-zA-Z0-9_\-]+)/);
        if (jwtMatch) {
          console.log('[Token Extractor] Found JWT token in script:', jwtMatch[1].substring(0, 20) + '...');
          // Store it in storage (background script will pick it up)
          chrome.storage.local.set({ deepseek_token: jwtMatch[1] });
        }
      }
    }
  } catch (error) {
    console.error('[Token Extractor] Error scanning for tokens:', error);
  }
}

// Immediately scan for tokens when the page loads
setTimeout(scanForTokens, 1000);

// Also listen for new script elements being added
const observer = new MutationObserver(() => {
  scanForTokens();
});
observer.observe(document, { childList: true, subtree: true });

console.log('[Token Extractor] Content script initialized');
