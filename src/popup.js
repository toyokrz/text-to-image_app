// ===== DOM要素 =====
const settingsToggle = document.getElementById('settings-toggle');
const settingsPanel = document.getElementById('settings-panel');
const projectIdInput = document.getElementById('project-id');
const locationSelect = document.getElementById('location-select');
const apiKeyInput = document.getElementById('api-key');
const toggleKeyVisibility = document.getElementById('toggle-key-visibility');
const saveSettingsBtn = document.getElementById('save-settings');
const settingsStatus = document.getElementById('settings-status');
const apiKeyWarning = document.getElementById('api-key-warning');
const styleSelect = document.getElementById('style-select');
const resolutionSelect = document.getElementById('resolution-select');
const selectedTextEl = document.getElementById('selected-text');
const generateBtn = document.getElementById('generate-btn');
const loading = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const errorMessage = document.getElementById('error-message');
const result = document.getElementById('result');
const resultImage = document.getElementById('result-image');
const copyBtn = document.getElementById('copy-btn');
const copyStatus = document.getElementById('copy-status');

let currentSelectedText = '';
let currentImageData = null;
let currentMimeType = null;
let restoredStatus = null;
let pollingInterval = null;

// ===== ポーリング（generating状態中にストレージを監視） =====
function startPolling() {
  stopPolling();
  pollingInterval = setInterval(async () => {
    const { generationState } = await chrome.storage.local.get('generationState');
    if (!generationState) return;

    // 完了またはエラーならUIに反映
    if (generationState.status !== 'generating') {
      applyGenerationState(generationState);
      return;
    }

    // 生成中だが2分以上経過していたらタイムアウト
    if (generationState.startedAt && Date.now() - generationState.startedAt > 120_000) {
      const resetState = {
        status: 'error',
        text: generationState.text,
        imageData: null,
        mimeType: null,
        error: '生成がタイムアウトしました。再度お試しください。',
      };
      await chrome.storage.local.set({ generationState: resetState });
      applyGenerationState(resetState);
    }
  }, 1000);
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

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
  if (!generationState) return;

  // 'generating' 状態が2分以上続いていたらスタックとみなしてリセット
  if (generationState.status === 'generating' && generationState.startedAt) {
    const elapsed = Date.now() - generationState.startedAt;
    if (elapsed > 120_000) {
      const resetState = {
        status: 'error',
        text: generationState.text,
        imageData: null,
        mimeType: null,
        error: '生成がタイムアウトしました。再度お試しください。',
      };
      await chrome.storage.local.set({ generationState: resetState });
      restoredStatus = 'error';
      applyGenerationState(resetState);
      return;
    }
  }

  restoredStatus = generationState.status;
  applyGenerationState(generationState);
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
      loadingText.textContent = state.retryInfo || '図解を生成しています...';
      errorMessage.classList.add('hidden');
      result.classList.add('hidden');
      startPolling();
      break;

    case 'completed':
      stopPolling();
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
      stopPolling();
      loading.classList.add('hidden');
      result.classList.add('hidden');
      if (state.error) {
        showError(state.error);
      }
      updateGenerateButton();
      break;

    case 'idle':
    default:
      stopPolling();
      loading.classList.add('hidden');
      errorMessage.classList.add('hidden');
      result.classList.add('hidden');
      updateGenerateButton();
      break;
  }
}

// ===== 設定読み込み =====
async function loadSettings() {
  const settings = await chrome.storage.local.get(['apiKey', 'projectId', 'location', 'style', 'resolution']);

  if (settings.projectId) {
    projectIdInput.value = settings.projectId;
  }

  if (settings.location) {
    locationSelect.value = settings.location;
  }

  if (settings.apiKey) {
    apiKeyInput.value = settings.apiKey;
  }

  // プロジェクトIDとAPIキーの両方が設定済みなら警告を非表示
  if (settings.apiKey && settings.projectId) {
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
  // 生成中・完了状態では復元済みの状態を保護（上書きしない）
  if (restoredStatus === 'generating' || restoredStatus === 'completed') return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;

    // chrome.scripting.executeScriptで直接取得（content script不要）
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection().toString(),
    });

    const text = results?.[0]?.result;
    if (text && text.trim().length > 0) {
      currentSelectedText = text.trim();
      selectedTextEl.textContent = currentSelectedText;
      selectedTextEl.classList.remove('empty');
      updateGenerateButton();
    }
  } catch (error) {
    // chrome://等のページではエラーになる
    console.log('選択テキストの取得に失敗:', error.message);
  }
}

// ===== 生成ボタンの状態更新 =====
function updateGenerateButton() {
  const hasApiKey = apiKeyInput.value.trim().length > 0;
  const hasProjectId = projectIdInput.value.trim().length > 0;
  const hasText = currentSelectedText.length > 0;
  generateBtn.disabled = !hasApiKey || !hasProjectId || !hasText;
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

// ===== 設定保存（プロジェクトID + リージョン + APIキー） =====
saveSettingsBtn.addEventListener('click', async () => {
  const apiKey = apiKeyInput.value.trim();
  const projectId = projectIdInput.value.trim();
  const location = locationSelect.value;

  await chrome.storage.local.set({ apiKey, projectId, location });

  showStatus(settingsStatus, '保存しました', 'success');

  if (apiKey && projectId) {
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
  const projectId = projectIdInput.value.trim();
  const location = locationSelect.value;

  if (!apiKey || !projectId) {
    showError('APIキーとプロジェクトIDを設定してください。');
    return;
  }

  // UI状態を更新
  generateBtn.disabled = true;
  loading.classList.remove('hidden');
  errorMessage.classList.add('hidden');
  result.classList.add('hidden');
  currentImageData = null;
  currentMimeType = null;

  // ポーリング開始（バックグラウンドからの通知が届かない場合の保険）
  startPolling();

  // バックグラウンドにリクエストを送信（即座に返る）
  chrome.runtime.sendMessage({
    type: 'GENERATE_DIAGRAM',
    text: currentSelectedText,
    apiKey,
    projectId,
    location,
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
