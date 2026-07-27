import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { zustandStorage } from '../services/StorageService';

export type TransportMode = 'driving' | 'walking' | 'transit' | 'cycling';
export type ConfidenceTier = 'high' | 'medium' | 'low';

export interface Destination {
  lat: number;
  lng: number;
  name?: string;
}

export interface LiveStats {
  currentSpeed: number; // in meters/second
  remainingDistance: number; // in meters
  confidenceTier: ConfidenceTier;
  eta: number; // timestamp or milliseconds
}

export interface JourneyState {
  destination: Destination | null;
  wakeDistance: number; // distance in meters to trigger alarm
  transportMode: TransportMode;
  liveStats: LiveStats | null;
  isTrackingActive: boolean;

  // Actions
  setDestination: (dest: Destination | null) => void;
  setWakeDistance: (distance: number) => void;
  setTransportMode: (mode: TransportMode) => void;
  setLiveStats: (stats: LiveStats | null) => void;
  setIsTrackingActive: (isActive: boolean) => void;
  resetJourney: () => void;
}

export const useJourneyStore = create<JourneyState>()(
  persist(
    (set) => ({
      destination: null,
      wakeDistance: 500, // default 500 meters
      transportMode: 'driving',
      liveStats: null,
      isTrackingActive: false,

      setDestination: (destination) => set({ destination }),
      setWakeDistance: (wakeDistance) => set({ wakeDistance }),
      setTransportMode: (transportMode) => set({ transportMode }),
      setLiveStats: (liveStats) => set({ liveStats }),
      setIsTrackingActive: (isTrackingActive) => set({ isTrackingActive }),
      resetJourney: () =>
        set({
          destination: null,
          liveStats: null,
          isTrackingActive: false,
        }),
    }),
    {
      name: 'journey-store',
      storage: createJSONStorage(() => zustandStorage),
    }
  )
);
