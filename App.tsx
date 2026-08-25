// @ts-ignore: TS doesn't easily recognize side-effect css imports without extra config
import './global.css';
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { Provider as PaperProvider, MD3DarkTheme, MD3LightTheme } from 'react-native-paper';
import { AppNavigator } from './src/navigation/AppNavigator';
import { LocationService } from './src/services/LocationService';
import AlarmService from './src/services/AlarmService';
import { useSettingsStore } from './src/store/useSettingsStore';
import { useFonts } from 'expo-font';

// TaskManager must be defined in the global scope!
try {
  LocationService.initializeTaskManager();
} catch (error) {
  console.error("Failed to initialize TaskManager:", error);
}

// Reconcile any persisted journey with native tracking before the UI can
// start a new one; startTracking awaits this internally.
LocationService.reconcileActiveJourney();

export default function App() {
  const darkTheme = useSettingsStore((s) => s.darkTheme);
  const [fontsLoaded] = useFonts({
    // react-native-paper renders its icons as text glyphs - the font family
    // must be registered globally or every icon shows as a placeholder box.
    'MaterialCommunityIcons': require('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialCommunityIcons.ttf'),
  });

  useEffect(() => {
    // Initialize notification channels and alarm event handlers safely on mount
    AlarmService.registerEventListeners();
    AlarmService.initializeChannels().catch(console.error);
  }, []);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <PaperProvider theme={darkTheme ? MD3DarkTheme : MD3LightTheme}>
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>
    </PaperProvider>
  );
}
