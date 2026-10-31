// Firebase settings for MileageMate.
//
// Paste the values from Firebase console → Project settings → General →
// Your apps → Web app → SDK setup and configuration ("Config").
//
// These values are NOT secrets. Every Firebase website ships them to the
// browser. Your data is protected by Firebase Authentication and the
// Firestore security rules in firestore.rules, not by hiding this file.
// Never put a service-account key, private key or AI provider key here.
//
// While apiKey is empty, the site keeps working in "this device only" mode.

export const firebaseConfig = {
  apiKey: 'AIzaSyDp5BPMZPXqFDS5pHfOddmiNMBZf1p_y0U',
  authDomain: 'mileagemate-1311.firebaseapp.com',
  projectId: 'mileagemate-1311',
  appId: '1:329782184626:web:74ef5970ff1f5c9e2ed7ab',
};

export const authOptions = {
  google: true,
  // Phone (SMS OTP) sign-in needs the Firebase Blaze plan with billing, and each
  // SMS is charged. Turn this on only after the setup steps in README.md.
  phone: false,
  phoneCountryCode: '+91',
};

// For local testing with the Firebase emulators only. Leave as null.
export const emulators = null; // e.g. { auth: 'http://127.0.0.1:9099', firestore: { host: '127.0.0.1', port: 8080 } }
