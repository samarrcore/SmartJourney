import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Card, IconButton, Button, ProgressBar } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import MapView, { Marker } from 'react-native-maps';
import { useJourneyStore } from '../store/useJourneyStore';
import { LocationService } from '../services/LocationService';

export function LiveJourneyScreen() {
  const navigation = useNavigation<any>();
  
  const { destination, liveStats, isTrackingActive, setIsTrackingActive, resetJourney } = useJourneyStore();

  const handleCancelJourney = async () => {
    await LocationService.stopTracking();
    setIsTrackingActive(false);
    resetJourney();
    navigation.navigate('Home');
  };

  const remainingKm = liveStats ? (liveStats.remainingDistance / 1000).toFixed(1) : '--';
  const speedKmh = liveStats ? (liveStats.currentSpeed * 3.6).toFixed(0) : '--';
  
  let etaString = '--:--';
  let minsRemaining = '--';
  if (liveStats && liveStats.eta > 0) {
    const etaDate = new Date(liveStats.eta);
    etaString = etaDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const diffMins = Math.max(0, Math.round((etaDate.getTime() - Date.now()) / 60000));
    minsRemaining = `${diffMins} mins`;
  }

  const confidenceMsg = liveStats?.confidenceTier === 'high' 
    ? 'High Tracking Confidence. GPS signal is strong.' 
    : liveStats?.confidenceTier === 'medium'
      ? 'Degraded Tracking Confidence. Signal is weak.'
      : 'Poor Tracking Confidence. Location may be inaccurate.';

  const confidenceIcon = liveStats?.confidenceTier === 'high' ? 'check-circle' : 'alert-circle';
  const confidenceColor = liveStats?.confidenceTier === 'high' ? '#10b981' : (liveStats?.confidenceTier === 'medium' ? '#f59e0b' : '#ef4444');

  return (
    <View className="flex-1 bg-slate-50">
      <View className="h-1/3">
        <MapView
          className="flex-1"
          region={{
            latitude: destination?.lat || 37.78825,
            longitude: destination?.lng || -122.4324,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
        >
          {destination && <Marker coordinate={{ latitude: destination.lat, longitude: destination.lng }} />}
        </MapView>
      </View>

      <View className="flex-1 -mt-6 bg-slate-50 rounded-t-3xl shadow-xl px-6 pt-6">
        <View className="flex-row justify-between items-center mb-6">
          <View>
            <Text className="text-slate-500 font-medium uppercase tracking-wider mb-1">Destination</Text>
            <Text className="text-2xl font-extrabold text-slate-800">{destination?.name || 'Unknown'}</Text>
          </View>
          <View className="bg-indigo-100 p-3 rounded-2xl">
            <IconButton icon="train" iconColor="#4f46e5" size={28} className="m-0" />
          </View>
        </View>

        <Card className="bg-white rounded-3xl mb-6 shadow-sm border border-slate-100" mode="outlined">
          <Card.Content className="py-6">
            <View className="flex-row justify-between mb-8">
              <View className="items-center flex-1">
                <Text className="text-3xl font-extrabold text-indigo-600 mb-1">{remainingKm}<Text className="text-lg"> km</Text></Text>
                <Text className="text-slate-500 font-medium">Remaining</Text>
              </View>
              <View className="w-px bg-slate-200" />
              <View className="items-center flex-1">
                <Text className="text-3xl font-extrabold text-slate-800 mb-1">{speedKmh}<Text className="text-lg"> km/h</Text></Text>
                <Text className="text-slate-500 font-medium">Speed</Text>
              </View>
            </View>
            
            <View className="mb-2">
              <View className="flex-row justify-between mb-2">
                <Text className="text-slate-600 font-semibold">ETA: {etaString}</Text>
                <Text className="text-indigo-600 font-bold">{minsRemaining}</Text>
              </View>
              <ProgressBar progress={0.5} color="#4f46e5" className="h-3 rounded-full bg-slate-100" />
            </View>
          </Card.Content>
        </Card>

        <View className="flex-row items-center bg-slate-100 p-4 rounded-2xl mb-6">
          <IconButton icon={confidenceIcon} iconColor={confidenceColor} size={24} className="m-0 mr-2" />
          <Text className="text-slate-700 font-medium flex-1">{confidenceMsg}</Text>
        </View>

        <Button
          mode="contained"
          buttonColor="#ef4444"
          className="rounded-xl py-2 mt-auto mb-6"
          onPress={() => navigation.navigate('Home')}
        >
          Cancel Journey
        </Button>
      </View>
    </View>
  );
}
