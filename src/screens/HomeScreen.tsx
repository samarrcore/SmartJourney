import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Card, Button, IconButton } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useJourneyStore } from '../store/useJourneyStore';

export function HomeScreen() {
  const navigation = useNavigation<any>();
  const { isTrackingActive, destination, liveStats } = useJourneyStore();

  const activeJourney = isTrackingActive;

  return (
    <ScrollView className="flex-1 bg-slate-50 p-4">
      <View className="mt-8 mb-6">
        <Text className="text-4xl font-extrabold text-slate-800 tracking-tight">SmartJourney</Text>
        <Text className="text-base text-slate-500 mt-1">Your intelligent travel assistant</Text>
      </View>

      {activeJourney ? (
        <Card className="mb-6 rounded-3xl bg-indigo-600 shadow-xl" mode="elevated">
          <Card.Content className="p-6">
            <View className="flex-row items-center justify-between mb-4">
              <View className="bg-indigo-500/50 px-3 py-1 rounded-full">
                <Text className="text-indigo-100 font-semibold text-xs uppercase tracking-wider">Active</Text>
              </View>
              <IconButton icon="navigation" iconColor="white" size={24} className="m-0" />
            </View>
            <Text className="text-3xl font-bold text-white mb-2">{destination?.name || 'Unknown Destination'}</Text>
            <Text className="text-indigo-100 text-lg mb-6">
              Arriving in {liveStats && liveStats.eta > 0 ? Math.max(0, Math.round((new Date(liveStats.eta).getTime() - Date.now()) / 60000)) : '--'} mins
            </Text>
            <Button
              mode="contained"
              buttonColor="white"
              textColor="#4f46e5"
              className="rounded-xl font-bold py-1"
              onPress={() => navigation.navigate('LiveJourney')}
            >
              View Live Journey
            </Button>
          </Card.Content>
        </Card>
      ) : (
        <Card className="mb-6 rounded-3xl shadow-sm border border-slate-200" mode="outlined">
          <Card.Content className="p-8 items-center justify-center min-h-[220px]">
            <View className="bg-indigo-50 p-4 rounded-full mb-4">
              <IconButton icon="map-marker-path" iconColor="#4f46e5" size={40} className="m-0" />
            </View>
            <Text className="text-xl font-bold text-slate-800 mb-2">Ready to travel?</Text>
            <Text className="text-slate-500 text-center mb-6">Set your destination and relax, we'll wake you up when you arrive.</Text>
            <Button
              mode="contained"
              buttonColor="#4f46e5"
              className="rounded-xl w-full py-1"
              onPress={() => navigation.navigate('DestinationSearch')}
            >
              Start New Journey
            </Button>
          </Card.Content>
        </Card>
      )}

      <View className="flex-row justify-between mb-6">
        <TouchableOpacity 
          className="flex-1 bg-white p-4 rounded-2xl mr-2 shadow-sm border border-slate-100 items-center"
          onPress={() => navigation.navigate('PermissionsCenter')}
        >
          <IconButton icon="shield-check" iconColor="#10b981" size={28} className="m-0 mb-2" />
          <Text className="font-semibold text-slate-700">Permissions</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          className="flex-1 bg-white p-4 rounded-2xl ml-2 shadow-sm border border-slate-100 items-center"
          onPress={() => navigation.navigate('Settings')}
        >
          <IconButton icon="cog" iconColor="#64748b" size={28} className="m-0 mb-2" />
          <Text className="font-semibold text-slate-700">Settings</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
