import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { zustandStorage } from '../services/StorageService';

export interface SettingsState {
  darkTheme: boolean;
  notificationsEnabled: boolean;
  vibrateEnabled: boolean;
  highAccuracyMode: boolean;

  setDarkTheme: (value: boolean) => void;
  setNotificationsEnabled: (value: boolean) => void;
  setVibrateEnabled: (value: boolean) => void;
  setHighAccuracyMode: (value: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      darkTheme: false,
      notificationsEnabled: true,
      vibrateEnabled: true,
      highAccuracyMode: true,

      setDarkTheme: (darkTheme) => set({ darkTheme }),
      setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled }),
      setVibrateEnabled: (vibrateEnabled) => set({ vibrateEnabled }),
      setHighAccuracyMode: (highAccuracyMode) => set({ highAccuracyMode }),
    }),
    {
      name: 'settings-store',
      storage: createJSONStorage(() => zustandStorage),
    }
  )
);
