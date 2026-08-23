import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Button, Card, IconButton } from 'react-native-paper';
import {
  SIMULATION_PRESETS,
  JourneySimulator,
  SimulationPreset,
} from '../dev/JourneySimulator';
import { useJourneyStore } from '../store/useJourneyStore';
import { LocationService } from '../services/LocationService';
import AlarmService, { AlarmStage } from '../services/AlarmService';

const WAKE_DISTANCE_OPTIONS = [300, 500, 1000, 2000];

const STAGE_LABELS: Record<AlarmStage, string> = {
  [AlarmStage.NONE]: 'Silent',
  [AlarmStage.JOURNEY_REMINDER]: 'Journey Reminder',
  [AlarmStage.GENTLE_VIBRATION]: 'Gentle Alert',
  [AlarmStage.ALARM]: 'ALARM',
  [AlarmStage.MAXIMUM_ALARM]: 'MAXIMUM ALARM',
  [AlarmStage.EMERGENCY_MODE]: 'EMERGENCY MODE',
};

export function DevSimulatorScreen() {
  const [selectedId, setSelectedId] = useState(SIMULATION_PRESETS[0].id);
  const [wakeDistance, setWakeDistance] = useState(500);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<AlarmStage>(AlarmStage.NONE);
  const [pollingInterval, setPollingInterval] = useState(0);

  const liveStats = useJourneyStore((s) => s.liveStats);

  useEffect(() => {
    const timer = setInterval(() => {
      setRunning(JourneySimulator.isRunning());
      setStage(AlarmService.currentStage);
      setPollingInterval(LocationService.getPollingInterval());
    }, 400);
    return () => clearInterval(timer);
  }, []);

  const handleStart = () => {
    const preset = SIMULATION_PRESETS.find((p) => p.id === selectedId) as SimulationPreset;
    const journeyStore = useJourneyStore.getState();
    journeyStore.setWakeDistance(wakeDistance);
    journeyStore.setTransportMode('transit');

    const destination = JourneySimulator.start(preset);
    journeyStore.setDestination({
      lat: destination.latitude,
      lng: destination.longitude,
      name: `${preset.label} Target`,
    });
    journeyStore.setIsTrackingActive(true);
    setRunning(true);
  };

  const handleStop = () => {
    JourneySimulator.stop();
    AlarmService.stopAll().catch(() => undefined);
    useJourneyStore.getState().resetJourney();
    setRunning(false);
    setStage(AlarmStage.NONE);
  };

  const remainingKm =
    liveStats && liveStats.remainingDistance > 0
      ? (liveStats.remainingDistance / 1000).toFixed(2)
      : '--';
  const speedKmh =
    liveStats && liveStats.currentSpeed > 0
      ? (liveStats.currentSpeed * 3.6).toFixed(0)
      : '0';
  const etaMins =
    liveStats && liveStats.eta > 0
      ? Math.max(0, Math.round((liveStats.eta - Date.now()) / 60000))
      : null;
  const confidence = liveStats ? `${Math.round(liveStats.confidenceScore)}%` : '--';
  const tierLabel =
    liveStats?.confidenceTier === 'high'
      ? 'GOOD'
      : liveStats?.confidenceTier === 'medium'
        ? 'DEGRADED'
        : liveStats?.confidenceTier === 'low'
          ? 'POOR'
          : '--';

  const alarmFired = stage >= AlarmStage.ALARM;

  return (
    <ScrollView className="flex-1 bg-slate-50 p-4">
      <View className="mt-4 mb-6 flex-row items-center justify-between">
        <View>
          <Text className="text-3xl font-extrabold text-slate-800">Journey Simulator</Text>
          <Text className="text-slate-500 mt-1">Dev-only. Feeds synthetic GPS into the real pipeline.</Text>
        </View>
        <IconButton icon="bug-play" iconColor="#4f46e5" size={32} className="m-0" />
      </View>

      <Card
        className={`mb-4 rounded-3xl border ${alarmFired ? 'border-red-300 bg-red-50' : stage === AlarmStage.GENTLE_VIBRATION ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}
        mode="outlined"
      >
        <Card.Content className="py-4">
          <Text className="text-slate-500 font-semibold uppercase tracking-wider text-xs mb-1">Pipeline state</Text>
          <Text
            className={`text-2xl font-extrabold ${alarmFired ? 'text-red-600' : stage === AlarmStage.GENTLE_VIBRATION ? 'text-amber-600' : 'text-slate-800'}`}
          >
            {STAGE_LABELS[stage]}
          </Text>
          <View className="flex-row flex-wrap mt-3">
            <StatChip label="Remaining" value={`${remainingKm} km`} />
            <StatChip label="Speed" value={`${speedKmh} km/h`} />
            <StatChip label="ETA" value={etaMins !== null ? `${etaMins} min` : '--'} />
            <StatChip label={`Confidence (${tierLabel})`} value={confidence} />
            <StatChip label="Polling" value={pollingInterval ? `${pollingInterval / 1000}s` : '--'} />
          </View>
        </Card.Content>
      </Card>

      <Text className="text-lg font-bold text-slate-700 mb-2">Scenario</Text>
      {SIMULATION_PRESETS.map((preset) => (
        <TouchableOpacity key={preset.id} onPress={() => setSelectedId(preset.id)} disabled={running}>
          <Card
            className={`mb-2 rounded-2xl border ${selectedId === preset.id ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white'}`}
            mode="outlined"
          >
            <Card.Content className="py-3 flex-row items-center">
              <IconButton
                icon={selectedId === preset.id ? 'check-circle' : 'circle-outline'}
                iconColor={selectedId === preset.id ? '#4f46e5' : '#94a3b8'}
                size={22}
                className="m-0 mr-2"
              />
              <View className="flex-1">
                <Text className="font-bold text-slate-800">{preset.label}</Text>
                <Text className="text-xs text-slate-500 leading-snug">{preset.description}</Text>
              </View>
            </Card.Content>
          </Card>
        </TouchableOpacity>
      ))}

      <Text className="text-lg font-bold text-slate-700 mb-2 mt-2">Wake Distance</Text>
      <View className="flex-row mb-6">
        {WAKE_DISTANCE_OPTIONS.map((distance) => (
          <TouchableOpacity
            key={distance}
            onPress={() => setWakeDistance(distance)}
            disabled={running}
            className={`flex-1 items-center py-3 mx-1 rounded-xl border ${
              wakeDistance === distance ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-200'
            }`}
          >
            <Text className={`font-bold ${wakeDistance === distance ? 'text-white' : 'text-slate-600'}`}>
              {distance >= 1000 ? `${distance / 1000}km` : `${distance}m`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {running || alarmFired ? (
        <Button mode="contained" buttonColor="#ef4444" className="rounded-xl py-2 mb-8" onPress={handleStop}>
          Stop & Reset
        </Button>
      ) : (
        <Button mode="contained" buttonColor="#4f46e5" className="rounded-xl py-2 mb-8" onPress={handleStart}>
          Start Simulation
        </Button>
      )}
    </ScrollView>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <View className="bg-slate-100 rounded-xl px-3 py-2 mr-2 mb-2">
      <Text className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">{label}</Text>
      <Text className="text-base font-extrabold text-slate-800">{value}</Text>
    </View>
  );
}
