// Service worker: gjør appen installerbar og lar skallet åpne seg raskt.
// Bare appens egne filer caches. Data fra Firebase, Gemini, Yr osv. går alltid direkte.
// Øk VERSION når du endrer filer, så alle enheter får den nye versjonen.

const VERSION = 'v3';
const CACHE = `familie-${VERSION}`;
const SHELL = [
  './', './index.html', './css/app.css', './manifest.webmanifest', './icons/icon-192.png',
  './js/app.js', './js/config.js', './js/backend.js', './js/store.js', './js/util.js', './js/logic.js', './js/finance.js',
  './js/ai.js', './js/ai-extra.js', './js/docs.js', './js/media.js', './js/shoplists.js', './js/pin.js', './js/vendor/extras.js', './js/emoji.js', './js/components.js', './js/vendor/firebase.js',
  './js/views/assistant.js', './js/views/calendar.js', './js/views/dashboard.js', './js/views/economy.js', './js/views/editors.js',
  './js/views/food.js', './js/views/house.js', './js/views/wine.js', './js/views/products.js', './js/views/pantry.js', './js/views/gate.js', './js/views/insurance.js', './js/views/meals.js', './js/views/more.js',
  './js/views/onboarding.js', './js/views/settings.js', './js/views/shopping.js', './js/views/tasks.js', './js/views/widgets.js',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Nettverk først (så oppdateringer kommer fram med en gang), cache som reserve uten nett.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Google/Firebase/Yr hentes alltid direkte
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))),
  );
});
