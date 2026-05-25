# 🔥 Firebase Setup Guide untuk Avenly

## Langkah 1: Buat Firebase Project

1. Buka [Firebase Console](https://console.firebase.google.com)
2. Click **"Add project"**
3. Project name: `avenly-app` (atau nama lain)
4. **Disable** Google Analytics (untuk demo tidak perlu)
5. Click **"Create project"**

---

## Langkah 2: Enable Services

### 2.1 Authentication
1. Di sidebar, click **"Authentication"** → **"Get Started"**
2. Tab **"Sign-in method"**
3. Enable **"Email/Password"**
4. Click **"Save"**

### 2.2 Firestore Database
1. Di sidebar, click **"Build"** → **"Firestore Database"** → **"Create database"**
2. Pilih lokasi: **"Singapore (southasia1)"** (terdekat dengan Indonesia)
3. Start in **"Test mode"** (untuk setup awal)
4. Kita akan deploy rules production nanti

### 2.3 Storage (Optional - untuk upload gambar)
1. Di sidebar, click **"Build"** → **"Storage"** → **"Get Started"**
2. Pilih lokasi: **"Singapore"**
3. Start in **"Test mode"**

---

## Langkah 3: Get Configuration

1. Di sidebar, click **Project settings** (gear icon)
2. Scroll ke **"Your apps"** → click **"</>"** (web icon)
3. App nickname: `avenly-web`
4. **Copy the config object** - akan kayak gini:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  authDomain: "avenly-app.firebaseapp.com",
  projectId: "avenly-app",
  storageBucket: "avenly-app.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

---

## Langkah 4: Update `.env.local`

Update file `.env.local` dengan config dari Firebase:

```bash
# Firebase Config
VITE_FIREBASE_API_KEY=AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_FIREBASE_AUTH_DOMAIN=avenly-app.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=avenly-app
VITE_FIREBASE_STORAGE_BUCKET=avenly-app.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abcdef
```

---

## Langkah 5: Update Firebase Config File

Edit `src/lib/firebase.ts` dan ganti dengan environment variables:

```typescript
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
```

---

## Langkah 6: Deploy Firestore Rules

Di Firebase Console → **Firestore Database** → **Rules** tab:

Copy paste rules dari `firestore.rules` file ini:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Default deny - secure by default
    allow read: if false;
    allow write: if false;

    // Helper functions
    function isSignedIn() {
      return request.auth != null;
    }

    function isOwner(userId) {
      return request.auth.uid == userId;
    }

    // Users collection - owner only access
    match /users/{userId} {
      allow read: if isOwner(userId);
      allow create: if isSignedIn() && isOwner(userId)
                    && request.resource.data.uid == request.auth.uid
                    && request.resource.data.userId == request.auth.uid
                    && request.resource.data.timestamp == request.time;
      allow update: if isOwner(userId) && !request.resource.data.diff(resource.data).affectedKeys()
                      .hasAny(['uid', 'email', 'userId', 'timestamp', 'createdAt']);
    }

    // Alerts collection - public read, auth write
    match /alerts/{alertId} {
      allow read: if true;
      allow create: if isSignedIn()
                     && request.resource.data.reporterId == request.auth.uid
                     && request.resource.data.timestamp == request.time;
      allow update, delete: if false; // Immutable
    }

    // Posts collection - public read, auth write
    match /posts/{postId} {
      allow read: if true;
      allow create: if isSignedIn()
                    && request.resource.data.userId == request.auth.uid
                    && request.resource.data.createdAt == request.time;
      allow update: if request.auth.uid == resource.data.userId
                    && !request.resource.data.diff(resource.data).affectedKeys()
                      .hasAny(['userId', 'createdAt']);
      allow delete: if request.auth.uid == resource.data.userId;
    }
  }
}
```

Click **"Publish"**

---

## Langkah 7: Seeding Data (Optional)

Untuk testing, tambah beberapa document manual:

### Add Sample Alert
Di Firestore Console → **Collections** → **"alerts"** → **"Add document"**:

```json
{
  "type": "pothole",
  "severity": "high",
  "description": "Lubang besar di Jalan Klari",
  "coordinates": {
    "latitude": -6.3065,
    "longitude": 107.3371
  },
  "reporterId": "test-user-id",
  "reporterName": "Test User",
  "timestamp": 1716585600000
}
```

### Add Sample Post
Di **"posts"** collection:

```json
{
  "userId": "test-user-id",
  "userName": "Budi Prakoso",
  "userAvatar": "BP",
  "imageUrl": "https://images.unsplash.com/photo-1558618666-fcd25c85cd64",
  "caption": "Lubang besar di sini! Hati-hati lur.",
  "locationName": "Jl. Raya Klari, Karawang",
  "coordinates": {
    "latitude": -6.3065,
    "longitude": 107.3371
  },
  "likes": ["user-2", "user-3"],
  "comments": [],
  "createdAt": 1716585600000
}
```

---

## Langkah 8: Test Authentication

1. Run app: `npm run dev`
2. Buka `/profile` page
3. Click **"Login / Sign Up"**
4. Register new user
5. Check Firestore Console → **"users"** collection - harus ada document baru!

---

## Langkah 9: Deploy Production (Opsional)

Untuk production deployment:

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login ke Firebase
firebase login

# Initialize Firebase di project
firebase init

# Deploy Firestore rules
firebase deploy --only firestore:rules

# Deploy Hosting
firebase deploy
```

---

## 🔧 Troubleshooting

### "Firebase: No Firebase App '[DEFAULT]' has been created"
- Cek `.env.local` ada `VITE_FIREBASE_API_KEY`
- Pastikan config values valid

### "Missing or insufficient permissions"
- Firestore rules belum deployed
- Cek Rules tab di Firebase Console

### "User tidak ter-create di Firestore"
- Auth berhasil tapi Firestore create gagal
- Cek console untuk error details
- Pastikan user punya permission untuk write di `/users/{userId}`

---

## ✅ Checklist Production

- [ ] Firebase project dibuat
- [ ] Authentication enabled (Email/Password)
- [ ] Firestore database dibuat
- [ ] Firestore rules deployed
- [ ] Environment variables set
- [ ] Test registration/login
- [ ] Test create alert
- [ ] Test create post
- [ ] Test read operations

---

## 🎉 Next Steps

1. Implement real-time updates dengan `onSnapshot()`
2. Add image upload ke Firebase Storage
3. Implement push notifications
4. Add analytics
