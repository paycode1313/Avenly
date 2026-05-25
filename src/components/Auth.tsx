'use client';

import React, { useState } from 'react';
import { auth, createUserProfile } from '../lib/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { Mail, Lock, User, ArrowRight, X } from 'lucide-react';
import { motion } from 'framer-motion';

interface AuthProps {
  onSuccess: () => void;
  onClose: () => void;
}

// User-friendly error messages in Indonesian
function getAuthErrorMessage(error: any): string {
  const code = error?.code;

  const errorMessages: Record<string, string> = {
    'auth/email-already-in-use': 'Email sudah terdaftar. Gunakan email lain atau login.',
    'auth/invalid-email': 'Format email tidak valid.',
    'auth/user-disabled': 'Akun telah dinonaktifkan.',
    'auth/user-not-found': 'Email tidak ditemukan. Daftar dulu ya!',
    'auth/wrong-password': 'Password salah. Coba lagi atau reset password.',
    'auth/weak-password': 'Password terlalu lemah. Gunakan minimal 6 karakter.',
    'auth/too-many-requests': 'Terlalu banyak percobaan. Tunggu beberapa menit.',
    'auth/network-request-failed': 'Koneksi bermasalah. Cek internet kamu.',
    'auth/invalid-credential': 'Email atau password salah.',
  };

  return errorMessages[code] || error?.message || 'Terjadi kesalahan. Coba lagi.';
}

export default function Auth({ onSuccess, onClose }: AuthProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth) {
      setError('Firebase belum diinisialisasi. Cek environment variables.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      if (isLogin) {
        // Login
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        // Register
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);

        // Update profile
        await updateProfile(userCredential.user, { displayName: name });

        // Create Firestore user profile
        if (userCredential.user) {
          try {
            await createUserProfile(userCredential.user.uid, {
              displayName: name,
              photoURL: null,
              email: email,
              favorites: [],
            });
          } catch (profileError) {
            console.warn('⚠️ Could not create user profile:', profileError);
          }
        }
      }

      onSuccess();
    } catch (err: any) {
      setError(getAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-zinc-950/90 backdrop-blur-md"
    >
      <motion.div
        initial={{ y: 20, scale: 0.95 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 20, scale: 0.95 }}
        className="w-full max-w-sm bg-gradient-to-br from-zinc-900 to-zinc-800 border border-white/10 p-8 rounded-[2.5rem] shadow-2xl relative"
      >
        {/* Close Button */}
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
          onClick={onClose}
          className="absolute top-6 right-6 text-white/20 hover:text-white transition-colors"
        >
          <X className="w-6 h-6" />
        </motion.button>

        {/* Logo & Title */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ rotate: -10 }}
            animate={{ rotate: 0 }}
            transition={{ delay: 0.2, type: "spring" }}
          >
            <img src="/Logo Avenly - Color.png" alt="Avenly" className="h-16 w-auto mx-auto mb-4" />
          </motion.div>
          <h2 className="text-2xl font-black text-white font-display">
            {isLogin ? 'Selamat Datang!' : 'Bergabung dengan Avenly'}
          </h2>
          <p className="text-white/40 text-xs font-bold mt-2 uppercase tracking-wider">
            {isLogin ? 'Login untuk mengakses semua fitur' : 'Daftar untuk mulai berbagi laporan'}
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name Field (Register Only) */}
          {!isLogin && (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="relative"
            >
              <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/20" />
              <input
                required={!isLogin}
                type="text"
                placeholder="Nama Lengkap"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-white placeholder-white/20 focus:border-brand-orange focus:bg-white/10 outline-none transition-all"
              />
            </motion.div>
          )}

          {/* Email Field */}
          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/20" />
            <input
              required
              type="email"
              placeholder="Email Address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-white placeholder-white/20 focus:border-brand-orange focus:bg-white/10 outline-none transition-all"
            />
          </div>

          {/* Password Field */}
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/20" />
            <input
              required
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-white placeholder-white/20 focus:border-brand-orange focus:bg-white/10 outline-none transition-all"
            />
          </div>

          {/* Error Message */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red-500/10 border border-red-500/30 rounded-xl p-3"
            >
              <p className="text-red-400 text-xs font-bold text-center">{error}</p>
            </motion.div>
          )}

          {/* Submit Button */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            disabled={loading}
            type="submit"
            className="w-full bg-gradient-to-r from-brand-orange to-red-500 text-white py-4 rounded-2xl font-black shadow-xl shadow-brand-orange/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Memproses...</span>
              </>
            ) : (
              <>
                {isLogin ? 'LOGIN' : 'DAFTAR SEKARANG'}
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </motion.button>
        </form>

        {/* Toggle Login/Register */}
        <p className="text-center mt-6 text-xs text-white/40">
          {isLogin ? 'Belum punya akun?' : 'Sudah punya akun?'}{' '}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            type="button"
            onClick={() => {
              setIsLogin(!isLogin);
              setError('');
            }}
            className="text-brand-orange font-bold hover:underline"
          >
            {isLogin ? 'Daftar Sekarang' : 'Login'}
          </motion.button>
        </p>
      </motion.div>
    </motion.div>
  );
}
