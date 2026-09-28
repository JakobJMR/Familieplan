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

 const firebaseConfig = {
  apiKey: "AIzaSyBSuwNjV4p8nPKngcsomHiWfsufTedQsFQ",
  authDomain: "familieplan-1a857.firebaseapp.com",
  projectId: "familieplan-1a857",
  storageBucket: "familieplan-1a857.firebasestorage.app",
  messagingSenderId: "771064273147",
  appId: "1:771064273147:web:f44276feb6b9f1d476b85e"
};
