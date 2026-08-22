import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Button, IconButton } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { useJourneyStore } from '../store/useJourneyStore';
import { SearchService, PlaceResult } from '../services/SearchService';

const DEFAULT_REGION = {
  latitude: 37.78825,
  longitude: -122.4324,
  latitudeDelta: 0.0922,
  longitudeDelta: 0.0421,
};

export function DestinationSearchScreen() {
  const navigation = useNavigation<any>();
  const { setDestination } = useJourneyStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [pinnedLocation, setPinnedLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [mapRegion, setMapRegion] = useState(DEFAULT_REGION);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setMapRegion({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        });
      } catch {
        // Keep default region if the current position is unavailable.
      }
    })();
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const query = searchQuery.trim();
    if (query.length < 2) {
      setResults([]);
      setLoading(false);
      setError(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(false);
      try {
        const places = await SearchService.searchPlaces(query);
        setResults(places);
      } catch {
        setResults([]);
        setError(true);
      } finally {
        setLoading(false);
      }
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  const selectPlace = (place: PlaceResult) => {
    setDestination({ lat: place.lat, lng: place.lng, name: place.title });
    navigation.navigate('JourneySetup');
  };

  const handleUsePin = async () => {
    if (!pinnedLocation) return;
    setLoading(true);
    const place = await SearchService.reverseGeocode(pinnedLocation.lat, pinnedLocation.lng);
    setLoading(false);
    selectPlace(place);
  };

  const renderListContent = () => {
    if (loading) {
      return (
        <View className="items-center py-8">
          <ActivityIndicator size="large" color="#4f46e5" />
          <Text className="text-slate-500 mt-3">Searching places...</Text>
        </View>
      );
    }

    if (error) {
      return (
        <View className="items-center py-8">
          <IconButton icon="wifi-off" iconColor="#ef4444" size={32} />
          <Text className="text-slate-500 text-center px-6">
            Could not search right now. Check your connection and try again.
          </Text>
        </View>
      );
    }

    if (searchQuery.trim().length >= 2 && results.length === 0) {
      return (
        <View className="items-center py-8">
          <IconButton icon="map-search" iconColor="#94a3b8" size={32} />
          <Text className="text-slate-500">No places found for this search.</Text>
        </View>
      );
    }

    return (
      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            className="flex-row items-center py-3 border-b border-slate-100"
            onPress={() => selectPlace(item)}
          >
            <View className="bg-indigo-50 p-3 rounded-full mr-4">
              <IconButton icon="map-marker" iconColor="#4f46e5" size={20} className="m-0" />
            </View>
            <View className="flex-1">
              <Text className="text-base font-bold text-slate-800">{item.title}</Text>
              <Text className="text-sm text-slate-500" numberOfLines={1}>
                {item.subtitle}
              </Text>
            </View>
          </TouchableOpacity>
        )}
      />
    );
  };

  return (
    <View className="flex-1 bg-white">
      <View className="h-2/5">
        <MapView
          className="flex-1"
          region={mapRegion}
          onPress={({ nativeEvent }) => {
            if (nativeEvent.coordinate) {
              setPinnedLocation({
                lat: nativeEvent.coordinate.latitude,
                lng: nativeEvent.coordinate.longitude,
              });
            }
          }}
        >
          {mapRegion !== DEFAULT_REGION && (
            <Marker coordinate={{ latitude: mapRegion.latitude, longitude: mapRegion.longitude }} title="Current Location" pinColor="#4f46e5" />
          )}
          {pinnedLocation && (
            <Marker
              coordinate={{ latitude: pinnedLocation.lat, longitude: pinnedLocation.lng }}
              title="Selected Destination"
              pinColor="#ef4444"
            />
          )}
        </MapView>
      </View>

      <View className="flex-1 -mt-6 bg-white rounded-t-3xl shadow-lg px-4 pt-6">
        <Text className="text-2xl font-bold text-slate-800 mb-4">Where to?</Text>

        <View className="flex-row items-center bg-slate-100 rounded-2xl px-4 py-2 mb-3 border border-slate-200">
          <IconButton icon="magnify" iconColor="#64748b" size={24} className="m-0" />
          <TextInput
            className="flex-1 text-base text-slate-800 ml-2"
            placeholder="Search destination..."
            placeholderTextColor="#94a3b8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <IconButton icon="close" iconColor="#94a3b8" size={20} className="m-0" onPress={() => setSearchQuery('')} />
          )}
        </View>

        {pinnedLocation && (
          <Button
            mode="contained"
            buttonColor="#4f46e5"
            icon="map-marker-check"
            className="rounded-xl mb-2"
            onPress={handleUsePin}
          >
            Use Pinned Location ({pinnedLocation.lat.toFixed(3)}, {pinnedLocation.lng.toFixed(3)})
          </Button>
        )}

        {renderListContent()}
      </View>
    </View>
  );
}
