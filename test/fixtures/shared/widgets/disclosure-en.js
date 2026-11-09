// Synthetic fake chat widget (test fixture, no vendor code).
(function () {
  var el = document.createElement('div');
  el.id = 'chat-widget';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Chat window');
  el.style.cssText = 'position:fixed;right:16px;bottom:16px;width:300px;height:160px;background:#fff;border:1px solid #888;padding:8px;z-index:9999;font:14px sans-serif';
  el.textContent = "You are chatting with an AI assistant. Replies may be inaccurate.";
  document.body.appendChild(el);
})();
