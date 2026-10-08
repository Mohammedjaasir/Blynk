/* Blynk PWA web push (2026-10-08). Firebase Cloud Messaging looks for this
 * file at the site root. It shows order notifications while the shop at
 * /app/ is closed or in the background; a tap opens the link the server sets
 * (webpush.fcmOptions.link). The settings are the public "Blynk web" app
 * config, the same as lib/Services/push/web_push_config.dart. */
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBSK7UiiWrtclBOljgIhmS7kAd41ZLBMG4',
  authDomain: 'blynk-15cd4.firebaseapp.com',
  projectId: 'blynk-15cd4',
  storageBucket: 'blynk-15cd4.firebasestorage.app',
  messagingSenderId: '806613943275',
  appId: '1:806613943275:web:42f4e52efa0c0973760fae',
});

// Messages with a `notification` block are displayed by the SDK itself.
firebase.messaging();
