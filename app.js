// sanity check: minimal script
window.addEventListener('DOMContentLoaded', function () {
  const el = document.getElementById('status');
  if (el) el.textContent = 'JS loaded (sanity check)';
  console.log('app.js ok');
});
