// Synthetic fake chat widget injected 1.5s after load.
setTimeout(function () {
  var el = document.createElement('div');
  el.id = 'chat-widget';
  el.setAttribute('aria-label', 'Chat window');
  el.style.cssText = 'position:fixed;right:16px;bottom:16px;width:300px;height:160px;background:#fff;border:1px solid #888;padding:8px;z-index:9999';
  el.textContent = 'You are chatting with an AI assistant.';
  document.body.appendChild(el);
}, 1500);
