// Synthetic widget carrying hostile strings in text, id-adjacent attributes and class.
(function () {
  var el = document.createElement('div');
  el.id = 'chat-widget';
  el.className = 'chat-"><img src=x onerror=alert(1)>';
  el.setAttribute('aria-label', 'Chat <script>alert(1)</script> window');
  el.style.cssText = 'position:fixed;right:16px;bottom:16px;width:360px;height:200px;background:#fff;border:1px solid #888;padding:8px;z-index:9999';
  el.textContent = 'You are chatting with an AI assistant <script>alert(1)</script> "><img src=x onerror=alert(1)> javascript:alert(1)';
  document.body.appendChild(el);
})();
