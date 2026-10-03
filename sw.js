/* Service worker SBMART Changwon.
   Naikkan angka VERSION setiap kali index.html diperbarui di hosting,
   supaya semua perangkat otomatis memakai versi terbaru. */
const VERSION = 'v8';
const CACHE = 'sbmart-' + VERSION;
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
  './favicon-32.png',
  './favicon-16.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Satu file yang tidak ada tidak boleh menggagalkan seluruh instalasi SW.
      Promise.all(CORE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('sbmart-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Firebase, CDN, Google Fonts, dll dibiarkan langsung ke jaringan (tidak dicache oleh SW).
  if (url.origin !== self.location.origin) return;

  // Halaman (termasuk link nota ?receipt=...): ambil dari jaringan dulu, kalau offline pakai salinan cache.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // File statis satu folder (ikon, manifest): cache dulu, sambil diperbarui di belakang.
  event.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req).then((res) => {
        if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
