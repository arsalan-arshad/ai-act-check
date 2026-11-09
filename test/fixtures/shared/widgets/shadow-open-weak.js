// Open shadow root widget with generic (weaker) names: host #assistant-host, panel .chat-panel.
(function () {
  var host = document.createElement('div');
  host.id = 'assistant-host';
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;width:300px;height:160px;z-index:9999';
  var root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>.panel{background:#fff;border:1px solid #888;padding:8px;font:14px sans-serif;height:140px}</style>' +
    '<div class="chat-panel panel">You are chatting with an AI assistant.</div>';
  document.body.appendChild(host);
})();
