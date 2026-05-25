import React, { useState, useEffect } from 'react';
import { Heart, MessageCircle, Share2, MapPin, MoreHorizontal, Camera } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { auth } from '../lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import Auth from './Auth';

const MOCK_POSTS = [
  {
    id: '1',
    user: 'Budi Prakoso',
    avatar: 'BP',
    image: '/1.jpg',
    caption: 'BARU SAJA! Baru masuk jurang gara-gara lubang di jalan ini! Mobil udah rusak parah, untung nggak ada korban. Hati-hati ya lur! 🚗💥 #Avenly #Bahaya',
    location: 'Jl. Raya Klari, Karawang',
    likes: 1247,
    comments: 234,
    time: '5 menit yang lalu'
  },
  {
    id: '2',
    user: 'Siti Aminah',
    avatar: 'SA',
    image: '/2.jpg',
    caption: 'MOBIL SAYA RODA DEPAN KANAN NYETEL DI LUBANG! As udah bengkok, ban pecah 💸💸 Gara-gara lubang ini udah 3 mobil mengalami hal yang sama hari ini!',
    location: 'Flyover Jl. HR Rasuna Said',
    likes: 856,
    comments: 167,
    time: '32 menit yang lalu'
  },
  {
    id: '3',
    user: 'Ahmad Fauzi',
    avatar: 'AF',
    image: 'https://images.unsplash.com/photo-1506521781263-d8422e82f27a?w=800&q=80',
    caption: 'ORANG JATUH MOTOR GARA-GARA LUBANG DI SINI! Korban udah dibawa ke RS. Ini lubang udah lama tapi belum diperbaiki sama sekali. LAPORAN PAK WALIKOTA! 😡',
    location: 'Cluster Harmony, Klari, Karawang',
    likes: 2341,
    comments: 456,
    time: '1 jam yang lalu'
  },
  {
    id: '4',
    user: 'Dewi Lestari',
    avatar: 'DL',
    image: 'https://images.unsplash.com/photo-1517048676732-d65bc937f952?w=800&q=80',
    caption: 'KECELAKAAN FATAL! Truk jatuh ke jurang gara-gara lubang besar yang nggak terlihat di malam hari. 1 korban jiwa. Ini jalan tol siapa sih yang nggak diperbaiki?! 🩸',
    location: 'Tol Jakarta-Cikampek Km 21',
    likes: 3456,
    comments: 678,
    time: '2 jam yang lalu'
  },
  {
    id: '5',
    user: 'Rudi Hermawan',
    avatar: 'RH',
    image: 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=800&q=80',
    caption: 'BAN SAYA MELEDAK GARA-GARA LUBANG! Dalam 1 KM ada 5 lubang besar! Gila aja ini jalannya. Siapa yang harus tanggung jawab?! 💰💰💰',
    location: 'Jl. Pintu Besi, Jakarta Timur',
    likes: 567,
    comments: 89,
    time: '3 jam yang lalu'
  }
];

export default function SocialFeed() {
  const [posts] = useState(MOCK_POSTS);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
    });
    return () => unsub();
  }, []);

  const handleInteraction = (action: string) => {
    if (!currentUser) {
      setShowAuth(true);
      return;
    }
    console.log(`Action: ${action}`);
  };

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-zinc-50 to-white pb-20 no-scrollbar">
      <AnimatePresence>
        {showAuth && <Auth onClose={() => setShowAuth(false)} onSuccess={() => setShowAuth(false)} />}
      </AnimatePresence>

      {/* Premium Stories Bar */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white/80 backdrop-blur-xl p-4 flex gap-4 overflow-x-auto no-scrollbar border-b border-zinc-100 shadow-sm"
      >
        {/* Add Story Button */}
        <motion.div
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="flex flex-col items-center gap-1.5 cursor-pointer shrink-0"
          onClick={() => handleInteraction('camera')}
        >
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-orange to-red-500 shadow-lg shadow-brand-orange/30 p-0.5">
            <div className="bg-white w-full h-full rounded-xl flex items-center justify-center">
              <Camera className="w-6 h-6 text-brand-orange" />
            </div>
          </div>
          <span className="text-[9px] font-black text-zinc-500 uppercase tracking-wider">Story</span>
        </motion.div>

        {[1, 2, 3, 4, 5].map((i, idx) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: idx * 0.1 }}
            className="flex flex-col items-center gap-1.5 shrink-0"
          >
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-brand-orange to-yellow-500 p-0.5 shadow-md shadow-brand-orange/20">
              <motion.div
                whileHover={{ scale: 1.05 }}
                className="bg-white p-0.5 rounded-xl h-full w-full overflow-hidden cursor-pointer"
              >
                <img
                  src={`https://i.pravatar.cc/150?u=${i + 10}`}
                  alt="avatar"
                  className="w-full h-full object-cover rounded-lg"
                />
              </motion.div>
            </div>
            <span className="text-[9px] font-bold text-zinc-400">User {i}</span>
          </motion.div>
        ))}
      </motion.div>

      {/* Feed Header */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="px-4 pt-4 pb-2"
      >
        <h2 className="text-lg font-black text-zinc-900">Laporan Terbaru</h2>
        <p className="text-xs text-zinc-500">Bantu selamatkan driver lain</p>
      </motion.div>

      {/* Feed */}
      <div className="flex flex-col gap-6 px-4 pb-4">
        {posts.map((post, idx) => (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ delay: idx * 0.1, type: "spring", stiffness: 100 }}
            whileHover={{ y: -2 }}
            key={post.id}
            className="bg-white rounded-3xl overflow-hidden shadow-lg border border-zinc-100"
          >
            {/* Header */}
            <div className="p-4 flex items-center justify-between">
              <motion.div
                whileHover={{ scale: 1.02 }}
                className="flex items-center gap-3 cursor-pointer"
              >
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-brand-orange to-red-500 text-white flex items-center justify-center font-black shadow-lg shadow-brand-orange/20 text-sm">
                  {post.avatar}
                </div>
                <div>
                  <h3 className="font-bold text-sm text-zinc-900">{post.user}</h3>
                  <div className="flex items-center gap-1 text-[10px] text-zinc-500 font-medium">
                    <MapPin className="w-3 h-3 text-brand-orange" />
                    <span className="truncate max-w-[150px]">{post.location}</span>
                  </div>
                </div>
              </motion.div>
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                className="w-8 h-8 rounded-full hover:bg-zinc-100 flex items-center justify-center"
              >
                <MoreHorizontal className="w-5 h-5 text-zinc-400" />
              </motion.button>
            </div>

            {/* Alert Badge */}
            <motion.div
              initial={{ x: -20, opacity: 0 }}
              whileInView={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="px-4 pb-2"
            >
              <div className="inline-flex items-center gap-1.5 bg-red-50 text-red-600 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                Bahaya Jalan
              </div>
            </motion.div>

            {/* Visual */}
            <motion.div
              whileTap={{ scale: 0.98 }}
              className="aspect-square w-full relative"
            >
              <img
                src={post.image}
                alt="post"
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=800&q=80';
                }}
              />
              {/* Gradient overlay */}
              <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/40 to-transparent" />
            </motion.div>

            {/* Footer */}
            <div className="p-4">
               <div className="flex items-center justify-between mb-3">
                 <div className="flex gap-4">
                   <motion.button
                    whileTap={{ scale: 0.85 }}
                    className="flex items-center gap-1.5 group"
                    onClick={() => handleInteraction('like')}
                   >
                     <Heart className="w-6 h-6 text-zinc-400 group-hover:text-red-500 transition-colors" />
                     <span className="text-xs font-bold text-zinc-500 group-hover:text-red-500">{post.likes}</span>
                   </motion.button>
                   <motion.button
                    whileTap={{ scale: 0.85 }}
                    className="flex items-center gap-1.5 group"
                    onClick={() => handleInteraction('comment')}
                   >
                     <MessageCircle className="w-6 h-6 text-zinc-400 group-hover:text-brand-orange transition-colors" />
                     <span className="text-xs font-bold text-zinc-500">{post.comments}</span>
                   </motion.button>
                   <motion.button
                    whileTap={{ scale: 0.85 }}
                    className="flex items-center gap-1.5 group"
                   >
                     <Share2 className="w-6 h-6 text-zinc-400 group-hover:text-brand-orange transition-colors" />
                   </motion.button>
                 </div>
                 <span className="text-[10px] font-bold text-zinc-400">{post.time}</span>
               </div>

               <p className="text-sm leading-relaxed text-zinc-700">
                 <span className="font-black text-zinc-900 mr-2">{post.user}</span>
                 {post.caption}
               </p>

               <motion.button
                whileTap={{ scale: 0.98 }}
                className="w-full mt-4 py-2.5 bg-brand-orange/10 text-brand-orange rounded-xl font-bold text-xs uppercase tracking-wider"
                onClick={() => handleInteraction('report')}
               >
                 Lihat di Peta
               </motion.button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
