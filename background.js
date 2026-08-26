// Background service worker — auto-detect provider and extract OmniRoute credentials

let tokenStore = {};

const PROVIDERS = {
  "deepseek-web": {
    pattern: /chat\.deepseek\.com/i,
    label: "DeepSeek Web",
    kind: "bearer",
    scanAction: null,
  },
  "kimi-web": {
    pattern: /kimi\.(?:ai|com)/i,
    label: "Kimi Web",
    kind: "bearer",
    scanAction: null,
  },
  "qwen-web": {
    pattern: /chat\.qwen\.ai/i,
    label: "Qwen Web (Tongyi)",
    kind: "cookie-full",
    scanAction: "scanQwenCookies",
    requiredCookies: ["token", "cna", "ssxmod_itna"],
  },
};

const LEGACY_PROVIDER_KEYS = {
  deepseek: "deepseek-web",
  kimi: "kimi-web",
};

const QWEN_REQUIRED_COOKIES = ["token", "cna", "ssxmod_itna"];

function detectProviderFromUrl(url) {
  if (!url) return null;
  for (const [id, cfg] of Object.entries(PROVIDERS)) {
    if (cfg.pattern.test(url)) return id;
  }
  return null;
}

function normalizeStoredTokens(tokens) {
  const out = { ...tokens };
  for (const [legacy, current] of Object.entries(LEGACY_PROVIDER_KEYS)) {
    if (out[legacy] && !out[current]) {
      out[current] = out[legacy];
    }
    delete out[legacy];
  }
  delete out["gemini-web"];
  return out;
}

function extractBearerToken(headers) {
  for (const header of headers || []) {
    if (header.name.toLowerCase() === "authorization") {
      const value = header.value || "";
      const match = value.match(/^Bearer\s+(.+)$/i);
      if (match) return match[1];
    }
  }
  return null;
}

function parseCookieHeader(cookieHeader) {
  const map = {};
  if (!cookieHeader) return map;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    map[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return map;
}

function hasRequiredQwenCookies(cookieMap) {
  return QWEN_REQUIRED_COOKIES.every((name) => Boolean(cookieMap[name]));
}

function extractCookieHeader(headers) {
  for (const header of headers || []) {
    if (header.name.toLowerCase() === "cookie") return header.value || "";
  }
  return "";
}

function storeCredential(provider, value) {
  if (!provider || !value) return;
  tokenStore[provider] = value;
  chrome.storage.local.set({ tokens: tokenStore });
}

function extractHeaderValue(headers, name) {
  const lower = name.toLowerCase();
  for (const header of headers || []) {
    if (header.name.toLowerCase() === lower) return header.value || "";
  }
  return "";
}

function buildQwenCredentialBundle(cookieHeader, headers) {
  if (!cookieHeader || !hasRequiredQwenCookies(parseCookieHeader(cookieHeader))) return null;
  const cookie = cookieHeader.trim();
  const bxUa = extractHeaderValue(headers, "bx-ua");
  const bxUmidtoken = extractHeaderValue(headers, "bx-umidtoken");
  const bxV = extractHeaderValue(headers, "bx-v");
  const timezone = extractHeaderValue(headers, "Timezone");
  const version = extractHeaderValue(headers, "version");

  // Prefer JSON when we have the WAF fingerprint OmniRoute needs for completions.
  if (bxUa || bxUmidtoken || bxV || timezone || version) {
    const bundle = { cookie };
    if (bxUa) bundle["bx-ua"] = bxUa;
    if (bxUmidtoken) bundle["bx-umidtoken"] = bxUmidtoken;
    if (bxV) bundle["bx-v"] = bxV;
    if (timezone) bundle.Timezone = timezone;
    if (version) bundle.version = version;
    return JSON.stringify(bundle);
  }
  return cookie;
}

function extractQwenFromHeaders(headers) {
  const cookieHeader = extractCookieHeader(headers);
  return buildQwenCredentialBundle(cookieHeader, headers);
}

async function getCookiesForUrl(url) {
  try {
    return await chrome.cookies.getAll({ url });
  } catch (_) {
    return [];
  }
}

async function extractQwenFromCookieStore() {
  const urls = ["https://chat.qwen.ai/", "https://qwen.ai/"];
  const map = {};
  for (const url of urls) {
    for (const cookie of await getCookiesForUrl(url)) {
      map[cookie.name] = cookie.value;
    }
  }
  if (!hasRequiredQwenCookies(map)) return null;
  return Object.entries(map)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function mergeQwenCookieIntoStored(cookieOnly) {
  if (!cookieOnly) return null;
  const existing = tokenStore["qwen-web"];
  if (existing && existing.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(existing);
      if (parsed && typeof parsed === "object") {
        parsed.cookie = cookieOnly;
        return JSON.stringify(parsed);
      }
    } catch (_) {
      // fall through
    }
  }
  return cookieOnly;
}

async function refreshProvider(providerId) {
  if (providerId === "qwen-web") {
    const qwen = await extractQwenFromCookieStore();
    if (qwen) storeCredential("qwen-web", mergeQwenCookieIntoStored(qwen));
  }
  return tokenStore[providerId] || null;
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const providerId = detectProviderFromUrl(details.url);
    if (!providerId) return;

    const cfg = PROVIDERS[providerId];
    if (cfg.kind === "bearer") {
      const token = extractBearerToken(details.requestHeaders);
      if (token) storeCredential(providerId, token);
      return;
    }

    if (cfg.kind === "cookie-full" && providerId === "qwen-web") {
      const credential = extractQwenFromHeaders(details.requestHeaders);
      if (credential) storeCredential("qwen-web", credential);
    }
  },
  {
    urls: [
      "https://chat.deepseek.com/*",
      "https://www.kimi.ai/*",
      "https://www.kimi.com/*",
      "https://chat.qwen.ai/*",
    ],
    types: ["xmlhttprequest", "other"],
  },
  ["requestHeaders", "extraHeaders"]
);

chrome.storage.local.get(["tokens"], (result) => {
  tokenStore = normalizeStoredTokens(result.tokens || {});
  chrome.storage.local.set({ tokens: tokenStore });
});

async function analyzeActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || "";
  const providerId = detectProviderFromUrl(url);

  if (!providerId) {
    return {
      ok: false,
      url,
      message: "Open a supported provider tab (DeepSeek, Kimi, or Qwen).",
    };
  }

  const cfg = PROVIDERS[providerId];

  if (tab?.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: "scanTokens" });
    } catch (_) {
      // Content script may not be ready yet.
    }
  }

  await refreshProvider(providerId);

  const response = await new Promise((resolve) => {
    chrome.storage.local.get(["tokens"], (result) => {
      tokenStore = normalizeStoredTokens(result.tokens || {});
      resolve(tokenStore[providerId] || "");
    });
  });

  let credential = response;
  if (credential && credential.startsWith("Bearer ")) {
    credential = credential.replace(/^Bearer\s+/i, "").trim();
  }

  return {
    ok: true,
    providerId,
    providerLabel: cfg.label,
    credential,
    host: (() => {
      try {
        return new URL(url).hostname;
      } catch (_) {
        return url;
      }
    })(),
    hasCredential: Boolean(credential),
    hint: providerId === "qwen-web"
      ? "Paste into OmniRoute Qwen Web (JSON with cookie + bx-ua preferred)."
      : "Paste into OmniRoute as the provider API key / bearer token.",
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "analyzeActiveTab") {
    analyzeActiveTab().then(sendResponse);
    return true;
  }

  if (message.action === "getTokens") {
    sendResponse({ tokens: tokenStore });
    return true;
  }

  if (message.action === "scanQwenCookies") {
    (async () => {
      const qwen = await extractQwenFromCookieStore();
      const credential = qwen ? mergeQwenCookieIntoStored(qwen) : null;
      if (credential) storeCredential("qwen-web", credential);
      sendResponse({ status: credential ? "ok" : "missing", credential });
    })();
    return true;
  }

  if (message.action === "scanTokens") {
    sendResponse({ status: "scanning" });
    return true;
  }
});

console.log("[Token Extractor] Background service worker initialized");
