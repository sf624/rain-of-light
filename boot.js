// A classic script, loaded before the module (index.html, lab.html): a module
// that fails to load or throws still shows its error. It also registers the
// service worker (offline support); a failed registration is not worth showing.
// A preview of a pull request (a page in pr/<n>/, see docs/development.md)
// registers none: it would outlive the preview.
function showError(msg) {
  var el = document.getElementById('fallback');
  el.textContent = String(msg);
  el.style.whiteSpace = 'pre-wrap';
  el.style.fontSize = '13px';
  el.hidden = false;
}
addEventListener('error', function (e) { showError(e.message || e.error); });
addEventListener('unhandledrejection', function (e) { showError(e.reason); });

if ('serviceWorker' in navigator && !/\/pr\/\d+\/[^/]*$/.test(location.pathname)
  && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
}
