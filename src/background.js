import { GoogleGenAI } from '@google/genai';

// ===== コンテキストメニュー登録 =====
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'generate-diagram',
    title: 'テキストから図解を生成',
    contexts: ['selection'],
  });
});

// ===== コンテキストメニュークリック処理 =====
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'generate-diagram') return;

  const selectedText = info.selectionText;
  if (!selectedText) return;

  try {
    const settings = await chrome.storage.local.get(['apiKey', 'style', 'resolution']);
    if (!settings.apiKey) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'エラー',
        message: 'APIキーが設定されていません。拡張機能の設定画面からAPIキーを入力してください。',
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
    handleGenerateRequest(message)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true; // 非同期レスポンスのために true を返す
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
  const { text, apiKey, style, resolution } = message;

  if (!apiKey) {
    return { error: 'APIキーが設定されていません。設定画面からAPIキーを入力してください。' };
  }

  if (!text || text.trim().length === 0) {
    return { error: 'テキストが選択されていません。Webページ上でテキストを選択してください。' };
  }

  return await generateDiagram(text, apiKey, style, resolution);
}

// ===== Gemini API呼び出し =====
async function generateDiagram(text, apiKey, style = 'シンプル', resolution = '1K') {
  const prompt = `以下のテキスト内容を、わかりやすい図解画像として生成してください。
- 日本語で記載
- 要点を構造化して視覚的に表現
- 背景は白
- テキストは読みやすいフォントサイズで正確に描画
- スタイル: ${style}

テキスト:
${text}`;

  try {
    const ai = new GoogleGenAI({ apiKey });

    // タイムアウト処理（90秒）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: [{ text: prompt }],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          imageSize: resolution,
        },
      },
    });

    clearTimeout(timeoutId);

    // レスポンスから画像データを抽出
    if (!response.candidates || response.candidates.length === 0) {
      return { error: 'APIからの応答が空でした。別のテキストで再試行してください。' };
    }

    const parts = response.candidates[0].content.parts;
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

    const message = error.message || '';

    if (message.includes('API key')) {
      return { error: 'APIキーが無効です。正しいAPIキーを設定してください。' };
    }

    if (message.includes('429') || message.includes('rate limit') || message.includes('quota')) {
      return { error: 'APIのレート制限に達しました。しばらく待ってから再試行してください。' };
    }

    if (message.includes('403') || message.includes('permission')) {
      return { error: 'APIへのアクセスが拒否されました。APIキーの権限を確認してください。' };
    }

    return { error: `API呼び出しに失敗しました: ${message}` };
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
