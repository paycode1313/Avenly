/**
 * Push Notification Setup for Avenly
 *
 * This file handles:
 * - VAPID key generation
 * - Push subscription management
 * - Push notification sending
 */

// VAPID Keys (generate once and store in environment)
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = import.meta.env.VITE_VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = import.meta.env.VITE_VAPID_SUBJECT || 'mailto:admin@avenly.app';

// Convert VAPID public key to Uint8Array for push manager
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Check if push notifications are supported
export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

// Subscribe to push notifications
export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!isPushSupported()) {
    console.warn('⚠️ Push notifications not supported');
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.ready;

    // Check existing subscription
    const existingSubscription = await registration.pushManager.getSubscription();
    if (existingSubscription) {
      console.log('✅ Already subscribed to push notifications');
      return existingSubscription;
    }

    // Subscribe to push
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    console.log('✅ Push subscription successful:', subscription.endpoint);
    return subscription;
  } catch (error) {
    console.error('❌ Push subscription failed:', error);
    return null;
  }
}

// Unsubscribe from push notifications
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!isPushSupported()) return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      await subscription.unsubscribe();
      console.log('✅ Unsubscribed from push notifications');
      return true;
    }

    return false;
  } catch (error) {
    console.error('❌ Unsubscribe failed:', error);
    return false;
  }
}

// Send push notification (called from server or Firebase Cloud Functions)
export async function sendPushNotification(
  subscription: PushSubscription,
  title: string,
  body: string,
  icon?: string,
  badge?: string,
  data?: Record<string, any>
): Promise<boolean> {
  try {
    const response = await fetch('/api/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subscription,
        notification: {
          title,
          body,
          icon: icon || '/Logo Avenly - Color.png',
          badge: badge || '/Logo Avenly - Color.png',
          data,
          vibrate: [200, 100, 200],
          tag: 'avenly-alert',
        },
      }),
    });

    return response.ok;
  } catch (error) {
    console.error('❌ Failed to send push notification:', error);
    return false;
  }
}

// Request notification permission
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    console.warn('⚠️ Notifications not supported');
    return 'denied';
  }

  const permission = await Notification.requestPermission();
  console.log('📱 Notification permission:', permission);
  return permission;
}

// Show local notification (without push)
export function showLocalNotification(title: string, options?: NotificationOptions): void {
  if (Notification.permission !== 'granted') {
    console.warn('⚠️ Notification permission not granted');
    return;
  }

  const notification = new Notification(title, {
    icon: '/Logo Avenly - Color.png',
    badge: '/Logo Avenly - Color.png',
    ...options,
  });

  // Auto close after 5 seconds
  setTimeout(() => notification.close(), 5000);
}

// Handle service worker push event
export function setupPushEventListeners(): void {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('message', (event) => {
    console.log('📬 Service Worker message:', event.data);

    if (event.data?.type === 'PUSH_NOTIFICATION') {
      const { title, body, icon, data } = event.data.payload;
      showLocalNotification(title, { icon, data });
    }
  });
}

// Export for use in components
export const pushNotifications = {
  isSupported: isPushSupported,
  subscribe: subscribeToPush,
  unsubscribe: unsubscribeFromPush,
  requestPermission: requestNotificationPermission,
  showLocal: showLocalNotification,
  setupListeners: setupPushEventListeners,
};

export default pushNotifications;