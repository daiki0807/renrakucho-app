import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyAJT9HWvbxj2sT7WDgrzzAMhe0cLxzmSfI",
    authDomain: "helpful-passage-430405-b3.firebaseapp.com",
    projectId: "helpful-passage-430405-b3",
    storageBucket: "helpful-passage-430405-b3.firebasestorage.app",
    messagingSenderId: "915619375587",
    appId: "1:915619375587:web:daacf02ecbb879ba5118d6",
    measurementId: "G-RJ36V69VTQ"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app, "renrakucho-db");
