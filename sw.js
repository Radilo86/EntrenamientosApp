// Service worker de Tracker Premium: permite abrir la app y ver gráficas sin conexión.
// Cambia CACHE al publicar una versión nueva para que los móviles descarguen los archivos actualizados.
const CACHE = 'tracker-premium-v8';
const APP_FILES = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const CDN_FILES = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

// Las librerías se piden con CORS para poder comprobar que la respuesta es correcta
// y no guardar nunca en caché un error (por ejemplo, una wifi que bloquea la descarga).
async function fetchAndCacheCdn(cache, url) {
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (res.ok) await cache.put(url, res.clone());
  return res;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_FILES);
    await Promise.all(CDN_FILES.map(url => fetchAndCacheCdn(cache, url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    // Limpia respuestas opacas o erróneas que pudiera haber guardado una versión anterior
    const cache = await caches.open(CACHE);
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      if (!res || !res.ok) await cache.delete(req);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Páginas: primero red (para recibir actualizaciones) y, si falla, la copia guardada
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh.ok) {
          const cache = await caches.open(CACHE);
          await cache.put('./index.html', fresh.clone());
        }
        return fresh;
      } catch (e) {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Librerías externas: caché primero; si no están, se descargan y se guardan solo si son válidas
  if (CDN_FILES.includes(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(url.href);
      if (cached) return cached;
      try { return await fetchAndCacheCdn(cache, url.href); }
      catch (e) { return Response.error(); }
    })());
    return;
  }

  // Archivos propios (iconos, manifiesto): caché primero y, si no, red
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(req, res.clone());
      }
      return res;
    })());
  }
});

// Al tocar un aviso (fin del descanso o del intervalo) se vuelve a la app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow('./');
  })());
});
