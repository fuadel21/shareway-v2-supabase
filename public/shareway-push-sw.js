self.addEventListener('push', function(event) {
  var data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = {};
  }

  var title = data.title || 'ShareWay';
  var body = data.body || data.message || 'Tienes una nueva notificación.';

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: data.tag || 'shareway'
    })
  );
});
