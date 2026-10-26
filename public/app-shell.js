window.addEventListener('load', () => {
  // Compatibility for older cached entry bundles. Never hide bootstrap when
  // the main application failed to mount; current React owns normal removal.
  if (!document.getElementById('root')?.hasChildNodes()) return;
  setTimeout(() => {
    const loading = document.getElementById('loading');
    if (loading) {
      loading.classList.add('hidden');
      setTimeout(() => loading.remove(), 300);
    }
  }, 500);
});
