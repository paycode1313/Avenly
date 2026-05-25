<div align="center">

# 🗺️ Avenly - Road Safety Navigation PWA

![Status](https://img.shields.io/badge/status-production_ready-green)
![React](https://img.shields.io/badge/React-19-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Mapbox](https://img.shields.io/badge/Mapbox-Navigation-orange)

**Avenly** adalah aplikasi Progressive Web App untuk navigasi jalan dengan fitur pelaporan bahaya jalan secara real-time dan analisis AI.

</div>

---

## ✨ Fitur Utama

- 🗺️ **Peta Interaktif** dengan Mapbox GL JS
- 🧭 **Navigasi 3D Turn-by-Turn** dengan kompas dan arah mata angin
- 🚨 **Laporan Bahaya Jalan** (lubang, banjir, kecelakaan)
- 📸 **Analisis AI** dengan Google Gemini untuk deteksi hazard
- 👥 **Social Feed** untuk berbagi pengalaman perjalanan
- 📱 **PWA Installable** - bisa diinstal di HP
- 🔕 **Offline Support** - tetap bisa pakai saat offline
- 🔒 **Firebase Auth** untuk keamanan user

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Setup Environment Variables

Copy `.env.example` ke `.env.local`:

```bash
# Mapbox Public Token (WAJIB - harus start dengan 'pk.')
VITE_MAPBOX_ACCESS_TOKEN=pk.your_mapbox_public_token_here

# Firebase Config (opsional - untuk auth)
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abcdef

# Gemini API Key (untuk AI analysis)
GEMINI_API_KEY=your_gemini_api_key
```

### 3. Dapatkan Mapbox Token

1. Kunjungi [Mapbox Account](https://account.mapbox.com/access-tokens/)
2. Buat **Public Token** baru (yang start dengan `pk.`)
3. ⚠️ **PENTING**: Jangan gunakan Secret Token (`sk.`) - itu untuk backend saja!

### 4. Jalankan Development Server

```bash
npm run dev
```

Buka `http://localhost:3000` di browser.

---

## 🏗️ Build untuk Production

```bash
# Build production bundle
npm run build

# Preview production build
npm start
```

### Deployment Options

#### Vercel (Recommended)
```bash
npm i -g vercel
vercel
```

#### Firebase Hosting
```bash
firebase init hosting
firebase deploy
```

---

## 📁 Struktur Project

```
avenlyfinalbos/
├── public/
│   ├── sw.js              # Service Worker untuk offline support
│   ├── manifest.json      # PWA manifest
│   └── Logo*.png          # App icons
├── src/
│   ├── components/
│   │   ├── MapboxView.tsx    # Halaman utama peta & navigasi
│   │   ├── SocialFeed.tsx     # Social feed untuk hazard reports
│   │   ├── ProfileView.tsx    # User profile
│   │   ├── Auth.tsx           # Firebase auth UI
│   │   └── Layout.tsx         # App layout dengan bottom nav
│   ├── lib/
│   │   ├── firebase.ts        # Firebase configuration
│   │   ├── errorHandler.ts    # Error handling utilities
│   │   ├── Toast.tsx          # Toast notifications
│   │   └── utils.ts           # Utility functions
│   ├── App.tsx               # Router setup
│   ├── main.tsx              # Entry point dengan SW registration
│   └── index.css             # Global styles
├── server.ts                 # Express backend (API endpoints)
├── firebase-blueprint.json   # Firestore schema
├── firestore.rules           # Security rules
└── .env.example              # Environment template
```

---

## 🔑 API Endpoints

### POST `/api/directions`
Hitung rute dengan Mapbox Directions API.

```json
{
  "origin": [-6.3065, 107.3371],
  "destination": "Karawang, Indonesia"
}
```

### POST `/api/analyze-road`
Analisis gambar dengan Gemini AI untuk deteksi bahaya.

```json
{
  "imageUrl": "base64_encoded_image",
  "latitude": -6.3065,
  "longitude": 107.3371
}
```

### GET `/api/weather`
Data cuaca untuk route safety scoring.

---

## 🛡️ Security

- **Firestore Rules** ada di `firestore.rules`
- Testing payload ada di `security_spec.md`
- Default deny untuk semua akses
- Identity enforcement di semua write operations
- Timestamp immutability

---

## 📱 PWA Features

| Feature | Status |
|---------|--------|
| Offline Maps | ✅ |
| Background Sync | ✅ |
| Push Notifications | ✅ |
| Install Prompt | ✅ |
| Cache Strategy | Stale-while-revalidate |

---

## 🐛 Troubleshooting

### Map tidak muncul?
- Pastikan `VITE_MAPBOX_ACCESS_TOKEN` sudah diset
- Token harus **Public Token** (start dengan `pk.`)

### Location tidak work?
- Allow location permission di browser
- HTTPS diperlukan untuk Geolocation API

### Offline tidak jalan?
- Pastikan service worker teregistrasi (cek console)
- Install app terlebih dahulu (Add to Home Screen)

---

## 📄 License

MIT License - buat proyek akademi/pembelajaran.

---

<div align="center">

**Built with ❤️ using React, TypeScript, Mapbox & Firebase**

</div>