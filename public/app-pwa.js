(() => {
  if (!('serviceWorker' in navigator)) return;
  if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;

  const isViteDevelopment = () => Array.from(document.scripts)
    .some((script) => script.src.includes('/@vite/client'));

  window.addEventListener('load', async () => {
    if (isViteDevelopment()) {
      const hadController = Boolean(navigator.serviceWorker.controller);
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key.startsWith('ailaoda-pwa-')).map((key) => caches.delete(key)));
      }
      if (hadController && sessionStorage.getItem('ailaoda-dev-sw-cleaned') !== '1') {
        sessionStorage.setItem('ailaoda-dev-sw-cleaned', '1');
        location.reload();
      }
      return;
    }

    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
      console.warn('[PWA] Service worker registration failed:', error);
    });
  });
})();
