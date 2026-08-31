// Small shared page chrome behaviour used across all pages.
document.addEventListener('DOMContentLoaded', () => {
  const stamp = 'PROB–' + new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  document.querySelectorAll('[data-stamp]').forEach(el => { el.textContent = stamp; });
});
