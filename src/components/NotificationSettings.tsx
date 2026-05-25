import React, { useState, useEffect } from 'react';
import { Bell, BellOff, AlertTriangle, MessageCircle, MapPin, Shield } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  pushNotifications,
  isPushSupported,
  requestNotificationPermission,
  subscribeToPush,
  unsubscribeFromPush,
} from '../lib/pushNotifications';

interface NotificationSettings {
  roadAlerts: boolean;
  comments: boolean;
  nearbyHazards: boolean;
  safetyAlerts: boolean;
}

export default function NotificationSettings() {
  const [isEnabled, setIsEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [settings, setSettings] = useState<NotificationSettings>({
    roadAlerts: true,
    comments: true,
    nearbyHazards: true,
    safetyAlerts: true,
  });
  const [loading, setLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    // Check current status
    const checkStatus = async () => {
      if ('Notification' in window) {
        setPermission(Notification.permission);
        setIsEnabled(Notification.permission === 'granted');
      }

      if (pushNotifications.isSupported()) {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setIsSubscribed(!!subscription);
      }
    };

    checkStatus();
  }, []);

  const handleToggleNotifications = async () => {
    setLoading(true);

    try {
      if (isEnabled) {
        // Disable notifications
        await unsubscribeFromPush();
        setIsEnabled(false);
        setIsSubscribed(false);
      } else {
        // Enable notifications
        const perm = await requestNotificationPermission();
        setPermission(perm);

        if (perm === 'granted') {
          const subscription = await subscribeToPush();
          setIsSubscribed(!!subscription);
          setIsEnabled(true);
        }
      }

      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2000);
    } catch (error) {
      console.error('Toggle notifications error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSettingToggle = (key: keyof NotificationSettings) => {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const isSupported = pushNotifications.isSupported();

  return (
    <div className="space-y-4">
      {/* Main Toggle */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-zinc-50 to-white rounded-2xl border border-zinc-200 p-4"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.div
              animate={{ scale: isEnabled ? [1, 1.1, 1] : 1 }}
              transition={{ duration: 0.3 }}
              className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                isEnabled
                  ? 'bg-gradient-to-br from-brand-orange to-red-500'
                  : 'bg-zinc-100'
              }`}
            >
              {isEnabled ? (
                <Bell className="w-6 h-6 text-white" />
              ) : (
                <BellOff className="w-6 h-6 text-zinc-400" />
              )}
            </motion.div>
            <div>
              <h3 className="font-bold text-zinc-900">Push Notifications</h3>
              <p className="text-xs text-zinc-500">
                {isEnabled
                  ? 'Aktif - menerima notifikasi'
                  : permission === 'denied'
                  ? 'Ditolak - ubah di browser'
                  : 'Nonaktif - nyalakan untuk alerts'}
              </p>
            </div>
          </div>

          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleToggleNotifications}
            disabled={loading || permission === 'denied'}
            className={`relative w-14 h-8 rounded-full transition-colors ${
              isEnabled ? 'bg-brand-orange' : 'bg-zinc-300'
            } ${permission === 'denied' ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <motion.div
              animate={{ x: isEnabled ? 28 : 2 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="absolute top-1 w-6 h-6 bg-white rounded-full shadow-lg"
            />
          </motion.button>
        </div>

        {/* Browser not supported warning */}
        {!isSupported && (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
            <p className="text-xs text-amber-700">
              ⚠️ Browser tidak mendukung push notifications
            </p>
          </div>
        )}

        {/* Permission denied warning */}
        {permission === 'denied' && (
          <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-xs text-red-700">
              ⚠️ Notifikasi diblokir browser. Ubah di Settings → Site Settings → Notifications
            </p>
          </div>
        )}
      </motion.div>

      {/* Settings Grid */}
      <AnimatePresence>
        {isEnabled && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-3"
          >
            <h4 className="text-xs font-black text-zinc-400 uppercase tracking-widest px-1">
              Jenis Notifikasi
            </h4>

            {/* Road Alerts */}
            <SettingsToggle
              icon={<AlertTriangle className="w-5 h-5" />}
              iconBg="bg-red-500"
              title="Road Hazard Alerts"
              description="Lubang, banjir, kecelakaan di dekat Anda"
              enabled={settings.roadAlerts}
              onToggle={() => handleSettingToggle('roadAlerts')}
            />

            {/* Nearby Hazards */}
            <SettingsToggle
              icon={<MapPin className="w-5 h-5" />}
              iconBg="bg-orange-500"
              title="Nearby Hazard Radius"
              description="Alert saat mendekat bahaya dalam 500m"
              enabled={settings.nearbyHazards}
              onToggle={() => handleSettingToggle('nearbyHazards')}
            />

            {/* Safety Alerts */}
            <SettingsToggle
              icon={<Shield className="w-5 h-5" />}
              iconBg="bg-green-500"
              title="Safety Score Alerts"
              description="Info jika rute Anda berubah risiko"
              enabled={settings.safetyAlerts}
              onToggle={() => handleSettingToggle('safetyAlerts')}
            />

            {/* Comments */}
            <SettingsToggle
              icon={<MessageCircle className="w-5 h-5" />}
              iconBg="bg-blue-500"
              title="Comments & Mentions"
              description="Notifikasi jika ada yang comment di post Anda"
              enabled={settings.comments}
              onToggle={() => handleSettingToggle('comments')}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Success Toast */}
      <AnimatePresence>
        {showSuccess && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-24 left-4 right-4 z-50 bg-green-500 text-white p-4 rounded-2xl shadow-xl text-center font-bold"
          >
            ✅ Notifikasi {isEnabled ? 'dinyalakan' : 'dimatikan'}!
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Settings Toggle Component
interface SettingsToggleProps {
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}

function SettingsToggle({
  icon,
  iconBg,
  title,
  description,
  enabled,
  onToggle,
}: SettingsToggleProps) {
  return (
    <motion.div
      whileTap={{ scale: 0.98 }}
      className="bg-white rounded-2xl border border-zinc-200 p-4 flex items-center justify-between cursor-pointer"
      onClick={onToggle}
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center text-white`}>
          {icon}
        </div>
        <div>
          <h4 className="font-bold text-sm text-zinc-900">{title}</h4>
          <p className="text-xs text-zinc-500">{description}</p>
        </div>
      </div>

      <motion.div
        animate={{ x: enabled ? 22 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className={`relative w-10 h-6 rounded-full transition-colors ${
          enabled ? 'bg-brand-orange' : 'bg-zinc-300'
        }`}
      >
        <div className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-md" />
      </motion.div>
    </motion.div>
  );
}