// OnTime PWA Service Worker for Mobile & Lock Screen Notifications

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Do not aggressively hijack windows to prevent iOS WebKit navigation crashes
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'NOTIFY_DEPARTURE') {
    const { title, body, icon } = event.data;
    self.registration.showNotification(title, {
      body: body,
      icon: icon || '/logo.png',
      badge: '/logo.png',
      vibrate: [200, 100, 200, 100, 200],
      tag: 'departure-alert',
      renotify: true,
      requireInteraction: true,
      data: { url: '/' }
    });
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      if (clientList.length > 0) {
        return clientList[0].focus();
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});
