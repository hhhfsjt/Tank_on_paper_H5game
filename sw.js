/* 纸上坦克离线缓存 · AI 辅助生成项目 */
const CACHE_NAME = 'paper-tanks-v1';
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './game.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './resource/sound/坦克履带声.mp3',
  './resource/sound/坦克炮击声.mp3',
  './resource/sound/威廉尖叫.mp3',
  './resource/sound/战场的回响_BGM.mp3',
  './resource/sound/步枪射击.mp3',
  './resource/sound/步炮行军脚步.mp3',
  './resource/sound/火炮开火.mp3',
  './resource/sound/胜利.mp3',
  './resource/sound/越野吉普车身颠簸.mp3',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  // 页面导航：网络优先，离线时回退到缓存的入口页
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  const url = new URL(request.url);
  const isMedia = /\.(png|ico|svg|mp3)$/i.test(url.pathname);

  // 图片/音频：缓存优先，同时在后台更新
  if (isMedia) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response && response.ok && url.origin === self.location.origin) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);

        return cached || network;
      })
    );
    return;
  }

  // 代码/样式：网络优先，离线时回退缓存，避免更新后仍读到旧文件
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && url.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
