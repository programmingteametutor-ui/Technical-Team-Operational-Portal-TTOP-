// TTOP Portal service worker: lets the portal install as a phone app and shows phone alerts and alarms.
// Network first: every page load gets the latest deploy; the saved copy is used only when offline.
// Never caches /api/ (live data and settings) or anything from another site (Supabase, fonts, libraries).
const CACHE = 'ttop-v2';
const SHELL = ['/', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).catch(() => {}));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(n => Promise.all(n.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== self.location.origin || u.pathname.startsWith('/api/')) return;
  const nav = r.mode === 'navigate';
  e.respondWith(fetch(r).then(res => {
    if (res.ok && !u.search) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(nav ? '/' : r, copy)).catch(() => {}) }
    return res;
  }).catch(() => caches.match(nav ? '/' : r).then(m => m || Response.error())));
});

// ---------- phone alerts and alarms ----------
// An alarm stays on screen (requireInteraction), vibrates long and has Got it / Snooze 5 min buttons. If TTOP is open,
// the page also shows a full-screen alarm that beeps until Got it.
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {} } catch (x) { d = { body: e.data ? e.data.text() : '' } }
  const opt = {
    body: d.body || '', tag: d.tag || 'ttop', renotify: true, icon: '/icons/icon-192.png', badge: '/icons/maskable-192.png',
    vibrate: d.vibrate || [120, 60, 120], requireInteraction: !!d.requireInteraction, data: { url: d.url || '/', tok: d.tok || '', alarm: !!d.alarm },
  };
  if (d.alarm && Array.isArray(d.actions)) opt.actions = d.actions.slice(0, 2);
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || 'TTOP Portal', opt),
    d.alarm ? self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(L => L.forEach(c => c.postMessage({ type: 'ttop-alarm', title: d.title || 'TTOP Portal', body: d.body || '', url: d.url || '/', tok: d.tok || '', tag: d.tag || '' }))) : null,
  ]));
});
const ackSend = (tok, action) => tok ? fetch('/api/push-alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ack: tok, action }) }).catch(() => {}) : Promise.resolve();
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const d = e.notification.data || {};
  if (e.action === 'ack' || e.action === 'snooze') {
    e.waitUntil(Promise.all([ackSend(d.tok, e.action), self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(L => L.forEach(c => c.postMessage({ type: 'ttop-alarm-done', tok: d.tok })))]));
    return;
  }
  const url = new URL(d.url || '/', self.location.origin).href;
  e.waitUntil((async () => {
    if (d.alarm) await ackSend(d.tok, 'ack');          // opening the alarm counts as Got it
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const c = list.find(x => x.url.startsWith(self.location.origin));
    if (c) { await c.focus(); c.postMessage({ type: 'ttop-open', url }); return }
    return self.clients.openWindow(url);
  })());
});
