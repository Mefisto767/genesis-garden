// ============================================================================
// Этап 9 — регистрация service worker (public/sw.js). Только в production-
// сборке (import.meta.env.PROD) — в dev-режиме SW мешал бы Vite HMR и кэшировал
// бы модули, которые ещё меняются. Регистрация сама по себе no-op в браузерах
// без поддержки Service Worker (Safari в приватном режиме и т.п.) — тихо
// пропускаем, без ошибок в консоли.
// ============================================================================

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker.register(swUrl).catch(() => {
      // Регистрация не удалась (например, страница открыта не по HTTPS) —
      // игра прекрасно работает и без PWA-офлайна, это не критично.
    });
  });
}
