// ─────────────────────────────────────────────────────────────────────────────
//  FIREBASE-OPPSETT – lim inn verdiene fra Firebase-konsollen her.
//  (Prosjektinnstillinger → Dine apper → Web-app → «SDK setup and configuration» → Config)
//
//  Disse verdiene er IKKE hemmelige – Google har laget dem for å ligge i nettsider.
//  Det som beskytter dataene er sikkerhetsreglene (firestore.rules) med e-postlista.
//
//  Så lenge apiKey er tom, kjører appen i DEMO-MODUS: data lagres bare på denne
//  enheten, og ingenting deles med resten av familien.
// ─────────────────────────────────────────────────────────────────────────────

export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};
