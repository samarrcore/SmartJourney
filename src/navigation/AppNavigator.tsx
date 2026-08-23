import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { HomeScreen } from '../screens/HomeScreen';
import { JourneySetupScreen } from '../screens/JourneySetupScreen';
import { DestinationSearchScreen } from '../screens/DestinationSearchScreen';
import { LiveJourneyScreen } from '../screens/LiveJourneyScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { PermissionsCenterScreen } from '../screens/PermissionsCenterScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { DevSimulatorScreen } from '../screens/DevSimulatorScreen';

const Stack = createNativeStackNavigator();

export function AppNavigator() {
  return (
    <Stack.Navigator 
      initialRouteName="Home"
      screenOptions={{
        headerStyle: { backgroundColor: '#f8fafc' },
        headerShadowVisible: false,
        headerTintColor: '#1e293b',
        headerTitleStyle: { fontWeight: 'bold' },
      }}
    >
      <Stack.Screen 
        name="Home" 
        component={HomeScreen} 
        options={{ headerShown: false }} 
      />
      <Stack.Screen 
        name="JourneySetup" 
        component={JourneySetupScreen} 
        options={{ title: 'Setup Journey' }} 
      />
      <Stack.Screen 
        name="DestinationSearch" 
        component={DestinationSearchScreen} 
        options={{ title: 'Search Destination' }} 
      />
      <Stack.Screen 
        name="LiveJourney" 
        component={LiveJourneyScreen} 
        options={{ headerShown: false }} 
      />
      <Stack.Screen 
        name="Settings" 
        component={SettingsScreen} 
        options={{ title: 'Settings' }} 
      />
      <Stack.Screen 
        name="PermissionsCenter" 
        component={PermissionsCenterScreen} 
        options={{ title: 'Permissions' }} 
      />
      <Stack.Screen
        name="History"
        component={HistoryScreen}
        options={{ title: 'Journey History' }}
      />
      {__DEV__ && (
        <Stack.Screen
          name="DevSimulator"
          component={DevSimulatorScreen}
          options={{ title: 'Journey Simulator' }}
        />
      )}
    </Stack.Navigator>
  );
}
