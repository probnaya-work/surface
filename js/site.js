// Small shared page chrome behaviour used across all pages.
document.addEventListener('DOMContentLoaded', () => {
  const stamp = 'PROB–' + new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  document.querySelectorAll('[data-stamp]').forEach(el => { el.textContent = stamp; });
});

// Vercel Web Analytics — anonymous pageviews. Loaded here so every page that
// already pulls in site.js is covered. Root-relative src works at any depth.
window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
(function () {
  const s = document.createElement('script');
  s.defer = true;
  s.src = '/_vercel/insights/script.js';
  document.head.appendChild(s);
})();
