import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Button, IconButton } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useJourneyStore } from '../store/useJourneyStore';
import { LocationService } from '../services/LocationService';

export function JourneySetupScreen() {
  const navigation = useNavigation<any>();
  const { destination, setWakeDistance, setTransportMode, setIsTrackingActive } = useJourneyStore();
  const [distance, setDistance] = useState(2);
  const [mode, setMode] = useState('driving');

  const modes = [
    { id: 'transit', icon: 'train', label: 'Transit' },
    { id: 'driving', icon: 'car', label: 'Driving' },
  ];

  const handleStartTracking = async () => {
    if (!destination) {
      Alert.alert('Error', 'No destination selected.');
      return;
    }
    
    try {
      setWakeDistance(distance * 1000); // km to meters
      setTransportMode(mode as any);
      
      await LocationService.startTracking({
        destination: {
          latitude: destination.lat,
          longitude: destination.lng,
        },
      });
      
      setIsTrackingActive(true);
      navigation.navigate('LiveJourney');
    } catch (error: any) {
      Alert.alert('Permission Error', error.message || 'Could not start tracking.');
    }
  };

  return (
    <ScrollView className="flex-1 bg-slate-50 p-6">
      <View className="mb-8">
        <Text className="text-3xl font-extrabold text-slate-800 mb-2">Setup Alarm</Text>
        <Text className="text-slate-500 text-base">{destination?.name || 'Selected Destination'}</Text>
      </View>

      <Text className="text-lg font-bold text-slate-700 mb-4">Transport Mode</Text>
      <View className="flex-row justify-between mb-8">
        {modes.map((m) => (
          <TouchableOpacity
            key={m.id}
            onPress={() => setMode(m.id)}
            className={`flex-1 items-center justify-center p-4 rounded-2xl mx-1 border ${
              mode === m.id ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-200'
            }`}
          >
            <IconButton 
              icon={m.icon} 
              iconColor={mode === m.id ? 'white' : '#64748b'} 
              size={32} 
              className="m-0 mb-2" 
            />
            <Text className={`font-semibold ${mode === m.id ? 'text-white' : 'text-slate-600'}`}>
              {m.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text className="text-lg font-bold text-slate-700 mb-2">Wake Distance</Text>
      <View className="bg-white p-6 rounded-3xl border border-slate-200 mb-8 items-center">
        <Text className="text-slate-400 mb-4 font-medium uppercase tracking-wider">Alarm triggers before arrival</Text>
        <View className="flex-row items-center justify-center">
          <IconButton 
            icon="minus-circle-outline" 
            iconColor="#4f46e5" 
            size={40} 
            onPress={() => setDistance(Math.max(0.5, distance - 0.5))} 
          />
          <View className="w-32 items-center">
            <Text className="text-5xl font-extrabold text-indigo-600">
              {distance.toFixed(1)}
            </Text>
            <Text className="text-lg font-bold text-slate-400 mt-1">km</Text>
          </View>
          <IconButton 
            icon="plus-circle-outline" 
            iconColor="#4f46e5" 
            size={40} 
            onPress={() => setDistance(Math.min(20, distance + 0.5))} 
          />
        </View>
      </View>

      <Button
        mode="contained"
        buttonColor="#4f46e5"
        className="rounded-xl py-2 mt-4"
        onPress={handleStartTracking}
      >
        Start Tracking
      </Button>
    </ScrollView>
  );
}
