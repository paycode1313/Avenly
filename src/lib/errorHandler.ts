/**
 * Error handling utilities for Avenly App
 */

export interface AppError {
  code: string;
  message: string;
  recoverable: boolean;
  timestamp: Date;
}

export class AppErrorHandler {
  private static errors: AppError[] = [];
  private static maxErrors = 50;

  static log(error: Partial<AppError>): void {
    const appError: AppError = {
      code: error.code || 'UNKNOWN',
      message: error.message || 'Unknown error occurred',
      recoverable: error.recoverable ?? true,
      timestamp: new Date(),
    };

    this.errors.push(appError);
    if (this.errors.length > this.maxErrors) {
      this.errors.shift();
    }

    console.error('❌ App Error:', appError);

    // Send to error tracking service in production
    if (import.meta.env.PROD) {
      this.sendToTracking(appError);
    }
  }

  static getRecentErrors(count = 10): AppError[] {
    return this.errors.slice(-count);
  }

  static clearErrors(): void {
    this.errors = [];
  }

  private static async sendToTracking(error: AppError): Promise<void> {
    // In production, send to error tracking service
    // For now, just log
    console.warn('[PROD] Error tracking:', error);
  }
}

export function handleMapboxError(error: any): AppError {
  if (error?.message?.includes('Token')) {
    return {
      code: 'MAPBOX_TOKEN_ERROR',
      message: 'Token Mapbox tidak valid. Silakan periksa pengaturan.',
      recoverable: false,
      timestamp: new Date(),
    };
  }

  if (error?.message?.includes('rate limit') || error?.status === 429) {
    return {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Terlalu banyak permintaan. Tunggu beberapa detik.',
      recoverable: true,
      timestamp: new Date(),
    };
  }

  return {
    code: 'MAPBOX_UNKNOWN',
    message: error?.message || 'Terjadi kesalahan pada peta.',
    recoverable: true,
    timestamp: new Date(),
  };
}

export function handleFirebaseError(error: any): AppError {
  if (error?.code === 'auth/user-not-found') {
    return {
      code: 'USER_NOT_FOUND',
      message: 'Pengguna tidak ditemukan.',
      recoverable: true,
      timestamp: new Date(),
    };
  }

  if (error?.code === 'auth/wrong-password') {
    return {
      code: 'INVALID_PASSWORD',
      message: 'Password salah.',
      recoverable: true,
      timestamp: new Date(),
    };
  }

  if (error?.code === 'permission-denied') {
    return {
      code: 'PERMISSION_DENIED',
      message: 'Anda tidak memiliki izin untuk akses ini.',
      recoverable: false,
      timestamp: new Date(),
    };
  }

  return {
    code: 'FIREBASE_UNKNOWN',
    message: error?.message || 'Terjadi kesalahan koneksi.',
    recoverable: true,
    timestamp: new Date(),
  };
}

export function handleNetworkError(error: any): AppError {
  if (!navigator.onLine) {
    return {
      code: 'OFFLINE',
      message: 'Anda sedang offline. Cek koneksi internet.',
      recoverable: false,
      timestamp: new Date(),
    };
  }

  return {
    code: 'NETWORK_ERROR',
    message: 'Gagal terhubung ke server. Coba lagi nanti.',
    recoverable: true,
    timestamp: new Date(),
  };
}

export function showUserFriendlyError(error: AppError): string {
  const friendlyMessages: Record<string, string> = {
    'MAPBOX_TOKEN_ERROR': '⚠️ Token peta tidak valid. Silakan refresh halaman.',
    'RATE_LIMIT_EXCEEDED': '⏳ Terlalu cepat. Tunggu sebentar ya.',
    'USER_NOT_FOUND': '👤 Akun tidak ditemukan.',
    'INVALID_PASSWORD': '🔒 Password salah. Coba lagi.',
    'PERMISSION_DENIED': '🚫 Akses ditolak.',
    'OFFLINE': '📶 Anda sedang offline. Nyalakan internet dulu.',
    'NETWORK_ERROR': '🌐 Koneksi bermasalah. Coba lagi.',
  };

  return friendlyMessages[error.code] || error.message;
}
