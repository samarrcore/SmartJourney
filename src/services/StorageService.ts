import { createMMKV, MMKV } from 'react-native-mmkv';
import { StateStorage } from 'zustand/middleware';

let storageInstance: MMKV | null = null;

export function getAppStorage(): MMKV {
  if (!storageInstance) {
    storageInstance = createMMKV({
      id: 'smartjourney-app-storage',
    });
  }
  return storageInstance;
}

export const StorageService = {
  setItem: (key: string, value: string | boolean | number) => {
    getAppStorage().set(key, value);
  },
  getString: (key: string) => {
    return getAppStorage().getString(key);
  },
  getNumber: (key: string) => {
    return getAppStorage().getNumber(key);
  },
  getBoolean: (key: string) => {
    return getAppStorage().getBoolean(key);
  },
  removeItem: (key: string) => {
    getAppStorage().remove(key);
  },
  clearAll: () => {
    getAppStorage().clearAll();
  },
};

// Wrapper for zustand persist middleware
export const zustandStorage: StateStorage = {
  setItem: (name, value) => {
    getAppStorage().set(name, value);
  },
  getItem: (name) => {
    const value = getAppStorage().getString(name);
    return value ?? null;
  },
  removeItem: (name) => {
    getAppStorage().remove(name);
  },
};
