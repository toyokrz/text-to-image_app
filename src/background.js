// ===== コンテキストメニュー登録 =====
chrome.runtime.onInstalled.addListener(() => {
  // 初期化時に生成状態をリセット
  chrome.storage.local.set({
    generationState: {
      status: 'idle',
      text: null,
      imageData: null,
      mimeType: null,
      error: null,
    },
  });

  chrome.contextMenus.create({
    id: 'generate-diagram',
    title: 'テキストから図解を生成',
    contexts: ['selection'],
  });
});

// ===== 生成状態を更新してポップアップに通知 =====
async function updateGenerationState(state) {
  try {
    await chrome.storage.local.set({ generationState: state });
  } catch (storageError) {
    // ストレージ書き込み失敗時（容量超過等）は画像データなしでエラー状態を保存
    if (state.imageData) {
      await chrome.storage.local.set({
        generationState: {
          ...state,
          status: 'error',
          imageData: null,
          mimeType: null,
          error: 'ストレージへの保存に失敗しました。再度お試しください。',
        },
      });
    }
  }
  // ポップアップが開いていれば通知（awaitしてunhandled rejectionを防ぐ）
  try {
    await chrome.runtime.sendMessage({ type: 'GENERATION_STATE_CHANGED', state });
  } catch {
    // ポップアップが閉じていればエラーになるが無視
  }
}

// ===== コンテキストメニュークリック処理 =====
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'generate-diagram') return;

  const selectedText = info.selectionText;
  if (!selectedText) return;

  try {
    const settings = await chrome.storage.local.get(['apiKey', 'projectId', 'location', 'style', 'resolution']);
    if (!settings.apiKey || !settings.projectId) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'エラー',
        message: 'APIキーまたはプロジェクトIDが設定されていません。拡張機能の設定画面から入力してください。',
      });
      return;
    }

    // 生成開始通知
    chrome.notifications.create('generating', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '図解生成中...',
      message: 'テキストから図解画像を生成しています。しばらくお待ちください。',
    });

    const result = await generateDiagram(
      selectedText,
      settings.apiKey,
      settings.projectId,
      settings.location || 'us-central1',
      settings.style || 'シンプル',
      settings.resolution || '1K'
    );

    // 生成中通知をクリア
    chrome.notifications.clear('generating');

    if (result.error) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'エラー',
        message: result.error,
      });
      return;
    }

    // offscreen document経由でクリップボードにコピー
    await copyImageToClipboard(result.imageData, result.mimeType);

    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '完了',
      message: '図解画像をコピーしました',
    });
  } catch (error) {
    chrome.notifications.clear('generating');
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'エラー',
      message: `図解の生成に失敗しました: ${error.message}`,
    });
  }
});

// ===== メッセージハンドラ（ポップアップからのリクエスト） =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GENERATE_DIAGRAM') {
    // 即座にレスポンスを返し、生成はバックグラウンドで実行
    handleGenerateRequest(message);
    sendResponse({ accepted: true });
    return false;
  }

  if (message.type === 'CLEAR_GENERATION') {
    updateGenerationState({
      status: 'idle',
      text: null,
      imageData: null,
      mimeType: null,
      error: null,
    });
    sendResponse({ success: true });
    return false;
  }

  if (message.type === 'COPY_IMAGE') {
    copyImageToClipboard(message.imageData, message.mimeType)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

// ===== 図解生成リクエスト処理 =====
async function handleGenerateRequest(message) {
  const { text, apiKey, projectId, location, style, resolution } = message;

  if (!apiKey || !projectId) {
    await updateGenerationState({
      status: 'error',
      text,
      imageData: null,
      mimeType: null,
      error: 'APIキーまたはプロジェクトIDが設定されていません。設定画面から入力してください。',
    });
    return;
  }

  if (!text || text.trim().length === 0) {
    await updateGenerationState({
      status: 'error',
      text,
      imageData: null,
      mimeType: null,
      error: 'テキストが選択されていません。Webページ上でテキストを選択してください。',
    });
    return;
  }

  const MAX_RETRIES = 3;

  try {
    // 生成中状態に更新（タイムスタンプ付き）
    await updateGenerationState({
      status: 'generating',
      text,
      imageData: null,
      mimeType: null,
      error: null,
      startedAt: Date.now(),
      retryInfo: null,
    });

    let result;
    let attempt = 0;

    while (attempt <= MAX_RETRIES) {
      result = await generateDiagram(text, apiKey, projectId, location || 'us-central1', style, resolution);

      // レート制限以外 or リトライ上限到達 → ループ終了
      if (!result.rateLimited || attempt >= MAX_RETRIES) break;

      attempt++;
      const waitSec = 10 * Math.pow(2, attempt - 1); // 10s, 20s, 40s

      // リトライ中であることをUIに通知
      await updateGenerationState({
        status: 'generating',
        text,
        imageData: null,
        mimeType: null,
        error: null,
        startedAt: Date.now(),
        retryInfo: `レート制限のため ${waitSec}秒後に再試行します（${attempt}/${MAX_RETRIES}）...`,
      });

      await new Promise(r => setTimeout(r, waitSec * 1000));
    }

    if (result.error) {
      await updateGenerationState({
        status: 'error',
        text,
        imageData: null,
        mimeType: null,
        error: result.error,
      });
    } else {
      await updateGenerationState({
        status: 'completed',
        text,
        imageData: result.imageData,
        mimeType: result.mimeType,
        error: null,
      });
    }
  } catch (error) {
    // 予期しないエラーでも必ず状態を更新（stuck防止）
    try {
      await updateGenerationState({
        status: 'error',
        text,
        imageData: null,
        mimeType: null,
        error: `予期しないエラーが発生しました: ${error.message}`,
      });
    } catch {
      // 最終手段：状態更新すら失敗した場合
    }
  }
}

// ===== Vertex AI REST API呼び出し =====
async function generateDiagram(text, apiKey, projectId, location, style = 'シンプル', resolution = '1K') {
  const prompt = `以下のテキスト内容を、わかりやすい図解画像として生成してください。
- 日本語で記載
- 要点を構造化して視覚的に表現
- 背景は白
- テキストは読みやすいフォントサイズで正確に描画
- スタイル: ${style}

テキスト:
${text}`;

  const model = 'gemini-2.0-flash-exp';
  const endpoint = `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
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
        return { error: `レート制限: ${errorMsg}`, rateLimited: true };
      }
      if (response.status === 401 || response.status === 403) {
        return { error: `認証エラー: ${errorMsg}\n\nAPIキーとプロジェクトIDを確認してください。Vertex AI APIが有効になっているか確認してください。` };
      }
      return { error: `API エラー (${response.status}): ${errorMsg}` };
    }

    const data = await response.json();

    // レスポンスから画像データを抽出
    if (!data.candidates || data.candidates.length === 0) {
      return { error: 'APIからの応答が空でした。別のテキストで再試行してください。' };
    }

    const parts = data.candidates[0].content.parts;
    let imageData = null;
    let mimeType = null;
    let textResponse = '';

    for (const part of parts) {
      if (part.thought) continue; // 思考プロセス部分はスキップ
      if (part.inlineData) {
        imageData = part.inlineData.data;
        mimeType = part.inlineData.mimeType;
      } else if (part.text) {
        textResponse += part.text;
      }
    }

    if (!imageData) {
      return { error: '画像の生成に失敗しました。テキストを変更して再試行してください。' };
    }

    return { imageData, mimeType, textResponse };
  } catch (error) {
    if (error.name === 'AbortError') {
      return { error: '生成がタイムアウトしました（90秒）。テキストを短くして再試行してください。' };
    }

    const msg = error.message || '';

    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota')) {
      return { error: `レート制限: ${msg}`, rateLimited: true };
    }

    return { error: `API エラー: ${msg}` };
  }
}

// ===== offscreen document経由でクリップボードにコピー =====
let creatingOffscreen = null;

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });

  if (existingContexts.length > 0) return;

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['CLIPBOARD'],
    justification: '図解画像をクリップボードにコピーするため',
  });

  await creatingOffscreen;
  creatingOffscreen = null;
}

async function copyImageToClipboard(imageData, mimeType) {
  await ensureOffscreenDocument();

  return new Promise((resolve, reject) => {
    const listener = (message) => {
      if (message.type === 'CLIPBOARD_RESULT') {
        chrome.runtime.onMessage.removeListener(listener);
        if (message.success) {
          resolve();
        } else {
          reject(new Error(message.error || 'クリップボードへのコピーに失敗しました'));
        }
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    chrome.runtime.sendMessage({
      type: 'COPY_TO_CLIPBOARD',
      target: 'offscreen',
      imageData,
      mimeType,
    });

    // タイムアウト（5秒）
    setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error('クリップボードコピーがタイムアウトしました'));
    }, 5000);
  });
}
