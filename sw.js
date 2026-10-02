/* =========================================================
   Service Worker – Warung (POS)
   Letakkan satu folder dengan index.html & manifest.json.
   Setiap kali index.html diperbarui, NAIKKAN angka VERSION
   agar semua perangkat otomatis memakai versi terbaru.
   ========================================================= */
const VERSION = 'v1.0.0';
const APP_CACHE = 'warung-app-' + VERSION;      // file aplikasi sendiri
const CDN_CACHE = 'warung-cdn-' + VERSION;      // Tailwind, font, Firebase SDK, dll.
const CDN_MAX_ITEMS = 60;

// File inti aplikasi (dipasang saat install -> aplikasi bisa dibuka offline)
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './favicon.ico',
  './favicon-16.png',
  './favicon-32.png',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png'
];

// Pustaka dari CDN yang dipakai index.html (disimpan agar tampilan tetap jalan saat offline)
const CDN_HOSTS = [
  'cdn.tailwindcss.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
  'www.gstatic.com',   // Firebase SDK (file .js saja)
  'unpkg.com'          // pustaka scan barcode
];

// Layanan data/login Firebase: JANGAN pernah di-cache (data harus selalu asli dari server;
// mode offline data sudah ditangani Firestore persistence di index.html).
const NEVER_CACHE = /(firestore|identitytoolkit|securetoken|firebaseinstallations|firebaselogging|googleapis\.com\/(v1|google\.firestore)|google-analytics|googletagmanager|wa\.me|api\.whatsapp)/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      // Satu file gagal tidak boleh menggagalkan seluruh instalasi
      .then((cache) => Promise.all(APP_SHELL.map((url) =>
        cache.add(new Request(url, { cache: 'reload' })).catch((err) => console.warn('[SW] Lewati', url, err))
      )))
  );
  // Tidak langsung skipWaiting: halaman yang mengirim pesan SKIP_WAITING (lihat index.html)
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('warung-') && k !== APP_CACHE && k !== CDN_CACHE)
      .map((k) => caches.delete(k)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) {}
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

// Halaman (navigasi): ambil dari internet dulu (selalu versi terbaru), kalau offline pakai salinan.
async function handleNavigation(event) {
  const cache = await caches.open(APP_CACHE);
  try {
    const preload = await event.preloadResponse;
    const res = preload || await fetch(event.request);
    // Hanya simpan halaman utama tanpa parameter (link nota ?receipt=... tidak disimpan)
    const url = new URL(event.request.url);
    if (res && res.ok && !url.search) cache.put('./index.html', res.clone());
    return res;
  } catch (err) {
    return (await cache.match('./index.html')) ||
           (await cache.match('./')) ||
           new Response('<h1 style="font-family:sans-serif">Sedang offline</h1><p>Periksa koneksi internet lalu muat ulang.</p>',
             { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

// File statis milik aplikasi: pakai cache, sambil perbarui di belakang layar.
async function staleWhileRevalidate(request, cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request).then((res) => {
    // Respons "opaque" (status 0) dari CDN tanpa CORS tetap boleh disimpan
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(request, res.clone()).then(() => maxItems && trimCache(cacheName, maxItems));
    }
    return res;
  }).catch(() => null);
  return cached || (await network) || new Response('', { status: 504 });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol)) return;
  if (NEVER_CACHE.test(url.href)) return;

  if (req.mode === 'navigate') {
    event.respondWith(handleNavigation(event));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, APP_CACHE));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) {
    // Dari www.gstatic.com hanya file SDK Firebase (.js) yang di-cache
    if (url.hostname === 'www.gstatic.com' && !/\/firebasejs\/.+\.js$/.test(url.pathname)) return;
    event.respondWith(staleWhileRevalidate(req, CDN_CACHE, CDN_MAX_ITEMS));
  }
  // Selain itu (gambar luar, dll.) dibiarkan lewat jaringan biasa.
});
