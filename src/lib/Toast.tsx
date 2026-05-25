import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, XCircle, Info, CheckCircle } from 'lucide-react';
import { AppError } from './errorHandler';

interface ToastProps {
  error: AppError | null;
  onClose: () => void;
  autoCloseMs?: number;
}

const ICONS = {
  error: <XCircle className="w-5 h-5" />,
  warning: <AlertTriangle className="w-5 h-5" />,
  info: <Info className="w-5 h-5" />,
  success: <CheckCircle className="w-5 h-5" />,
};

const STYLES = {
  error: 'bg-gradient-to-r from-red-500 to-red-600',
  warning: 'bg-gradient-to-r from-amber-500 to-orange-500',
  info: 'bg-gradient-to-r from-blue-500 to-indigo-500',
  success: 'bg-gradient-to-r from-green-500 to-emerald-500',
};

export default function Toast({ error, onClose, autoCloseMs = 4000 }: ToastProps) {
  useEffect(() => {
    if (error && error.recoverable) {
      const timer = setTimeout(onClose, autoCloseMs);
      return () => clearTimeout(timer);
    }
  }, [error, autoCloseMs, onClose]);

  return (
    <AnimatePresence>
      {error && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className="fixed bottom-24 left-4 right-4 z-[100] pointer-events-auto"
        >
          <div className={`${STYLES.error} text-white rounded-2xl p-4 shadow-2xl`}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                {ICONS.error}
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-sm">Ups! Ada Masalah</h4>
                <p className="text-xs text-white/90 mt-0.5">{error.message}</p>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center shrink-0 hover:bg-white/30 transition-colors"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
