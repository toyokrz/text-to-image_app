(() => {
  // src/popup.js
  var settingsToggle = document.getElementById("settings-toggle");
  var settingsPanel = document.getElementById("settings-panel");
  var projectIdInput = document.getElementById("project-id");
  var locationSelect = document.getElementById("location-select");
  var apiKeyInput = document.getElementById("api-key");
  var toggleKeyVisibility = document.getElementById("toggle-key-visibility");
  var saveSettingsBtn = document.getElementById("save-settings");
  var settingsStatus = document.getElementById("settings-status");
  var apiKeyWarning = document.getElementById("api-key-warning");
  var styleSelect = document.getElementById("style-select");
  var resolutionSelect = document.getElementById("resolution-select");
  var selectedTextEl = document.getElementById("selected-text");
  var generateBtn = document.getElementById("generate-btn");
  var loading = document.getElementById("loading");
  var loadingText = document.getElementById("loading-text");
  var errorMessage = document.getElementById("error-message");
  var result = document.getElementById("result");
  var resultImage = document.getElementById("result-image");
  var copyBtn = document.getElementById("copy-btn");
  var copyStatus = document.getElementById("copy-status");
  var currentSelectedText = "";
  var currentImageData = null;
  var currentMimeType = null;
  var restoredStatus = null;
  var pollingInterval = null;
  function startPolling() {
    stopPolling();
    pollingInterval = setInterval(async () => {
      const { generationState } = await chrome.storage.local.get("generationState");
      if (!generationState) return;
      if (generationState.status !== "generating") {
        applyGenerationState(generationState);
        return;
      }
      if (generationState.startedAt && Date.now() - generationState.startedAt > 12e4) {
        const resetState = {
          status: "error",
          text: generationState.text,
          imageData: null,
          mimeType: null,
          error: "\u751F\u6210\u304C\u30BF\u30A4\u30E0\u30A2\u30A6\u30C8\u3057\u307E\u3057\u305F\u3002\u518D\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002"
        };
        await chrome.storage.local.set({ generationState: resetState });
        applyGenerationState(resetState);
      }
    }, 1e3);
  }
  function stopPolling() {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  }
  document.addEventListener("DOMContentLoaded", async () => {
    await loadSettings();
    await restoreGenerationState();
    await getSelectedText();
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "GENERATION_STATE_CHANGED") {
      applyGenerationState(message.state);
    }
  });
  async function restoreGenerationState() {
    const { generationState } = await chrome.storage.local.get("generationState");
    if (!generationState) return;
    if (generationState.status === "generating" && generationState.startedAt) {
      const elapsed = Date.now() - generationState.startedAt;
      if (elapsed > 12e4) {
        const resetState = {
          status: "error",
          text: generationState.text,
          imageData: null,
          mimeType: null,
          error: "\u751F\u6210\u304C\u30BF\u30A4\u30E0\u30A2\u30A6\u30C8\u3057\u307E\u3057\u305F\u3002\u518D\u5EA6\u304A\u8A66\u3057\u304F\u3060\u3055\u3044\u3002"
        };
        await chrome.storage.local.set({ generationState: resetState });
        restoredStatus = "error";
        applyGenerationState(resetState);
        return;
      }
    }
    restoredStatus = generationState.status;
    applyGenerationState(generationState);
  }
  function applyGenerationState(state) {
    if (!state) return;
    if (state.text) {
      currentSelectedText = state.text;
      selectedTextEl.textContent = state.text;
      selectedTextEl.classList.remove("empty");
    }
    switch (state.status) {
      case "generating":
        generateBtn.disabled = true;
        loading.classList.remove("hidden");
        loadingText.textContent = state.retryInfo || "\u56F3\u89E3\u3092\u751F\u6210\u3057\u3066\u3044\u307E\u3059...";
        errorMessage.classList.add("hidden");
        result.classList.add("hidden");
        startPolling();
        break;
      case "completed":
        stopPolling();
        loading.classList.add("hidden");
        errorMessage.classList.add("hidden");
        if (state.imageData) {
          currentImageData = state.imageData;
          currentMimeType = state.mimeType;
          resultImage.src = `data:${state.mimeType};base64,${state.imageData}`;
          result.classList.remove("hidden");
        }
        updateGenerateButton();
        break;
      case "error":
        stopPolling();
        loading.classList.add("hidden");
        result.classList.add("hidden");
        if (state.error) {
          showError(state.error);
        }
        updateGenerateButton();
        break;
      case "idle":
      default:
        stopPolling();
        loading.classList.add("hidden");
        errorMessage.classList.add("hidden");
        result.classList.add("hidden");
        updateGenerateButton();
        break;
    }
  }
  async function loadSettings() {
    const settings = await chrome.storage.local.get(["apiKey", "projectId", "location", "style", "resolution"]);
    if (settings.projectId) {
      projectIdInput.value = settings.projectId;
    }
    if (settings.location) {
      locationSelect.value = settings.location;
    }
    if (settings.apiKey) {
      apiKeyInput.value = settings.apiKey;
    }
    if (settings.apiKey && settings.projectId) {
      apiKeyWarning.classList.add("hidden");
    } else {
      apiKeyWarning.classList.remove("hidden");
    }
    if (settings.style) {
      styleSelect.value = settings.style;
    }
    if (settings.resolution) {
      resolutionSelect.value = settings.resolution;
    }
  }
  async function getSelectedText() {
    if (restoredStatus === "generating" || restoredStatus === "completed") return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) return;
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection().toString()
      });
      const text = results?.[0]?.result;
      if (text && text.trim().length > 0) {
        currentSelectedText = text.trim();
        selectedTextEl.textContent = currentSelectedText;
        selectedTextEl.classList.remove("empty");
        updateGenerateButton();
      }
    } catch (error) {
      console.log("\u9078\u629E\u30C6\u30AD\u30B9\u30C8\u306E\u53D6\u5F97\u306B\u5931\u6557:", error.message);
    }
  }
  function updateGenerateButton() {
    const hasApiKey = apiKeyInput.value.trim().length > 0;
    const hasProjectId = projectIdInput.value.trim().length > 0;
    const hasText = currentSelectedText.length > 0;
    generateBtn.disabled = !hasApiKey || !hasProjectId || !hasText;
  }
  settingsToggle.addEventListener("click", () => {
    settingsPanel.classList.toggle("hidden");
  });
  toggleKeyVisibility.addEventListener("click", () => {
    const isPassword = apiKeyInput.type === "password";
    apiKeyInput.type = isPassword ? "text" : "password";
  });
  saveSettingsBtn.addEventListener("click", async () => {
    const apiKey = apiKeyInput.value.trim();
    const projectId = projectIdInput.value.trim();
    const location = locationSelect.value;
    await chrome.storage.local.set({ apiKey, projectId, location });
    showStatus(settingsStatus, "\u4FDD\u5B58\u3057\u307E\u3057\u305F", "success");
    if (apiKey && projectId) {
      apiKeyWarning.classList.add("hidden");
    } else {
      apiKeyWarning.classList.remove("hidden");
    }
    updateGenerateButton();
  });
  styleSelect.addEventListener("change", async () => {
    await chrome.storage.local.set({ style: styleSelect.value });
  });
  resolutionSelect.addEventListener("change", async () => {
    await chrome.storage.local.set({ resolution: resolutionSelect.value });
  });
  generateBtn.addEventListener("click", async () => {
    if (!currentSelectedText) {
      showError("\u30C6\u30AD\u30B9\u30C8\u304C\u9078\u629E\u3055\u308C\u3066\u3044\u307E\u305B\u3093\u3002");
      return;
    }
    const apiKey = apiKeyInput.value.trim();
    const projectId = projectIdInput.value.trim();
    const location = locationSelect.value;
    if (!apiKey || !projectId) {
      showError("API\u30AD\u30FC\u3068\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8ID\u3092\u8A2D\u5B9A\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
      return;
    }
    generateBtn.disabled = true;
    loading.classList.remove("hidden");
    errorMessage.classList.add("hidden");
    result.classList.add("hidden");
    currentImageData = null;
    currentMimeType = null;
    startPolling();
    chrome.runtime.sendMessage({
      type: "GENERATE_DIAGRAM",
      text: currentSelectedText,
      apiKey,
      projectId,
      location,
      style: styleSelect.value,
      resolution: resolutionSelect.value
    });
  });
  copyBtn.addEventListener("click", async () => {
    if (!currentImageData || !currentMimeType) return;
    try {
      const byteCharacters = atob(currentImageData);
      const byteArray = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteArray[i] = byteCharacters.charCodeAt(i);
      }
      const blob = new Blob([byteArray], { type: "image/png" });
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob })
      ]);
      showStatus(copyStatus, "\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F\uFF01", "success");
    } catch (clipboardError) {
      try {
        const response = await chrome.runtime.sendMessage({
          type: "COPY_IMAGE",
          imageData: currentImageData,
          mimeType: currentMimeType
        });
        if (response.success) {
          showStatus(copyStatus, "\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F\uFF01", "success");
        } else {
          showStatus(copyStatus, "\u30B3\u30D4\u30FC\u306B\u5931\u6557\u3057\u307E\u3057\u305F", "error");
        }
      } catch (error) {
        showStatus(copyStatus, "\u30B3\u30D4\u30FC\u306B\u5931\u6557\u3057\u307E\u3057\u305F", "error");
      }
    }
  });
  function showError(message) {
    errorMessage.textContent = message;
    errorMessage.classList.remove("hidden");
  }
  function showStatus(element, message, type) {
    element.textContent = message;
    element.className = `status-text ${type}`;
    setTimeout(() => {
      element.textContent = "";
      element.className = "status-text";
    }, 3e3);
  }
})();
