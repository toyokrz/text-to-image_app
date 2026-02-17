(() => {
  // src/content.js
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "GET_SELECTION") {
      const selectedText = window.getSelection().toString();
      sendResponse({ text: selectedText });
    }
    return false;
  });
})();
