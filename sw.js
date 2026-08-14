/* Service worker for 영어 4선 칠판.
   A classroom needs the board to come up even when the school wifi does not,
   so everything is precached and served from cache first. Freshness is a
   second-order concern: updates land on the next visit. */

const CACHE = 'ehw-v2';

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './fonts/Andika-Regular.woff2',
  './fonts/Andika-Bold.woff2',
  './fonts/Pretendard-Bold.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // addAll is all-or-nothing; fetch individually so one bad entry cannot
    // leave the worker permanently uninstallable.
    await Promise.all(PRECACHE.map(async url => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) await cache.put(url, res);
      } catch (e) { /* offline install — the fetch handler will fill in later */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // leave cross-origin alone

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });

    const fromNetwork = fetch(req).then(res => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);

    // stale-while-revalidate: answer instantly, refresh in the background
    if (cached) { event.waitUntil(fromNetwork); return cached; }

    const res = await fromNetwork;
    if (res) return res;

    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return new Response('오프라인이고 이 파일은 저장되어 있지 않습니다.', {
      status: 504, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  })());
});
