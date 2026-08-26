// Popup — auto-detect provider from active tab and show OmniRoute credential

const providerDisplay = document.getElementById("providerDisplay");
const hostHint = document.getElementById("hostHint");
const tokenInput = document.getElementById("tokenInput");
const copyBtn = document.getElementById("copyBtn");
const refreshBtn = document.getElementById("refreshBtn");
const statusEl = document.getElementById("status");

let currentProviderId = null;

function setStatus(message, type = "info") {
  statusEl.textContent = message;
  statusEl.className = "status " + type;
  setTimeout(() => {
    statusEl.className = "status";
  }, 3500);
}

function showUnsupported(message) {
  currentProviderId = null;
  providerDisplay.value = "Unsupported page";
  hostHint.textContent = "";
  tokenInput.value = "";
  tokenInput.placeholder = message;
  copyBtn.disabled = true;
}

function showProvider(result) {
  currentProviderId = result.providerId;
  providerDisplay.value = result.providerLabel;
  hostHint.textContent = result.host ? `From ${result.host}` : "";
  tokenInput.value = result.credential || "";
  tokenInput.placeholder = result.hasCredential
    ? ""
    : "Use the site (send a message), then click Refresh";
  copyBtn.disabled = !result.hasCredential;
}

async function analyzeTab() {
  providerDisplay.value = "Detecting...";
  tokenInput.value = "";
  tokenInput.placeholder = "Analyzing active tab...";
  copyBtn.disabled = true;

  try {
    const result = await chrome.runtime.sendMessage({ action: "analyzeActiveTab" });
    if (!result?.ok) {
      showUnsupported(result?.message || "Open DeepSeek, Kimi, or Qwen in the active tab.");
      setStatus("Switch to a supported provider tab", "info");
      return;
    }
    showProvider(result);
    if (result.hasCredential) {
      setStatus("Ready to copy for OmniRoute", "success");
    } else {
      setStatus("Interact with the site, then Refresh", "info");
    }
  } catch (error) {
    console.error(error);
    showUnsupported("Could not analyze the active tab.");
    setStatus("Analysis failed", "error");
  }
}

async function copyToken() {
  const token = tokenInput.value.trim();
  if (!token) {
    setStatus("Nothing to copy yet", "error");
    return;
  }
  try {
    await navigator.clipboard.writeText(token);
    setStatus("Copied!", "success");
  } catch (_) {
    tokenInput.select();
    document.execCommand("copy");
    setStatus("Copied!", "success");
  }
}

copyBtn.addEventListener("click", copyToken);
refreshBtn.addEventListener("click", analyzeTab);

analyzeTab();

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && changes.tokens && currentProviderId) {
    const tokens = changes.tokens.newValue || {};
    const credential = tokens[currentProviderId];
    if (credential) {
      tokenInput.value = credential.startsWith("Bearer ")
        ? credential.replace(/^Bearer\s+/i, "").trim()
        : credential;
      copyBtn.disabled = false;
    }
  }
});
