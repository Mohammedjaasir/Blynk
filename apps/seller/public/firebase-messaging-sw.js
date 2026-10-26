/* Blynk Seller web push. Firebase Cloud Messaging looks for this file at the
 * site root. It shows the seller's notifications (product live, not approved,
 * payout sent ...) while the app is closed or in the background; a tap focuses
 * an open seller tab or opens the link the server sets (data.url, default "/").
 * Modelled on apps/customer-site/firebase-messaging-sw.js: the same public
 * "Blynk web" Firebase config and the same pinned SDK version. The settings
 * identify the project, they do not grant access to it. */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

var ICON = '/icons/icon-192.png';

// Registered before the SDK starts, so this runs first: the tap is handled
// here (the SDK would only open a fcmOptions.link) and the SDK's own handler
// never runs a second time.
self.addEventListener('notificationclick', function (event) {
  var data = (event.notification && event.notification.data) || {};
  var fcm = data.FCM_MSG || {};
  var raw =
    data.url ||
    (fcm.data && fcm.data.url) ||
    (fcm.fcmOptions && fcm.fcmOptions.link) ||
    '/';
  var target = sameOriginUrl(raw);
  event.notification.close();
  event.stopImmediatePropagation();
  event.waitUntil(focusOrOpen(target));
});

/** The link as an absolute URL on this site; anything else becomes the home page. */
function sameOriginUrl(raw) {
  try {
    var url = new URL(String(raw || '/'), self.location.origin);
    if (url.origin === self.location.origin) return url.href;
  } catch (e) {
    /* fall through */
  }
  return self.location.origin + '/';
}

function focusOrOpen(target) {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var client = list[i];
      if (client.url.indexOf(self.location.origin) !== 0) continue;
      var focused = 'focus' in client ? client.focus() : Promise.resolve(client);
      return Promise.resolve(focused).then(function (c) {
        // An open tab stays where it is for the home page; a deeper link moves it.
        if (c && 'navigate' in c && target !== self.location.origin + '/' && c.url !== target) {
          return c.navigate(target).catch(function () {});
        }
        return c;
      });
    }
    return self.clients.openWindow(target);
  });
}

// Every notification gets the Blynk icon unless the server sent its own.
(function addDefaultIcon() {
  var registration = self.registration;
  var show = registration.showNotification.bind(registration);
  registration.showNotification = function (title, options) {
    var opts = Object.assign({}, options || {});
    opts.icon = opts.icon || ICON;
    opts.badge = opts.badge || ICON;
    return show(title, opts);
  };
})();

firebase.initializeApp({
  apiKey: 'AIzaSyBSK7UiiWrtclBOljgIhmS7kAd41ZLBMG4',
  authDomain: 'blynk-15cd4.firebaseapp.com',
  projectId: 'blynk-15cd4',
  storageBucket: 'blynk-15cd4.firebasestorage.app',
  messagingSenderId: '806613943275',
  appId: '1:806613943275:web:42f4e52efa0c0973760fae',
});

var messaging = firebase.messaging();

// Messages with a `notification` block are displayed by the SDK itself. A
// data-only message (title and body in `data`) is shown here.
messaging.onBackgroundMessage(function (payload) {
  if (payload.notification) return;
  var data = payload.data || {};
  if (!data.title) return;
  return self.registration.showNotification(data.title, { body: data.body || '', data: data });
});
