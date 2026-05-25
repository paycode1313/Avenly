import React, { useState, useEffect } from 'react';
import { Settings, MapPin, Heart, Bookmark, Bell, Shield, LogOut, ChevronRight, User as UserIcon, Star } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { auth, isFirebaseReady, createUserProfile, UserProfile } from '../lib/firebase';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import Auth from './Auth';
import NotificationSettings from './NotificationSettings';

export default function ProfileView() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user && isFirebaseReady) {
        // Fetch user profile from Firestore
        // For now, use basic user data
        setUserProfile({
          uid: user.uid,
          displayName: user.displayName,
          photoURL: user.photoURL,
          email: user.email,
          favorites: [],
          createdAt: null,
          updatedAt: null,
        });
      }
    });
    return () => unsub();
  }, []);

  const handleLogout = async () => {
    if (auth) {
      await signOut(auth);
      setUserProfile(null);
    }
  };

  if (!currentUser) {
    return (
      <div className="h-full bg-gradient-to-b from-white to-brand-orange/5 flex flex-col items-center justify-center p-8 gap-6">
        <AnimatePresence>
          {showAuth && <Auth onClose={() => setShowAuth(false)} onSuccess={() => setShowAuth(false)} />}
        </AnimatePresence>

        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 100 }}
        >
          <img src="/Logo Avenly - Color.png" alt="Avenly" className="h-28 w-auto mb-4" />
        </motion.div>

        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="text-center space-y-2"
        >
          <h2 className="text-2xl font-black font-display text-zinc-900 tracking-tight">Bergabung dengan Komunitas</h2>
          <p className="text-zinc-500 text-xs font-bold max-w-[240px] mx-auto leading-relaxed uppercase tracking-wider">
            Login untuk akses profil dan rute favoritmu
          </p>
        </motion.div>

        <motion.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="w-full"
        >
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowAuth(true)}
            className="w-full max-w-xs bg-gradient-to-r from-brand-orange to-red-500 text-white py-5 rounded-[2rem] font-black shadow-2xl shadow-brand-orange/40 uppercase tracking-widest text-sm"
          >
            Login / Sign Up
          </motion.button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-full bg-gradient-to-b from-zinc-50 to-white overflow-y-auto no-scrollbar">
      {/* Profile Header */}
      <div className="bg-gradient-to-br from-brand-orange/10 to-white p-10 flex flex-col items-center gap-6 rounded-b-[4rem] border-b border-zinc-200 shadow-lg relative overflow-hidden">
        {/* Decorative blur */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-brand-orange/20 blur-[80px]" />

        <div className="relative">
          <motion.div
            whileHover={{ scale: 1.05 }}
            className="w-36 h-36 rounded-full border-4 border-brand-orange shadow-2xl shadow-brand-orange/30 p-1.5 bg-white"
          >
            <div className="w-full h-full rounded-full overflow-hidden">
               <img src={currentUser.photoURL || `https://i.pravatar.cc/300?u=${currentUser.uid}`} alt="avatar" className="w-full h-full object-cover" />
            </div>
          </motion.div>
          <div className="absolute bottom-2 right-2 bg-brand-orange w-10 h-10 rounded-2xl flex items-center justify-center text-white border-2 border-white shadow-xl">
            <Shield className="w-5 h-5" />
          </div>
        </div>
        <div className="text-center z-10">
          <h2 className="text-3xl font-bold font-display text-zinc-900 tracking-tight">{currentUser.displayName || 'Guest User'}</h2>
          <p className="text-zinc-500 font-black text-[10px] uppercase tracking-[0.2em] mt-1">{currentUser.email}</p>
        </div>

        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.3 }}
          className="flex gap-8 mt-4 w-full px-4 text-center"
        >
          <div className="flex-1">
            <p className="text-2xl font-black text-brand-orange font-display">0</p>
            <p className="text-[8px] uppercase font-black text-zinc-400 tracking-widest mt-1">Reports</p>
          </div>
          <div className="w-[1px] bg-zinc-200" />
          <div className="flex-1">
            <p className="text-2xl font-black text-brand-orange font-display">100</p>
            <p className="text-[8px] uppercase font-black text-zinc-400 tracking-widest mt-1">Trust</p>
          </div>
          <div className="w-[1px] bg-zinc-200" />
          <div className="flex-1">
            <p className="text-2xl font-black text-brand-orange font-display">0</p>
            <p className="text-[8px] uppercase font-black text-zinc-400 tracking-widest mt-1">Total KM</p>
          </div>
        </motion.div>
      </div>

      {/* Notifications Settings */}
      <div className="p-4">
        <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.3em] px-1 mb-4">Notifications</h3>
        <NotificationSettings />
      </div>

      {/* Menu Options */}
      <div className="p-4 space-y-6">
        <div>
          <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.3em] px-1 mb-3">Pengaturan Navigasi</h3>
          <div className="bg-white rounded-2xl overflow-hidden border border-zinc-200 shadow-sm">
             <MenuLink icon={<MapPin className="text-brand-orange" />} label="Lokasi Favorit" />
             <MenuLink icon={<Bookmark className="text-blue-500" />} label="Rute Tersimpan" />
          </div>
        </div>

        <div>
          <h3 className="text-[10px] font-black text-zinc-400 uppercase tracking-[0.3em] px-1 mb-3">Akun</h3>
          <div className="bg-white rounded-2xl overflow-hidden border border-zinc-200 shadow-sm">
             <MenuLink icon={<Settings className="text-gray-400" />} label="Pengaturan App" />
             <div onClick={handleLogout}>
              <MenuLink icon={<LogOut className="text-red-500" />} label="Logout" last />
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string, value: string }) {
  return (
    <div className="flex-1 text-center">
      <p className="text-2xl font-black text-brand-orange font-display">{value}</p>
      <p className="text-[8px] uppercase font-black text-white/20 tracking-widest mt-1">{label}</p>
    </div>
  );
}

function MenuLink({ icon, label, last }: { icon: React.ReactNode, label: string, last?: boolean }) {
  return (
    <div className={cn(
      "flex items-center justify-between p-6 active:bg-zinc-50 transition-all duration-300 cursor-pointer group",
      !last && "border-b border-zinc-200"
    )}>
      <div className="flex items-center gap-5">
        <div className="bg-zinc-100 p-3 rounded-2xl border border-zinc-200 group-active:scale-90 transition-transform">
          {icon}
        </div>
        <span className="font-bold text-zinc-700 group-hover:text-zinc-900 transition-colors">{label}</span>
      </div>
      <ChevronRight className="w-5 h-5 text-zinc-300 group-hover:text-brand-orange transition-colors" />
    </div>
  );
}

// Helper to keep profile file clean
function cn(...classes: any[]) {
  return classes.filter(Boolean).join(' ');
}
