self.addEventListener('push', function(event) {
  var data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = {};
  }

  var title = data.title || 'ShareWay';
  var body = data.body || data.message || 'Tienes una nueva notificación.';
  var url = data.url || '/notifications';

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: data.tag || 'shareway',
      data: { url: url }
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  var targetUrl = '/notifications';
  if (event.notification && event.notification.data && event.notification.data.url) {
    targetUrl = event.notification.data.url;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i += 1) {
        var client = clientList[i];
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }

      return undefined;
    })
  );
});
