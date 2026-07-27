// @ts-ignore: TS doesn't easily recognize side-effect css imports without extra config
import './global.css';
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { Provider as PaperProvider } from 'react-native-paper';
import { AppNavigator } from './src/navigation/AppNavigator';
import { LocationService } from './src/services/LocationService';
import AlarmService from './src/services/AlarmService';

// TaskManager must be defined in the global scope!
try {
  LocationService.initializeTaskManager();
} catch (error) {
  console.error("Failed to initialize TaskManager:", error);
}

export default function App() {
  useEffect(() => {
    // Initialize notification channels safely on mount
    AlarmService.initializeChannels().catch(console.error);
  }, []);

  return (
    <PaperProvider>
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>
    </PaperProvider>
  );
}
