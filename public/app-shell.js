window.addEventListener('load', () => {
  setTimeout(() => {
    const loading = document.getElementById('loading');
    if (loading) {
      loading.classList.add('hidden');
      setTimeout(() => loading.remove(), 300);
    }
  }, 500);
});
