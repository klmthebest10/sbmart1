// =====================================================================
// Service Worker — Aplikasi POS Warung Kelontong
// Letakkan file ini SATU FOLDER dengan index.html dan manifest.json.
// Setiap kali index.html diperbarui, naikkan CACHE_VERSION agar semua
// perangkat mengambil versi terbaru.
// =====================================================================
const CACHE_VERSION = 'warung-pos-v1';
const STATIC_CACHE = CACHE_VERSION + '-static';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';

// File inti aplikasi (app shell) yang disimpan saat install.
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

// Library dari CDN (Tailwind, font, Firebase SDK, html2canvas, jsPDF, scanner barcode)
// disimpan agar aplikasi tetap terbuka saat sinyal lemah.
const CDN_HOSTS = [
  'cdn.tailwindcss.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
  'www.gstatic.com',
  'unpkg.com'
];

// Data toko (Firestore, login Firebase) TIDAK pernah di-cache oleh service worker:
// selalu langsung ke server supaya stok, transaksi, dan hutang selalu akurat.
const NEVER_CACHE_HOSTS = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'www.googleapis.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      // Satu file gagal (mis. ikon belum diunggah) tidak menggagalkan seluruh install.
      Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => null)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Network-first: coba server dulu (selalu versi terbaru), kalau offline pakai cache.
async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (fallbackUrl) {
      const fb = await cache.match(fallbackUrl);
      if (fb) return fb;
    }
    throw err;
  }
}

// Stale-while-revalidate: tampilkan dari cache secepatnya, perbarui cache di belakang layar.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (!url.protocol.startsWith('http')) return;
  if (NEVER_CACHE_HOSTS.includes(url.hostname)) return;

  // Halaman aplikasi (buka/refresh): network-first, cadangan index.html saat offline.
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, './index.html'));
    return;
  }

  // File di domain sendiri (manifest, ikon, dll).
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Library CDN.
  if (CDN_HOSTS.includes(url.hostname)) {
    // Firebase SDK di www.gstatic.com saja; path lain di gstatic dibiarkan.
    if (url.hostname === 'www.gstatic.com' && !url.pathname.startsWith('/firebasejs/')) return;
    event.respondWith(staleWhileRevalidate(req));
  }
  // Selain itu (gambar logo/produk dari luar, dll) dibiarkan langsung ke jaringan.
});
