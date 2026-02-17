// ===== offscreen document: クリップボードコピー処理 =====
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'COPY_TO_CLIPBOARD' && message.target === 'offscreen') {
    handleClipboardCopy(message.imageData, message.mimeType);
  }
});

async function handleClipboardCopy(imageData, mimeType) {
  try {
    // base64 → Uint8Array → Blob
    const byteCharacters = atob(imageData);
    const byteArray = new Uint8Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteArray[i] = byteCharacters.charCodeAt(i);
    }

    // Clipboard APIはPNG形式のみサポート
    const blob = new Blob([byteArray], { type: 'image/png' });

    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob }),
    ]);

    chrome.runtime.sendMessage({
      type: 'CLIPBOARD_RESULT',
      success: true,
    });
  } catch (error) {
    chrome.runtime.sendMessage({
      type: 'CLIPBOARD_RESULT',
      success: false,
      error: error.message,
    });
  }
}
