import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList } from 'react-native';
import { IconButton } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import MapView, { Marker } from 'react-native-maps';
import { useJourneyStore } from '../store/useJourneyStore';

export function DestinationSearchScreen() {
  const navigation = useNavigation<any>();
  const { setDestination } = useJourneyStore();
  const [searchQuery, setSearchQuery] = useState('');
  
  const mockResults = [
    { id: '1', title: 'Central Station', subtitle: 'Main St, Downtown', lat: 37.78825, lng: -122.4324 },
    { id: '2', title: 'International Airport', subtitle: 'Terminal 1', lat: 37.6163, lng: -122.3861 },
    { id: '3', title: 'City Library', subtitle: '100 Library Lane', lat: 37.7786, lng: -122.4153 },
  ];

  return (
    <View className="flex-1 bg-white">
      <View className="h-2/5">
        <MapView
          className="flex-1"
          initialRegion={{
            latitude: 37.78825,
            longitude: -122.4324,
            latitudeDelta: 0.0922,
            longitudeDelta: 0.0421,
          }}
        >
          <Marker
            coordinate={{ latitude: 37.78825, longitude: -122.4324 }}
            title="Current Location"
          />
        </MapView>
      </View>
      
      <View className="flex-1 -mt-6 bg-white rounded-t-3xl shadow-lg px-4 pt-6">
        <Text className="text-2xl font-bold text-slate-800 mb-4">Where to?</Text>
        
        <View className="flex-row items-center bg-slate-100 rounded-2xl px-4 py-2 mb-6 border border-slate-200">
          <IconButton icon="magnify" iconColor="#64748b" size={24} className="m-0" />
          <TextInput
            className="flex-1 text-base text-slate-800 ml-2"
            placeholder="Search destination..."
            placeholderTextColor="#94a3b8"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        <FlatList
          data={mockResults}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity 
              className="flex-row items-center py-3 border-b border-slate-100"
              onPress={() => {
                setDestination({ lat: item.lat, lng: item.lng, name: item.title });
                navigation.navigate('JourneySetup');
              }}
            >
              <View className="bg-indigo-50 p-3 rounded-full mr-4">
                <IconButton icon="map-marker" iconColor="#4f46e5" size={20} className="m-0" />
              </View>
              <View className="flex-1">
                <Text className="text-base font-bold text-slate-800">{item.title}</Text>
                <Text className="text-sm text-slate-500">{item.subtitle}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      </View>
    </View>
  );
}
