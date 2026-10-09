/* global __firebase_config */

// Firebase config comes from Vite env vars (.env), with the legacy injected global as a fallback.
const envConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const firebaseConfig = envConfig.apiKey
  ? envConfig
  : (typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {});

export const hasFirebaseConfig = Boolean(firebaseConfig?.apiKey && firebaseConfig?.projectId && firebaseConfig?.appId);

export const ADMIN_EMAIL = (import.meta.env.VITE_ADMIN_EMAIL || '').trim().toLowerCase();

const RECAPTCHA_SITE_KEY = import.meta.env.VITE_RECAPTCHA_SITE_KEY;

let firebaseServicesPromise;

export const getFirebaseServices = async () => {
  if (!firebaseServicesPromise) {
    firebaseServicesPromise = Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
      RECAPTCHA_SITE_KEY ? import('firebase/app-check') : null
    ]).then(([firebaseApp, firebaseAuth, firebaseFirestore, firebaseAppCheck]) => {
      const app = firebaseApp.initializeApp(firebaseConfig);

      // App Check proves requests come from this site (invisible reCAPTCHA v3), which stops scripted spam
      // once enforcement is switched on in the Firebase console.
      if (firebaseAppCheck) {
        if (import.meta.env.DEV) {
          // Prints a debug token to the console on first run; register it under App Check > Manage debug tokens.
          self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
        }
        firebaseAppCheck.initializeAppCheck(app, {
          provider: new firebaseAppCheck.ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
          isTokenAutoRefreshEnabled: true
        });
      }

      return {
        auth: firebaseAuth.getAuth(app),
        db: firebaseFirestore.getFirestore(app),
        GoogleAuthProvider: firebaseAuth.GoogleAuthProvider,
        onAuthStateChanged: firebaseAuth.onAuthStateChanged,
        signInWithPopup: firebaseAuth.signInWithPopup,
        signOut: firebaseAuth.signOut,
        collection: firebaseFirestore.collection,
        doc: firebaseFirestore.doc,
        onSnapshot: firebaseFirestore.onSnapshot,
        runTransaction: firebaseFirestore.runTransaction,
        setDoc: firebaseFirestore.setDoc,
        addDoc: firebaseFirestore.addDoc,
        deleteDoc: firebaseFirestore.deleteDoc,
        getDocs: firebaseFirestore.getDocs,
        query: firebaseFirestore.query,
        where: firebaseFirestore.where,
        writeBatch: firebaseFirestore.writeBatch,
        serverTimestamp: firebaseFirestore.serverTimestamp
      };
    });
  }

  return firebaseServicesPromise;
};
