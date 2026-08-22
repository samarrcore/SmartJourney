// @ts-ignore: TS doesn't easily recognize side-effect css imports without extra config
import './global.css';
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { Provider as PaperProvider, MD3DarkTheme, MD3LightTheme } from 'react-native-paper';
import { AppNavigator } from './src/navigation/AppNavigator';
import { LocationService } from './src/services/LocationService';
import AlarmService from './src/services/AlarmService';
import { useSettingsStore } from './src/store/useSettingsStore';

// TaskManager must be defined in the global scope!
try {
  LocationService.initializeTaskManager();
} catch (error) {
  console.error("Failed to initialize TaskManager:", error);
}

export default function App() {
  const darkTheme = useSettingsStore((s) => s.darkTheme);

  useEffect(() => {
    // Initialize notification channels and alarm event handlers safely on mount
    AlarmService.registerEventListeners();
    AlarmService.initializeChannels().catch(console.error);
  }, []);

  return (
    <PaperProvider theme={darkTheme ? MD3DarkTheme : MD3LightTheme}>
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>
    </PaperProvider>
  );
}
