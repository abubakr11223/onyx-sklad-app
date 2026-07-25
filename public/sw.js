// §7/§8 — минимальный БЕЗОПАСНЫЙ service worker. Не «брикает» приложение:
//  • навигации → network-first (всегда свежий HTML онлайн), офлайн → /offline.html
//  • /_next/static/* → cache-first (иммутабельные хешированные ассеты)
//  • /api, POST и всё остальное → НЕ трогаем (обычная сеть)
// Версия кэша меняется при апдейте → старый кэш чистится. skipWaiting+claim —
// апдейт применяется сразу.
const VERSION = "onyx-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((c) => c.add(OFFLINE_URL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // мутации/POST — только сеть

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // сторонние — не трогаем

  // Навигации: network-first, офлайн → офлайн-страница.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_URL)),
    );
    return;
  }

  // Иммутабельные статические ассеты Next: cache-first (безопасно — хеш в имени).
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
    return;
  }
  // Остальное — обычная сеть (не вмешиваемся).
});
