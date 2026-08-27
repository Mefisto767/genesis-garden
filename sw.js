// ============================================================================
// Genesis Garden — минимальный service worker (Этап 9, PWA/надёжность).
//
// Честная оговорка по охвату: это runtime-кэш (stale-while-revalidate) для
// уже посещённых same-origin GET-запросов (HTML/JS/CSS/картинки игры), а НЕ
// полный precache всех хэшированных бандлов сборки — hash-имена файлов
// известны только на этапе сборки, а этот файл пишется вручную и деплоится
// как есть из public/. Реальный эффект: игрок, который хотя бы раз открыл
// игру, может открыть её снова офлайн/при плохой сети и увидит последнюю
// закэшированную версию, а не белый экран/ошибку сети — это и есть то, что
// нужно для установленного PWA в бете. Полный precache по сборочному
// манифесту (например, через vite-plugin-pwa) — обоснованное улучшение на
// будущее, отмечено в docs/IMPLEMENTATION_STATUS.md (Этап 9).
// ============================================================================

const CACHE_NAME = 'genesis-garden-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Только свои файлы — запросы к Supabase/шрифтам/CDN этот SW не трогает,
  // они идут напрямую в сеть с обычным поведением браузера.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      // stale-while-revalidate: если есть кэш — отдаём его сразу (быстро и
      // работает офлайн), сеть обновляет кэш в фоне для следующего раза.
      // Если кэша ещё нет — единственный вариант первого визита это сеть.
      return cached || networkFetch;
    })
  );
});
