import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { zustandStorage } from '../services/StorageService';
import { TransportMode } from './useJourneyStore';

export type JourneyOutcome = 'completed' | 'cancelled';

export interface JourneyRecord {
  id: string;
  destinationName: string;
  lat: number;
  lng: number;
  transportMode: TransportMode;
  /** Wake distance in meters configured for this journey. */
  wakeDistance: number;
  startedAt: number;
  endedAt: number;
  outcome: JourneyOutcome;
}

export type NewJourneyRecord = Omit<JourneyRecord, 'id' | 'startedAt'> & {
  startedAt?: number;
};

const MAX_HISTORY_ENTRIES = 50;

interface HistoryState {
  journeys: JourneyRecord[];
  recordJourney: (record: NewJourneyRecord) => void;
  clearHistory: () => void;
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set) => ({
      journeys: [],

      recordJourney: (record) =>
        set((state) => ({
          journeys: [
            {
              ...record,
              startedAt: record.startedAt ?? Date.now(),
              id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
            },
            ...state.journeys,
          ].slice(0, MAX_HISTORY_ENTRIES),
        })),

      clearHistory: () => set({ journeys: [] }),
    }),
    {
      name: 'journey-history-store',
      storage: createJSONStorage(() => zustandStorage),
    }
  )
);
