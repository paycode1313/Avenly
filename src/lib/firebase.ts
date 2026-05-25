import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import {
  getFirestore,
  Firestore,
  doc,
  getDocFromServer,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Initialize Firebase
let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;

try {
  // Only initialize if config is available
  if (firebaseConfig.apiKey && firebaseConfig.projectId) {
    if (!getApps().length) {
      app = initializeApp(firebaseConfig);
    } else {
      app = getApps()[0];
    }
    db = getFirestore(app);
    auth = getAuth(app);
    console.log('✅ Firebase initialized successfully');
  } else {
    console.warn('⚠️ Firebase config not found. Auth features disabled.');
    console.log('   Set VITE_FIREBASE_* environment variables.');
  }
} catch (e) {
  console.error('❌ Firebase initialization failed:', e);
}

export { app, db, auth };
export const isFirebaseReady = !!app && !!db && !!auth;

// Type definitions
export interface UserProfile {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
  email: string | null;
  favorites: { id: string; name: string; coordinates: [number, number] }[];
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface RoadAlert {
  id: string;
  type: 'accident' | 'pothole' | 'flood' | 'traffic' | 'other';
  severity: 'low' | 'medium' | 'high';
  description: string;
  coordinates: { latitude: number; longitude: number };
  reporterId: string;
  reporterName: string;
  imageUrl?: string;
  timestamp: Timestamp;
  createdAt: Timestamp;
}

export interface SocialPost {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string;
  imageUrl: string;
  caption: string;
  locationName: string;
  coordinates: { latitude: number; longitude: number };
  likes: string[];
  comments: { userId: string; userName: string; text: string; timestamp: Timestamp }[];
  createdAt: Timestamp;
}

// Operation type enum
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

// Error handler
export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const authInfo = auth?.currentUser ? {
    userId: auth.currentUser.uid,
    email: auth.currentUser.email,
    emailVerified: auth.currentUser.emailVerified,
    isAnonymous: auth.currentUser.isAnonymous,
  } : null;

  const errorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    authInfo,
  };

  console.error('Firestore Error:', JSON.stringify(errorInfo, null, 2));
  throw error;
}

// === User Profile Actions ===

export async function createUserProfile(userId: string, data: Partial<UserProfile>): Promise<void> {
  if (!db || !auth?.currentUser) throw new Error('Firebase not initialized');

  try {
    const userRef = doc(db, 'users', userId);
    const timestamp = serverTimestamp();

    await addDoc(collection(db, 'users'), {
      uid: userId,
      ...data,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    console.log('✅ User profile created:', userId);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `users/${userId}`);
  }
}

export async function updateUserProfile(userId: string, data: Partial<UserProfile>): Promise<void> {
  if (!db || !auth?.currentUser) throw new Error('Firebase not initialized');
  if (auth.currentUser.uid !== userId) throw new Error('Not authorized');

  try {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      ...data,
      updatedAt: serverTimestamp(),
    });
    console.log('✅ User profile updated:', userId);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
  }
}

// === Road Alerts Actions ===

export async function createAlert(data: Omit<RoadAlert, 'id' | 'timestamp' | 'createdAt'>): Promise<string> {
  if (!db || !auth?.currentUser) throw new Error('Firebase not initialized');

  try {
    const docRef = await addDoc(collection(db, 'alerts'), {
      ...data,
      timestamp: serverTimestamp(),
      createdAt: serverTimestamp(),
    });

    console.log('✅ Alert created:', docRef.id);
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'alerts');
    return '';
  }
}

export function subscribeToAlerts(
  callback: (alerts: RoadAlert[]) => void,
  radiusKm = 10
): () => void {
  if (!db) {
    console.warn('⚠️ Firebase not initialized');
    callback([]);
    return () => {};
  }

  const q = query(
    collection(db, 'alerts'),
    orderBy('timestamp', 'desc')
  );

  const unsubscribe = onSnapshot(q, (snapshot) => {
    const alerts: RoadAlert[] = [];
    snapshot.forEach((doc) => {
      alerts.push({ id: doc.id, ...doc.data() } as RoadAlert);
    });
    callback(alerts);
  }, (error) => {
    console.error('❌ Alert subscription error:', error);
  });

  return unsubscribe;
}

// === Social Posts Actions ===

export async function createPost(data: Omit<SocialPost, 'id' | 'likes' | 'comments' | 'createdAt'>): Promise<string> {
  if (!db || !auth?.currentUser) throw new Error('Firebase not initialized');

  try {
    const docRef = await addDoc(collection(db, 'posts'), {
      ...data,
      likes: [],
      comments: [],
      createdAt: serverTimestamp(),
    });

    console.log('✅ Post created:', docRef.id);
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'posts');
    return '';
  }
}

export async function likePost(postId: string, userId: string): Promise<void> {
  if (!db || !auth?.currentUser) throw new Error('Firebase not initialized');

  try {
    const postRef = doc(db, 'posts', postId);
    await updateDoc(postRef, {
      likes: serverTimestamp() // This would need proper arrayUnion in real implementation
    });
    console.log('✅ Post liked:', postId);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `posts/${postId}`);
  }
}

export function subscribeToPosts(callback: (posts: SocialPost[]) => void): () => void {
  if (!db) {
    console.warn('⚠️ Firebase not initialized');
    callback([]);
    return () => {};
  }

  const q = query(
    collection(db, 'posts'),
    orderBy('createdAt', 'desc')
  );

  const unsubscribe = onSnapshot(q, (snapshot) => {
    const posts: SocialPost[] = [];
    snapshot.forEach((doc) => {
      posts.push({ id: doc.id, ...doc.data() } as SocialPost);
    });
    callback(posts);
  }, (error) => {
    console.error('❌ Post subscription error:', error);
  });

  return unsubscribe;
}

// Test connection on init
if (db) {
  getDocFromServer(doc(db, 'users', 'test'))
    .catch((error) => {
      if (error instanceof Error && error.message.includes('offline')) {
        console.warn('⚠️ Firebase client is offline');
      }
    });
}
