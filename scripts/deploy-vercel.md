# 🚀 Vercel Deployment Guide untuk Avenly

## Prerequisites

1. **Node.js 18+** terinstall
2. **Vercel CLI** (`npm i -g vercel`)
3. **Git** repository initialized
4. **Firebase project** sudah setup (dari guide sebelumnya)

---

## Langkah 1: Login Vercel

```bash
vercel login
```

Ikuti instruksi untuk login dengan email/GitHub.

---

## Langkah 2: Initialize Project

```bash
# Di folder project
vercel init
```

Atau langsung deploy:

```bash
vercel
```

---

## Langkah 3: Set Environment Variables

### Option A: Via Vercel Dashboard

1. Buka [vercel.com/dashboard](https://vercel.com/dashboard)
2. Pilih project → **Settings** → **Environment Variables**
3. Tambahkan variabel berikut:

| Name | Value | Environments |
|------|-------|--------------|
| `VITE_MAPBOX_ACCESS_TOKEN` | `pk.your_token_here` | Production, Preview, Development |
| `VITE_FIREBASE_API_KEY` | `AIzaSy...` | All |
| `VITE_FIREBASE_AUTH_DOMAIN` | `your-app.firebaseapp.com` | All |
| `VITE_FIREBASE_PROJECT_ID` | `your-project-id` | All |
| `VITE_FIREBASE_STORAGE_BUCKET` | `your-project.appspot.com` | All |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `123456789` | All |
| `VITE_FIREBASE_APP_ID` | `1:123:web:abc` | All |
| `GEMINI_API_KEY` | `your_gemini_key` | All |
| `VITE_VAPID_PUBLIC_KEY` | `Generated VAPID key` | All |
| `VITE_VAPID_PRIVATE_KEY` | `Generated VAPID key` | Production only |

### Option B: Via CLI

```bash
# Production
vercel env add VITE_MAPBOX_ACCESS_TOKEN
# Ikuti instruksi untuk input nilai

# Preview
vercel env add VITE_MAPBOX_ACCESS_TOKEN preview

# Development
vercel env add VITE_MAPBOX_ACCESS_TOKEN development
```

---

## Langkah 4: Generate VAPID Keys untuk Push Notifications

### Install web-push globally

```bash
npm install -g web-push
```

### Generate keys

```bash
npx web-push generate-vapid-keys
```

Akan keluar:
```
=======================================================

Public Key:
BEl62iUYgUivxI63OjY8krq99gkG5nPbdqjMk1...

Private Key:
yBFqwk5qZ5M5x0Y5T5r5Y5y5P5Q5B5...

Subject: mailto:admin@avenly.app

=======================================================
```

### Set di Vercel

```bash
vercel env add VITE_VAPID_PUBLIC_KEY
# Paste public key

vercel env add VITE_VAPID_PRIVATE_KEY production
# Paste private key

vercel env add VITE_VAPID_SUBJECT
mailto:admin@avenly.app
```

---

## Langkah 5: Deploy

### Deploy to Preview (Staging)

```bash
vercel
```

### Deploy to Production

```bash
vercel --prod
```

---

## Langkah 6: Custom Domain (Opsional)

1. Buka **Settings** → **Domains**
2. Tambahkan domain (contoh: `avenly.app`)
3. DNS record akan otomatis di-generate
4. Tambahkan record ke DNS provider
5. Tunggu propagasi (~24 jam)

---

## Langkah 7: Firebase Setup untuk Production

### Update Firestore Rules

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Deploy rules
firebase deploy --only firestore:rules
```

### Enable Firebase Hosting (Opsional)

```bash
firebase init hosting
# Pilih folder: dist
# Konfigurasi sebagai SPA: Yes
# Firebase JSON: auto-generated

firebase deploy --only hosting
```

---

## Troubleshooting

### Build Gagal

```bash
# Clear cache dan rebuild
vercel --force

# Check build logs
vercel logs your-project
```

### Environment Variables tidak terbaca

```bash
# Pull dari Vercel
vercel env pull .env.production.local

# List semua env
vercel env ls
```

### Mapbox tidak muncul

- Cek `VITE_MAPBOX_ACCESS_TOKEN` sudah diset
- Pastikan token adalah **Public Token** (pk.)
- Cek di [mapbox.com/account](https://account.mapbox.com/access-tokens/)

### Firebase Auth tidak work

- Pastikan semua `VITE_FIREBASE_*` variables diset
- Cek Firebase Console → Authentication → Sign-in method enabled
- Allowed domains di Firebase Console → Authentication → Settings

---

## 🌐 Domain Configuration

### untuk Custom Domain:

1. **Vercel DNS** (Recommended)
   ```
   Type: A
   Name: @
   Value: 76.76.21.21
   ```

2. **CNAME untuk www**
   ```
   Type: CNAME
   Name: www
   Value: cname.vercel-dns.com
   ```

3. **SPF/DKIM untuk Email**
   (jika pakai custom email)

---

## 📊 Monitoring

### Vercel Analytics

1. Enable di **Settings** → **Analytics**
2. Lihat traffic di **Analytics** dashboard

### Error Tracking

```bash
# Check function logs
vercel logs -f

# Check specific deployment
vercel logs <deployment-url>
```

---

## ✅ Deployment Checklist

- [ ] Vercel CLI installed
- [ ] Logged in to Vercel
- [ ] Environment variables set
- [ ] VAPID keys generated
- [ ] Firebase rules deployed
- [ ] Build successful
- [ ] Custom domain configured (optional)
- [ ] HTTPS working
- [ ] Service Worker registered

---

## 🚀 Quick Commands

```bash
# Development
npm run dev

# Build
npm run build

# Deploy to preview
vercel

# Deploy to production
vercel --prod

# Pull env vars
vercel env pull

# Check logs
vercel logs

# Force rebuild
vercel --force

# Add team member
vercel teams add
```

---

## 📞 Resources

- [Vercel Docs](https://vercel.com/docs)
- [Vercel Environment Variables](https://vercel.com/docs/concepts/env-variables)
- [Push Notifications Guide](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)

---

**Happy Deploying! 🚀**