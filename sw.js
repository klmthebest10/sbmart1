/* Service worker SBMART Changwon — mode OFFLINE + ONLINE.
   Naikkan angka VERSION setiap kali index.html diperbarui di hosting,
   supaya semua perangkat otomatis memakai versi terbaru.

   Strategi:
   - Halaman (index.html): ambil dari jaringan dulu, kalau offline pakai salinan terakhir.
   - Library dari CDN (Tailwind, Firebase SDK, font, html2canvas, jsPDF): disimpan di perangkat
     supaya aplikasi tetap bisa dibuka lengkap tanpa internet; diperbarui di belakang saat online.
   - Data Firestore TIDAK lewat cache ini (sudah disimpan sendiri oleh Firestore di perangkat).
*/
const VERSION = 'v18';   // samakan dengan APP_VERSION di index.html
const CACHE = 'sbmart-' + VERSION;
const CDN_CACHE = 'sbmart-cdn-v1';   // terpisah, tidak perlu diunduh ulang tiap ganti versi aplikasi
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
const CDN = [
  'https://cdn.tailwindcss.com',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js'
];
// Domain API (data, login) yang tidak boleh dicache.
const NO_CACHE_HOSTS = [
  'firestore.googleapis.com', 'firebase.googleapis.com', 'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com', 'www.googleapis.com', 'firebaseinstallations.googleapis.com',
  'wa.me', 'api.whatsapp.com'
];
const CDN_HOSTS = ['cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'www.gstatic.com', 'cdn.jsdelivr.net', 'unpkg.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Satu file yang tidak ada tidak boleh menggagalkan seluruh instalasi SW.
    await Promise.all(CORE.map((url) => cache.add(new Request(url, { cache: 'no-store' })).catch(() => {})));
    const cdn = await caches.open(CDN_CACHE);
    await Promise.all(CDN.map(async (url) => {
      try {
        if (await cdn.match(url)) return;
        const res = await fetch(new Request(url, { mode: 'no-cors' }));
        if (res && (res.ok || res.type === 'opaque')) await cdn.put(url, res);
      } catch (e) {}
    }));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('sbmart-') && k !== CACHE && k !== CDN_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // ---- Luar domain aplikasi ----
  if (url.origin !== self.location.origin) {
    if (NO_CACHE_HOSTS.includes(url.hostname)) return;           // data & login: langsung ke jaringan
    if (!CDN_HOSTS.includes(url.hostname) && req.destination !== 'image') return;
    // Library/font/gambar: pakai salinan di perangkat, perbarui di belakang saat online.
    event.respondWith((async () => {
      const cache = await caches.open(CDN_CACHE);
      const cached = await cache.match(req, { ignoreVary: true }) || await cache.match(req.url, { ignoreVary: true });
      const net = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
        return res;
      }).catch(() => cached);
      if (cached) { event.waitUntil(net.then(() => {}).catch(() => {})); return cached; }
      return net;
    })());
    return;
  }

  // ---- Halaman aplikasi (termasuk link nota ?receipt=...) ----
  // Online: SELALU ambil versi terbaru dari server (lewati cache HTTP browser supaya tidak dapat versi/tema lama).
  // Koneksi lambat (>4 dtk) atau offline: tampilkan salinan terakhir dari perangkat, sambil tetap
  // mengunduh versi terbaru di belakang untuk kunjungan berikutnya.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match('./index.html') || await caches.match('./index.html') || await caches.match('./');
      const network = fetch(req.url, { cache: 'no-store', credentials: 'same-origin' }).then(async (res) => {
        if (res && res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
          await cache.put('./index.html', res.clone());
        }
        return res;
      });
      if (!cached) return network.catch(() => new Response('<h3 style="font-family:sans-serif;padding:24px">Aplikasi belum tersimpan di perangkat. Buka sekali saat online.</h3>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
      const timeout = new Promise((r) => setTimeout(() => r(null), 4000));
      const res = await Promise.race([network.catch(() => null), timeout]);
      if (res && res.ok) return res;
      event.waitUntil(network.catch(() => {}));
      return cached;
    })());
    return;
  }

  // ---- File statis satu folder (ikon, manifest) ----
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
