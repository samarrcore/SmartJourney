import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Button, Card, IconButton } from 'react-native-paper';

export function PermissionsCenterScreen() {
  return (
    <ScrollView className="flex-1 bg-slate-50 p-6">
      <View className="mb-6 mt-4">
        <View className="bg-indigo-100 self-start p-4 rounded-full mb-4">
          <IconButton icon="shield-lock" iconColor="#4f46e5" size={40} className="m-0" />
        </View>
        <Text className="text-3xl font-extrabold text-slate-800 mb-2">Permissions</Text>
        <Text className="text-slate-500 text-base leading-relaxed">
          SmartJourney needs certain permissions to wake you up reliably. You can manage them below.
        </Text>
      </View>

      <Card className="mb-4 rounded-3xl border border-emerald-200 bg-emerald-50" mode="outlined">
        <Card.Content className="flex-row items-center">
          <View className="bg-emerald-100 p-3 rounded-full mr-4">
            <IconButton icon="crosshairs-gps" iconColor="#059669" size={24} className="m-0" />
          </View>
          <View className="flex-1">
            <Text className="text-lg font-bold text-slate-800 mb-1">Foreground Location</Text>
            <Text className="text-emerald-700 font-medium text-sm">Granted</Text>
          </View>
          <IconButton icon="check-circle" iconColor="#059669" size={28} className="m-0" />
        </Card.Content>
      </Card>

      <Card className="mb-4 rounded-3xl border border-amber-200 bg-amber-50" mode="outlined">
        <Card.Content>
          <View className="flex-row items-center mb-4">
            <View className="bg-amber-100 p-3 rounded-full mr-4">
              <IconButton icon="map-marker-radius" iconColor="#d97706" size={24} className="m-0" />
            </View>
            <View className="flex-1">
              <Text className="text-lg font-bold text-slate-800 mb-1">Background Location</Text>
              <Text className="text-amber-700 font-medium text-sm">Required for tracking</Text>
            </View>
          </View>
          <Text className="text-slate-600 text-sm mb-4 leading-relaxed">
            Allows the app to monitor your location even when your screen is off, so you don't miss your stop.
          </Text>
          <Button mode="contained" buttonColor="#d97706" className="rounded-xl">
            Grant Permission
          </Button>
        </Card.Content>
      </Card>

      <Card className="mb-4 rounded-3xl border border-amber-200 bg-amber-50" mode="outlined">
        <Card.Content>
          <View className="flex-row items-center mb-4">
            <View className="bg-amber-100 p-3 rounded-full mr-4">
              <IconButton icon="bell-ring" iconColor="#d97706" size={24} className="m-0" />
            </View>
            <View className="flex-1">
              <Text className="text-lg font-bold text-slate-800 mb-1">Notifications</Text>
              <Text className="text-amber-700 font-medium text-sm">Required for alarms</Text>
            </View>
          </View>
          <Text className="text-slate-600 text-sm mb-4 leading-relaxed">
            Allows the app to play alarm sounds and show heads-up notifications when you arrive.
          </Text>
          <Button mode="contained" buttonColor="#d97706" className="rounded-xl">
            Grant Permission
          </Button>
        </Card.Content>
      </Card>

    </ScrollView>
  );
}
