import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Map, Share2, User, Bell, Navigation } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

export default function Layout() {
  const location = useLocation();
  const [hasNotification, setHasNotification] = useState(true);

  return (
    <div className="flex flex-col h-screen bg-white text-zinc-900">
      {/* Top Banner / Status */}
      <motion.header
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 100 }}
        className="p-4 border-b border-zinc-200 flex items-center justify-between bg-white/95 backdrop-blur-xl z-50 shadow-sm"
      >
        <motion.div
          className="flex items-center gap-3"
          whileHover={{ scale: 1.02 }}
        >
          <img src="/Logo Avenly - Color.png" alt="Avenly" className="h-12 w-auto" />
          <h1 className="text-xl font-display font-bold text-brand-orange tracking-tight">Avenly</h1>
        </motion.div>
        <div className="flex gap-4">
          <motion.div
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            className="relative w-10 h-10 rounded-full bg-zinc-100 border border-zinc-200 flex items-center justify-center cursor-pointer"
          >
            <Bell className="w-5 h-5 text-zinc-400" />
            {hasNotification && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white text-[10px] font-bold shadow-lg"
              >
                3
              </motion.div>
            )}
          </motion.div>
          <motion.div
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            className="w-10 h-10 rounded-full bg-brand-orange border border-brand-orange/20 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-brand-orange/30 cursor-pointer"
          >
            JD
          </motion.div>
        </div>
      </motion.header>

      {/* Main Content */}
      <main className="flex-1 relative overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="h-full"
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Bottom Navigation */}
      <motion.nav
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 100, delay: 0.1 }}
        className="bg-white/95 backur-2xl border-t border-zinc-200 pb-safe pt-2 px-6 flex justify-around items-center z-50 shadow-[0_-2px_20px_rgba(0,0,0,0.08)]"
      >
        <NavItem to="/" icon={<Map />} label="MAPS" />
        <NavItem to="/social" icon={<Share2 />} label="SOCIAL" />
        <NavItem to="/profile" icon={<User />} label="ME" />
      </motion.nav>
    </div>
  );
}

function NavItem({ to, icon, label }: { to: string, icon: React.ReactNode, label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => cn(
        "flex flex-col items-center gap-1.5 p-2 transition-all duration-300 relative",
        isActive ? "text-brand-orange scale-110" : "text-zinc-400 hover:text-zinc-600"
      )}
    >
      {({ isActive }) => (
        <>
          <motion.div
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            className={cn(
              "p-2 rounded-2xl transition-all relative",
              isActive ? "bg-brand-orange text-white shadow-xl shadow-brand-orange/40" : "bg-transparent"
            )}
          >
            {React.cloneElement(icon as React.ReactElement, { className: "w-5 h-5" })}
            {isActive && (
              <motion.div
                layoutId="activeTab"
                className="absolute inset-0 bg-brand-orange rounded-2xl -z-10"
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              />
            )}
          </motion.div>
          <span className={cn(
            "text-[9px] uppercase tracking-widest font-black transition-all",
            isActive && "text-brand-orange"
          )}>
            {label}
          </span>
        </>
      )}
    </NavLink>
  );
}
