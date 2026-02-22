// src/background.js
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    generationState: {
      status: "idle",
      text: null,
      imageData: null,
      mimeType: null,
      error: null
    }
  });
  chrome.contextMenus.create({
    id: "generate-diagram",
    title: "\u30C6\u30AD\u30B9\u30C8\u304B\u3089\u56F3\u89E3\u3092\u751F\u6210",
    contexts: ["selection"]
  });
});
async function updateGenerationState(state) {
  try {
    await chrome.storage.local.set({ generationState: state });
  } catch (storageError) {
    if (state.imageData) {
      await chrome.storage.local.set({
        generationState: {
          ...state,
          status: "error",
          imageData: null,
          mimeType: null,
          error: "\u30B9\u30C8\u30EC\u30FC\u30B8\u3078\u306E\u4FDD\u5B58\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002\u518D\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002"
        }
      });
    }
  }
  try {
    await chrome.runtime.sendMessage({ type: "GENERATION_STATE_CHANGED", state });
  } catch {
  }
}
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "generate-diagram") return;
  const selectedText = info.selectionText;
  if (!selectedText) return;
  try {
    const settings = await chrome.storage.local.get(["apiKey", "projectId", "location", "style", "resolution"]);
    if (!settings.apiKey || !settings.projectId) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "\u30A8\u30E9\u30FC",
        message: "API\u30AD\u30FC\u307E\u305F\u306F\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8ID\u304C\u8A2D\u5B9A\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002\u62E1\u5F35\u6A5F\u80FD\u306E\u8A2D\u5B9A\u753B\u9762\u304B\u3089\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
      });
      return;
    }
    chrome.notifications.create("generating", {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "\u56F3\u89E3\u751F\u6210\u4E2D...",
      message: "\u30C6\u30AD\u30B9\u30C8\u304B\u3089\u56F3\u89E3\u753B\u50CF\u3092\u751F\u6210\u3057\u3066\u3044\u307E\u3059\u3002\u3057\u3070\u3089\u304F\u304A\u5F85\u3061\u304F\u3060\u3055\u3044\u3002"
    });
    const result = await generateDiagram(
      selectedText,
      settings.apiKey,
      settings.projectId,
      settings.location || "us-central1",
      settings.style || "\u30B7\u30F3\u30D7\u30EB",
      settings.resolution || "1K"
    );
    chrome.notifications.clear("generating");
    if (result.error) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "\u30A8\u30E9\u30FC",
        message: result.error
      });
      return;
    }
    await copyImageToClipboard(result.imageData, result.mimeType);
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "\u5B8C\u4E86",
      message: "\u56F3\u89E3\u753B\u50CF\u3092\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F"
    });
  } catch (error) {
    chrome.notifications.clear("generating");
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "\u30A8\u30E9\u30FC",
      message: `\u56F3\u89E3\u306E\u751F\u6210\u306B\u5931\u6557\u3057\u307E\u3057\u305F: ${error.message}`
    });
  }
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "GENERATE_DIAGRAM") {
    handleGenerateRequest(message);
    sendResponse({ accepted: true });
    return false;
  }
  if (message.type === "CLEAR_GENERATION") {
    updateGenerationState({
      status: "idle",
      text: null,
      imageData: null,
      mimeType: null,
      error: null
    });
    sendResponse({ success: true });
    return false;
  }
  if (message.type === "COPY_IMAGE") {
    copyImageToClipboard(message.imageData, message.mimeType).then(() => sendResponse({ success: true })).catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});
async function handleGenerateRequest(message) {
  const { text, apiKey, projectId, location, style, resolution } = message;
  if (!apiKey || !projectId) {
    await updateGenerationState({
      status: "error",
      text,
      imageData: null,
      mimeType: null,
      error: "API\u30AD\u30FC\u307E\u305F\u306F\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8ID\u304C\u8A2D\u5B9A\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002\u8A2D\u5B9A\u753B\u9762\u304B\u3089\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
    });
    return;
  }
  if (!text || text.trim().length === 0) {
    await updateGenerationState({
      status: "error",
      text,
      imageData: null,
      mimeType: null,
      error: "\u30C6\u30AD\u30B9\u30C8\u304C\u9078\u629E\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002Web\u30DA\u30FC\u30B8\u4E0A\u3067\u30C6\u30AD\u30B9\u30C8\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044\u3002"
    });
    return;
  }
  const MAX_RETRIES = 3;
  try {
    await updateGenerationState({
      status: "generating",
      text,
      imageData: null,
      mimeType: null,
      error: null,
      startedAt: Date.now(),
      retryInfo: null
    });
    let result;
    let attempt = 0;
    while (attempt <= MAX_RETRIES) {
      result = await generateDiagram(text, apiKey, projectId, location || "us-central1", style, resolution);
      if (!result.rateLimited || attempt >= MAX_RETRIES) break;
      attempt++;
      const waitSec = 10 * Math.pow(2, attempt - 1);
      await updateGenerationState({
        status: "generating",
        text,
        imageData: null,
        mimeType: null,
        error: null,
        startedAt: Date.now(),
        retryInfo: `\u30EC\u30FC\u30C8\u5236\u9650\u306E\u305F\u3081 ${waitSec}\u79D2\u5F8C\u306B\u518D\u8A66\u884C\u3057\u307E\u3059\uFF08${attempt}/${MAX_RETRIES}\uFF09...`
      });
      await new Promise((r) => setTimeout(r, waitSec * 1e3));
    }
    if (result.error) {
      await updateGenerationState({
        status: "error",
        text,
        imageData: null,
        mimeType: null,
        error: result.error
      });
    } else {
      await updateGenerationState({
        status: "completed",
        text,
        imageData: result.imageData,
        mimeType: result.mimeType,
        error: null
      });
    }
  } catch (error) {
    try {
      await updateGenerationState({
        status: "error",
        text,
        imageData: null,
        mimeType: null,
        error: `\u4E88\u671F\u3057\u306A\u3044\u30A8\u30E9\u30FC\u304C\u767A\u751F\u3057\u307E\u3057\u305F: ${error.message}`
      });
    } catch {
    }
  }
}
async function generateDiagram(text, apiKey, projectId, location, style = "\u30B7\u30F3\u30D7\u30EB", resolution = "1K") {
  const prompt = `\u4EE5\u4E0B\u306E\u30C6\u30AD\u30B9\u30C8\u5185\u5BB9\u3092\u3001\u308F\u304B\u308A\u3084\u3059\u3044\u56F3\u89E3\u753B\u50CF\u3068\u3057\u3066\u751F\u6210\u3057\u3066\u304F\u3060\u3055\u3044\u3002
- \u65E5\u672C\u8A9E\u3067\u8A18\u8F09
- \u8981\u70B9\u3092\u69CB\u9020\u5316\u3057\u3066\u8996\u899A\u7684\u306B\u8868\u73FE
- \u80CC\u666F\u306F\u767D
- \u30C6\u30AD\u30B9\u30C8\u306F\u8AAD\u307F\u3084\u3059\u3044\u30D5\u30A9\u30F3\u30C8\u30B5\u30A4\u30BA\u3067\u6B63\u78BA\u306B\u63CF\u753B
- \u30B9\u30BF\u30A4\u30EB: ${style}

\u30C6\u30AD\u30B9\u30C8:
${text}`;
  const model = "gemini-2.0-flash-exp";
  const endpoint = `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"]
    }
  };
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9e4);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      const errorBody = await response.text();
      let errorMsg = `HTTP ${response.status}`;
      try {
        const errorJson = JSON.parse(errorBody);
        errorMsg = errorJson.error?.message || errorMsg;
      } catch {
        errorMsg = errorBody || errorMsg;
      }
      if (response.status === 429) {
        return { error: `\u30EC\u30FC\u30C8\u5236\u9650: ${errorMsg}`, rateLimited: true };
      }
      if (response.status === 401 || response.status === 403) {
        return { error: `\u8A8D\u8A3C\u30A8\u30E9\u30FC: ${errorMsg}

API\u30AD\u30FC\u3068\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8ID\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002Vertex AI API\u304C\u6709\u52B9\u306B\u306A\u3063\u3066\u3044\u308B\u304B\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\u3002` };
      }
      return { error: `API \u30A8\u30E9\u30FC (${response.status}): ${errorMsg}` };
    }
    const data = await response.json();
    if (!data.candidates || data.candidates.length === 0) {
      return { error: "API\u304B\u3089\u306E\u5FDC\u7B54\u304C\u7A7A\u3067\u3057\u305F\u3002\u5225\u306E\u30C6\u30AD\u30B9\u30C8\u3067\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002" };
    }
    const parts = data.candidates[0].content.parts;
    let imageData = null;
    let mimeType = null;
    let textResponse = "";
    for (const part of parts) {
      if (part.thought) continue;
      if (part.inlineData) {
        imageData = part.inlineData.data;
        mimeType = part.inlineData.mimeType;
      } else if (part.text) {
        textResponse += part.text;
      }
    }
    if (!imageData) {
      return { error: "\u753B\u50CF\u306E\u751F\u6210\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002\u30C6\u30AD\u30B9\u30C8\u3092\u5909\u66F4\u3057\u3066\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002" };
    }
    return { imageData, mimeType, textResponse };
  } catch (error) {
    if (error.name === "AbortError") {
      return { error: "\u751F\u6210\u304C\u30BF\u30A4\u30E0\u30A2\u30A6\u30C8\u3057\u307E\u3057\u305F\uFF0890\u79D2\uFF09\u3002\u30C6\u30AD\u30B9\u30C8\u3092\u77ED\u304F\u3057\u3066\u518D\u8A66\u884C\u3057\u3066\u304F\u3060\u3055\u3044\u3002" };
    }
    const msg = error.message || "";
    if (msg.includes("429") || msg.includes("rate limit") || msg.includes("quota")) {
      return { error: `\u30EC\u30FC\u30C8\u5236\u9650: ${msg}`, rateLimited: true };
    }
    return { error: `API \u30A8\u30E9\u30FC: ${msg}` };
  }
}
var creatingOffscreen = null;
async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"]
  });
  if (existingContexts.length > 0) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  creatingOffscreen = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["CLIPBOARD"],
    justification: "\u56F3\u89E3\u753B\u50CF\u3092\u30AF\u30EA\u30C3\u30D7\u30DC\u30FC\u30C9\u306B\u30B3\u30D4\u30FC\u3059\u308B\u305F\u3081"
  });
  await creatingOffscreen;
  creatingOffscreen = null;
}
async function copyImageToClipboard(imageData, mimeType) {
  await ensureOffscreenDocument();
  return new Promise((resolve, reject) => {
    const listener = (message) => {
      if (message.type === "CLIPBOARD_RESULT") {
        chrome.runtime.onMessage.removeListener(listener);
        if (message.success) {
          resolve();
        } else {
          reject(new Error(message.error || "\u30AF\u30EA\u30C3\u30D7\u30DC\u30FC\u30C9\u3078\u306E\u30B3\u30D4\u30FC\u306B\u5931\u6557\u3057\u307E\u3057\u305F"));
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    chrome.runtime.sendMessage({
      type: "COPY_TO_CLIPBOARD",
      target: "offscreen",
      imageData,
      mimeType
    });
    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error("\u30AF\u30EA\u30C3\u30D7\u30DC\u30FC\u30C9\u30B3\u30D4\u30FC\u304C\u30BF\u30A4\u30E0\u30A2\u30A6\u30C8\u3057\u307E\u3057\u305F"));
    }, 5e3);
  });
}
