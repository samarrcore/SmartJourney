import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { Button, Card, IconButton } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import notifee, { AuthorizationStatus } from '@notifee/react-native';
import { useJourneyStore } from '../store/useJourneyStore';

type TriState = boolean | null;

interface PermissionSnapshot {
  locationServices: TriState;
  foreground: Location.PermissionStatus | null;
  background: Location.PermissionStatus | null;
  notifications: TriState;
  batteryOptimization: TriState;
}

const INITIAL_SNAPSHOT: PermissionSnapshot = {
  locationServices: null,
  foreground: null,
  background: null,
  notifications: null,
  batteryOptimization: null,
};

async function loadSnapshot(): Promise<PermissionSnapshot> {
  const snapshot: PermissionSnapshot = { ...INITIAL_SNAPSHOT };

  try {
    snapshot.locationServices = await Location.hasServicesEnabledAsync();
  } catch {
    snapshot.locationServices = null;
  }
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    snapshot.foreground = fg.status;
  } catch {
    snapshot.foreground = null;
  }
  try {
    const bg = await Location.getBackgroundPermissionsAsync();
    snapshot.background = bg.status;
  } catch {
    snapshot.background = null;
  }
  try {
    const settings = await notifee.getNotificationSettings();
    snapshot.notifications = settings.authorizationStatus === AuthorizationStatus.AUTHORIZED;
  } catch {
    snapshot.notifications = null;
  }
  try {
    snapshot.batteryOptimization = await notifee.isBatteryOptimizationEnabled();
  } catch {
    snapshot.batteryOptimization = null;
  }

  return snapshot;
}

export function PermissionsCenterScreen() {
  const [snapshot, setSnapshot] = useState<PermissionSnapshot>(INITIAL_SNAPSHOT);
  const [busy, setBusy] = useState<string | null>(null);
  const { isTrackingActive, trackingInterrupted } = useJourneyStore();

  const refresh = useCallback(() => {
    let active = true;
    loadSnapshot().then((next) => {
      if (active) setSnapshot(next);
    });
    return () => {
      active = false;
    };
  }, []);

  useFocusEffect(refresh);

  const runAction = async (id: string, action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(id);
    try {
      await action();
    } catch {
      Alert.alert('Error', 'The system settings could not be opened. Please try again.');
    } finally {
      setBusy(null);
      const next = await loadSnapshot();
      setSnapshot(next);
    }
  };

  const requestForeground = () =>
    runAction('foreground', () => Location.requestForegroundPermissionsAsync());

  const requestBackground = () => {
    Alert.alert(
      'Background Location',
      'SmartJourney needs "Allow all the time" location access to keep watching your position while the screen is off. Android will show a separate confirmation after this step.',
      [
        { text: 'Not Now', style: 'cancel' },
        {
          text: 'Continue',
          onPress: () =>
            runAction('background', async () => {
              const result = await Location.requestBackgroundPermissionsAsync();
              if (!result.granted && !result.canAskAgain) {
                Alert.alert(
                  'Manual Step Required',
                  'Android no longer shows the dialog for this permission. Open Settings, then Apps, SmartJourney, Permissions, Location and select "Allow all the time".'
                );
              }
            }),
        },
      ]
    );
  };

  const requestNotifications = () =>
    runAction('notifications', () => notifee.requestPermission());

  const openBatterySettings = () => {
    Alert.alert(
      'Battery Optimization',
      'Android may stop SmartJourney in the background to save power. Excluding SmartJourney from battery optimization keeps the travel alarm alive during long journeys.',
      [
        { text: 'Not Now', style: 'cancel' },
        {
          text: 'Open Settings',
          onPress: () => runAction('battery', () => notifee.openPowerManagerSettings()),
        },
      ]
    );
  };

  const foregroundGranted = snapshot.foreground === Location.PermissionStatus.GRANTED;
  const backgroundGranted = snapshot.background === Location.PermissionStatus.GRANTED;
  const allClear =
    snapshot.locationServices === true &&
    foregroundGranted &&
    backgroundGranted &&
    snapshot.notifications === true &&
    snapshot.batteryOptimization === false;

  const readiness = (() => {
    if (allClear) return { label: 'ALARM READY', color: '#059669', bg: 'bg-emerald-50 border-emerald-200', icon: 'shield-check', iconColor: '#059669' };
    if (
      snapshot.locationServices === false ||
      (snapshot.locationServices !== null && !foregroundGranted)
    ) {
      return { label: 'ALARM NOT READY', color: '#ef4444', bg: 'bg-red-50 border-red-200', icon: 'shield-alert', iconColor: '#ef4444' };
    }
    return { label: 'ALARM AT RISK', color: '#d97706', bg: 'bg-amber-50 border-amber-200', icon: 'shield-half-full', iconColor: '#d97706' };
  })();

  return (
    <ScrollView className="flex-1 bg-slate-50 p-6">
      <View className="mb-6 mt-4">
        <View className="bg-indigo-100 self-start p-4 rounded-full mb-4">
          <IconButton icon="shield-lock" iconColor="#4f46e5" size={40} className="m-0" />
        </View>
        <Text className="text-3xl font-extrabold text-slate-800 mb-2">Permissions</Text>
        <Text className="text-slate-500 text-base leading-relaxed">
          SmartJourney needs these to wake you up reliably. Each status below is read
          live from your device.
        </Text>
      </View>

      <Card className={`mb-6 rounded-3xl border ${readiness.bg}`} mode="outlined">
        <Card.Content className="flex-row items-center">
          <IconButton icon={readiness.icon} iconColor={readiness.iconColor} size={30} className="m-0 mr-2" />
          <View className="flex-1">
            <Text className="text-lg font-extrabold" style={{ color: readiness.color }}>
              {readiness.label}
            </Text>
            <Text className="text-slate-600 text-sm">
              {allClear
                ? 'Every requirement is met. Your alarm can fire with the screen locked.'
                : 'Fix the items below to make your travel alarm dependable.'}
            </Text>
          </View>
        </Card.Content>
      </Card>

      <PermissionRow
        icon="gps-fixed"
        title="Location Services"
        description="Device-level GPS must be switched on."
        state={snapshot.locationServices === null ? 'unknown' : snapshot.locationServices ? 'granted' : 'critical'}
        statusText={snapshot.locationServices === null ? 'Unknown' : snapshot.locationServices ? 'On' : 'Off'}
        actionLabel={null}
      />

      <PermissionRow
        icon="crosshairs-gps"
        title="Precise Location"
        description="Needed to measure your distance to the destination."
        state={snapshot.foreground === null ? 'unknown' : foregroundGranted ? 'granted' : 'action'}
        statusText={
          snapshot.foreground === null
            ? 'Unknown'
            : foregroundGranted
              ? 'Granted'
              : snapshot.foreground === Location.PermissionStatus.DENIED
                ? 'Denied'
                : 'Not requested'
        }
        actionLabel={foregroundGranted ? null : 'Grant Permission'}
        onAction={requestForeground}
        busy={busy === 'foreground'}
      />

      <PermissionRow
        icon="map-marker-radius"
        title="Background Location"
        description='Allows tracking with the screen off. Requires "Allow all the time".'
        state={snapshot.background === null ? 'unknown' : backgroundGranted ? 'granted' : 'action'}
        statusText={
          snapshot.background === null
            ? 'Unknown'
            : backgroundGranted
              ? 'Granted'
              : !foregroundGranted
                ? 'Grant precise location first'
                : snapshot.background === Location.PermissionStatus.DENIED
                  ? 'Denied'
                  : 'Not requested'
        }
        actionLabel={!foregroundGranted || backgroundGranted ? null : 'Grant Permission'}
        onAction={requestBackground}
        busy={busy === 'background'}
      />

      <PermissionRow
        icon="bell-ring"
        title="Notifications"
        description="Alarms, approach alerts and the tracking indicator use notifications."
        state={snapshot.notifications === null ? 'unknown' : snapshot.notifications ? 'granted' : 'action'}
        statusText={snapshot.notifications === null ? 'Unknown' : snapshot.notifications ? 'Granted' : 'Denied'}
        actionLabel={snapshot.notifications ? null : 'Grant Permission'}
        onAction={requestNotifications}
        busy={busy === 'notifications'}
      />

      <PermissionRow
        icon="battery-heart"
        title="Battery Optimization"
        description="Excluding SmartJourney stops Android from killing tracking to save power."
        state={snapshot.batteryOptimization === null ? 'unknown' : snapshot.batteryOptimization ? 'action' : 'granted'}
        statusText={
          snapshot.batteryOptimization === null
            ? 'Unknown'
            : snapshot.batteryOptimization
              ? 'Optimized (tracking at risk)'
              : 'Excluded (unrestricted)'
        }
        actionLabel={snapshot.batteryOptimization ? 'Exclude App' : null}
        onAction={openBatterySettings}
        busy={busy === 'battery'}
      />

      <PermissionRow
        icon="radar"
        title="Tracking Status"
        description="Whether SmartJourney is currently monitoring a journey."
        state={trackingInterrupted ? 'action' : isTrackingActive ? 'granted' : 'unknown'}
        statusText={trackingInterrupted ? 'Interrupted - resume from Home' : isTrackingActive ? 'Active' : 'No active journey'}
        actionLabel={null}
      />
    </ScrollView>
  );
}

interface PermissionRowProps {
  icon: string;
  title: string;
  description: string;
  state: 'granted' | 'action' | 'critical' | 'unknown';
  statusText: string;
  actionLabel: string | null;
  onAction?: () => void;
  busy?: boolean;
}

function PermissionRow({
  icon,
  title,
  description,
  state,
  statusText,
  actionLabel,
  onAction,
  busy,
}: PermissionRowProps) {
  const palette = {
    granted: { border: 'border-emerald-200', bg: 'bg-emerald-50', icon: 'check-circle', color: '#059669', statusColor: 'text-emerald-700' },
    action: { border: 'border-amber-200', bg: 'bg-amber-50', icon: 'alert-circle', color: '#d97706', statusColor: 'text-amber-700' },
    critical: { border: 'border-red-200', bg: 'bg-red-50', icon: 'close-circle', color: '#ef4444', statusColor: 'text-red-700' },
    unknown: { border: 'border-slate-200', bg: 'bg-white', icon: 'help-circle', color: '#94a3b8', statusColor: 'text-slate-500' },
  }[state];

  return (
    <Card className={`mb-4 rounded-3xl border ${palette.border} ${palette.bg}`} mode="outlined">
      <Card.Content>
        <View className="flex-row items-center mb-3">
          <View className="p-3 rounded-full mr-4" style={{ backgroundColor: `${palette.color}22` }}>
            <IconButton icon={icon} iconColor={palette.color} size={24} className="m-0" />
          </View>
          <View className="flex-1">
            <Text className="text-lg font-bold text-slate-800 mb-1">{title}</Text>
            <Text className={`font-medium text-sm ${palette.statusColor}`}>{statusText}</Text>
          </View>
          <IconButton icon={palette.icon} iconColor={palette.color} size={28} className="m-0" />
        </View>
        <Text className="text-slate-600 text-sm mb-3 leading-relaxed">{description}</Text>
        {actionLabel && onAction && (
          <Button
            mode="contained"
            buttonColor={palette.color}
            loading={busy}
            disabled={busy}
            className="rounded-xl"
            onPress={onAction}
          >
            {actionLabel}
          </Button>
        )}
      </Card.Content>
    </Card>
  );
}
