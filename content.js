// Content script — triggers credential scan for the current provider page

console.log("[Token Extractor] Content script loaded");

function providerFromHost() {
  const host = location.hostname;
  if (/chat\.deepseek\.com$/i.test(host)) return "deepseek-web";
  if (/chat\.qwen\.ai$/i.test(host)) return "qwen-web";
  if (/(?:^|\.)kimi\.(?:ai|com)$/i.test(host)) return "kimi-web";
  return null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "scanTokens") {
    const provider = providerFromHost();
    if (provider === "qwen-web") {
      chrome.runtime.sendMessage({ action: "scanQwenCookies" }, () => {
        sendResponse({ status: "scanning", provider });
      });
      return true;
    }
    sendResponse({ status: "scanning", provider });
  }
  return true;
});

const provider = providerFromHost();
if (provider === "qwen-web") {
  setTimeout(() => chrome.runtime.sendMessage({ action: "scanQwenCookies" }), 800);
}

console.log("[Token Extractor] Content script initialized");
