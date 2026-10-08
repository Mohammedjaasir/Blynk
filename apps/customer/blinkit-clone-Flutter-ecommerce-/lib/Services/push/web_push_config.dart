import 'package:firebase_core/firebase_core.dart';

/// The Blynk web app's Firebase settings (Firebase console > Project settings
/// > Your apps > "Blynk web", 2026-10-08). These are public by design: they
/// identify the project, they do not grant access to it.
const FirebaseOptions blynkWebFirebaseOptions = FirebaseOptions(
  apiKey: 'AIzaSyBSK7UiiWrtclBOljgIhmS7kAd41ZLBMG4',
  authDomain: 'blynk-15cd4.firebaseapp.com',
  projectId: 'blynk-15cd4',
  storageBucket: 'blynk-15cd4.firebasestorage.app',
  messagingSenderId: '806613943275',
  appId: '1:806613943275:web:42f4e52efa0c0973760fae',
);

/// Cloud Messaging > Web Push certificates: the public key browsers use to
/// accept pushes from this project.
const String blynkWebPushVapidKey =
    'BH_CahMoL5q43dTHUV9XIxhGgfEyTTsd2BqYXIZ_fzdfBQeiD6gK_XEyKnKDUCUUV5VRIT_j9b_doR-j15Su_Tk';
