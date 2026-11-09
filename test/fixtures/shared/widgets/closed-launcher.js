// Synthetic closed launcher: visible, chat-named, but no inspectable text (icon only via CSS).
(function () {
  var el = document.createElement('div');
  el.id = 'chat-launcher';
  el.style.cssText = 'position:fixed;right:16px;bottom:16px;width:56px;height:56px;border-radius:28px;background:#0a5;z-index:9999';
  document.body.appendChild(el);
})();
