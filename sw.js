/* Lovera PWA Service Worker */
const CACHE = "lovera-v6";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./cover.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const u = new URL(e.request.url);
  // 只缓存静态资源。/api/ 和 /media/ 不进缓存：那些 URL 里带着访问口令，
  // 而且离线看旧记录会让人以为"消息错乱了"。
  if (u.pathname.startsWith("/api/") || u.pathname.startsWith("/media/")) return;
  // 网络优先：尽量取最新文件（这样代码更新能立刻生效），失败再退回缓存
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      }
      return res;
    }).catch(() =>
      caches.match(e.request).then((hit) => hit || caches.match("./index.html"))
    )
  );
});
