// ===== DOM要素 =====
const settingsToggle = document.getElementById('settings-toggle');
const settingsPanel = document.getElementById('settings-panel');
const apiKeyInput = document.getElementById('api-key');
const toggleKeyVisibility = document.getElementById('toggle-key-visibility');
const saveApiKeyBtn = document.getElementById('save-api-key');
const apiKeyStatus = document.getElementById('api-key-status');
const apiKeyWarning = document.getElementById('api-key-warning');
const styleSelect = document.getElementById('style-select');
const resolutionSelect = document.getElementById('resolution-select');
const selectedTextEl = document.getElementById('selected-text');
const generateBtn = document.getElementById('generate-btn');
const loading = document.getElementById('loading');
const errorMessage = document.getElementById('error-message');
const result = document.getElementById('result');
const resultImage = document.getElementById('result-image');
const copyBtn = document.getElementById('copy-btn');
const copyStatus = document.getElementById('copy-status');

let currentSelectedText = '';
let currentImageData = null;
let currentMimeType = null;

// ===== 初期化 =====
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await restoreGenerationState();
  await getSelectedText();
});

// ===== バックグラウンドからの状態変更通知を受け取る =====
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'GENERATION_STATE_CHANGED') {
    applyGenerationState(message.state);
  }
});

// ===== 生成状態の復元（ポップアップ起動時） =====
async function restoreGenerationState() {
  const { generationState } = await chrome.storage.local.get('generationState');
  if (generationState) {
    applyGenerationState(generationState);
  }
}

// ===== 生成状態をUIに反映 =====
function applyGenerationState(state) {
  if (!state) return;

  // テキストを復元
  if (state.text) {
    currentSelectedText = state.text;
    selectedTextEl.textContent = state.text;
    selectedTextEl.classList.remove('empty');
  }

  switch (state.status) {
    case 'generating':
      generateBtn.disabled = true;
      loading.classList.remove('hidden');
      errorMessage.classList.add('hidden');
      result.classList.add('hidden');
      break;

    case 'completed':
      loading.classList.add('hidden');
      errorMessage.classList.add('hidden');
      if (state.imageData) {
        currentImageData = state.imageData;
        currentMimeType = state.mimeType;
        resultImage.src = `data:${state.mimeType};base64,${state.imageData}`;
        result.classList.remove('hidden');
      }
      updateGenerateButton();
      break;

    case 'error':
      loading.classList.add('hidden');
      result.classList.add('hidden');
      if (state.error) {
        showError(state.error);
      }
      updateGenerateButton();
      break;

    case 'idle':
    default:
      loading.classList.add('hidden');
      errorMessage.classList.add('hidden');
      result.classList.add('hidden');
      updateGenerateButton();
      break;
  }
}

// ===== 設定読み込み =====
async function loadSettings() {
  const settings = await chrome.storage.local.get(['apiKey', 'style', 'resolution']);

  if (settings.apiKey) {
    apiKeyInput.value = settings.apiKey;
    apiKeyWarning.classList.add('hidden');
  } else {
    apiKeyWarning.classList.remove('hidden');
  }

  if (settings.style) {
    styleSelect.value = settings.style;
  }

  if (settings.resolution) {
    resolutionSelect.value = settings.resolution;
  }
}

// ===== 選択テキスト取得 =====
async function getSelectedText() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_SELECTION' });
    if (response && response.text && response.text.trim().length > 0) {
      currentSelectedText = response.text.trim();
      selectedTextEl.textContent = currentSelectedText;
      selectedTextEl.classList.remove('empty');
      updateGenerateButton();
    }
  } catch (error) {
    // content scriptが読み込まれていないページ（chrome://等）ではエラーになる
    console.log('選択テキストの取得に失敗:', error.message);
  }
}

// ===== 生成ボタンの状態更新 =====
function updateGenerateButton() {
  const hasApiKey = apiKeyInput.value.trim().length > 0;
  const hasText = currentSelectedText.length > 0;
  generateBtn.disabled = !hasApiKey || !hasText;
}

// ===== 設定パネル表示切替 =====
settingsToggle.addEventListener('click', () => {
  settingsPanel.classList.toggle('hidden');
});

// ===== APIキー表示/非表示 =====
toggleKeyVisibility.addEventListener('click', () => {
  const isPassword = apiKeyInput.type === 'password';
  apiKeyInput.type = isPassword ? 'text' : 'password';
});

// ===== APIキー保存 =====
saveApiKeyBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();
  await chrome.storage.local.set({ apiKey });

  showStatus(apiKeyStatus, '保存しました', 'success');

  if (apiKey) {
    apiKeyWarning.classList.add('hidden');
  } else {
    apiKeyWarning.classList.remove('hidden');
  }
  updateGenerateButton();
});

// ===== スタイル変更保存 =====
styleSelect.addEventListener('change', async () => {
  await chrome.storage.local.set({ style: styleSelect.value });
});

// ===== 解像度変更保存 =====
resolutionSelect.addEventListener('change', async () => {
  await chrome.storage.local.set({ resolution: resolutionSelect.value });
});

// ===== 図解生成 =====
generateBtn.addEventListener('click', async () => {
  if (!currentSelectedText) {
    showError('テキストが選択されていません。');
    return;
  }

  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    showError('APIキーが設定されていません。設定画面からAPIキーを入力してください。');
    return;
  }

  // UI状態を更新
  generateBtn.disabled = true;
  loading.classList.remove('hidden');
  errorMessage.classList.add('hidden');
  result.classList.add('hidden');
  currentImageData = null;
  currentMimeType = null;

  // バックグラウンドにリクエストを送信（即座に返る）
  chrome.runtime.sendMessage({
    type: 'GENERATE_DIAGRAM',
    text: currentSelectedText,
    apiKey,
    style: styleSelect.value,
    resolution: resolutionSelect.value,
  });
});

// ===== 画像コピー =====
copyBtn.addEventListener('click', async () => {
  if (!currentImageData || !currentMimeType) return;

  try {
    // まずポップアップ内のClipboard APIを試す
    const byteCharacters = atob(currentImageData);
    const byteArray = new Uint8Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteArray[i] = byteCharacters.charCodeAt(i);
    }
    const blob = new Blob([byteArray], { type: 'image/png' });

    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob }),
    ]);

    showStatus(copyStatus, 'コピーしました！', 'success');
  } catch (clipboardError) {
    // Clipboard APIが使えない場合はbackground経由でoffscreenを使う
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'COPY_IMAGE',
        imageData: currentImageData,
        mimeType: currentMimeType,
      });

      if (response.success) {
        showStatus(copyStatus, 'コピーしました！', 'success');
      } else {
        showStatus(copyStatus, 'コピーに失敗しました', 'error');
      }
    } catch (error) {
      showStatus(copyStatus, 'コピーに失敗しました', 'error');
    }
  }
});

// ===== ユーティリティ =====
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.remove('hidden');
}

function showStatus(element, message, type) {
  element.textContent = message;
  element.className = `status-text ${type}`;
  setTimeout(() => {
    element.textContent = '';
    element.className = 'status-text';
  }, 3000);
}
