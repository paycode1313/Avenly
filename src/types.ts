/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface UserProfile {
  uid: string;
  displayName: string;
  photoURL: string;
  email: string;
  favorites: FavoriteLocation[];
}

export interface FavoriteLocation {
  id: string;
  name: string;
  address: string;
  coordinates: {
    lat: number;
    lng: number;
  };
}

export interface RoadAlert {
  id: string;
  type: 'accident' | 'pothole' | 'flood' | 'traffic' | 'other';
  severity: 'low' | 'medium' | 'high';
  description: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  reporterId: string;
  reporterName: string;
  timestamp: number;
}

export interface Post {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string;
  imageUrl: string;
  caption: string;
  locationName: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  likes: string[]; // array of uids
  comments: Comment[];
  createdAt: number;
}

export interface Comment {
  id: string;
  userId: string;
  userName: string;
  text: string;
  createdAt: number;
}

export interface NavigationState {
  isNavigating: boolean;
  origin: [number, number] | null;
  destination: [number, number] | null;
  route: any | null;
  eta: number | null; // in minutes
  distance: number | null; // in meters
}
