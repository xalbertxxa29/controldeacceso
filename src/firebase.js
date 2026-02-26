// Configuración de Firebase
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

const firebaseConfig = {
  apiKey: "AIzaSyDNOcajbbsbf8ZinJpXG5P3nG5uFYiGa7A",
  authDomain: "checklist-vehicular-3cf6a.firebaseapp.com",
  projectId: "checklist-vehicular-3cf6a",
  storageBucket: "checklist-vehicular-3cf6a.firebasestorage.app",
  messagingSenderId: "307282990183",
  appId: "1:307282990183:web:c6b46b2328b7d2f90970c2",
  measurementId: "G-YEQ3LJ0MG1"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);
export { httpsCallable };

// Configuración de Cloud Functions Region y Project
export const firebaseProjectId = "checklist-vehicular-3cf6a";
export const firebaseRegion = "us-central1";
