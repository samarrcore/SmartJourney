import React from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { Card, Button, IconButton } from 'react-native-paper';
import { useHistoryStore } from '../store/useHistoryStore';
import { TransportMode } from '../store/useJourneyStore';

const transportIcons: Record<TransportMode, string> = {
  driving: 'car',
  walking: 'walk',
  transit: 'train',
  cycling: 'bike',
};

export function HistoryScreen() {
  const { journeys, clearHistory } = useHistoryStore();

  const handleClearHistory = () => {
    Alert.alert('Clear History', 'Delete all journey records?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => clearHistory() },
    ]);
  };

  return (
    <ScrollView className="flex-1 bg-slate-50 p-4">
      <View className="mt-8 mb-6">
        <Text className="text-3xl font-extrabold text-slate-800 tracking-tight">Journey History</Text>
      </View>

      {journeys.length === 0 ? (
        <Card className="rounded-3xl border border-slate-200" mode="outlined">
          <Card.Content className="p-8 items-center justify-center">
            <View className="bg-slate-50 p-4 rounded-full mb-4">
              <IconButton icon="map-marker-path" iconColor="#94a3b8" size={40} className="m-0" />
            </View>
            <Text className="text-xl font-bold text-slate-800 mb-2">No journeys yet</Text>
            <Text className="text-slate-500 text-center">Completed trips will appear here.</Text>
          </Card.Content>
        </Card>
      ) : (
        <>
          {journeys.map((item) => {
          const dateLabel = new Date(item.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          const durationMins = item.endedAt >= item.startedAt ? Math.round((item.endedAt - item.startedAt) / 60000) : null;
          const wakeKm = (item.wakeDistance / 1000).toFixed(1);
          const badgeClasses = item.outcome === 'completed'
            ? 'bg-emerald-50 border border-emerald-200'
            : 'bg-slate-100 border border-slate-200';
          const badgeTextClasses = item.outcome === 'completed' ? 'text-emerald-700' : 'text-slate-500';

          return (
            <Card key={item.id} className="mb-3 rounded-3xl border border-slate-200" mode="outlined">
              <Card.Content className="p-4">
                <View className="flex-row items-start justify-between mb-3">
                  <View className="flex-1 mr-2">
                    <Text className="text-lg font-bold text-slate-800">{item.destinationName}</Text>
                    <Text className="text-sm text-slate-500 mt-1">{dateLabel}</Text>
                  </View>
                  <IconButton icon={transportIcons[item.transportMode]} iconColor="#4f46e5" size={24} className="m-0" />
                </View>
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center flex-wrap">
                    <Text className="text-sm font-semibold text-slate-700">
                      {durationMins !== null ? `${durationMins} min` : '--'}
                    </Text>
                    <Text className="text-slate-300 mx-2">|</Text>
                    <Text className="text-sm font-semibold text-slate-700">{wakeKm} km</Text>
                  </View>
                  <View className={`${badgeClasses} px-3 py-1 rounded-full`}>
                    <Text className={`text-xs font-semibold ${badgeTextClasses}`}>
                      {item.outcome === 'completed' ? 'Completed' : 'Cancelled'}
                    </Text>
                  </View>
                </View>
              </Card.Content>
            </Card>
          );
          })}
        </>
      )}

      {journeys.length > 0 && (
        <Button mode="text" textColor="#ef4444" className="mt-2 self-end" onPress={handleClearHistory}>
          Clear History
        </Button>
      )}
    </ScrollView>
  );
}
