import * as Location from 'expo-location';
import { Coordinates } from '../engine/PredictionEngine';
import { LocationService } from '../services/LocationService';
import { useJourneyStore } from '../store/useJourneyStore';

export interface SimulationPreset {
  id: string;
  label: string;
  description: string;
  distanceKm: number;
  speedMps: number;
  accuracyM: number;
  timeScale: number;
  /** Remaining distance at which fixes stop arriving for blackoutTicks. */
  gpsBlackoutAfterKm?: number;
  gpsBlackoutTicks?: number;
  /** Severe degradation (250 m accuracy, no speed) within this range. */
  driftNearArrivalM?: number;
  /** Freezes the vehicle (speed 0) for stationaryTicks once within range. */
  stationaryAfterKm?: number;
  stationaryTicks?: number;
}

export const SIMULATION_PRESETS: SimulationPreset[] = [
  {
    id: 'highway',
    label: 'Highway Approach',
    description: '5 km transit leg at ~80 km/h, good GPS (8 m). Reaches the wake radius and fires the alarm.',
    distanceKm: 5,
    speedMps: 22,
    accuracyM: 8,
    timeScale: 30,
  },
  {
    id: 'degraded',
    label: 'Degraded GPS Approach',
    description: 'Same journey with 45 m accuracy. Confidence drops but the alarm still fires.',
    distanceKm: 5,
    speedMps: 22,
    accuracyM: 45,
    timeScale: 30,
  },
  {
    id: 'drift-spike',
    label: 'GPS Drift Near Arrival',
    description: 'Accuracy collapses near the destination, pushing confidence to POOR. Verifies the double-confirmation guard still lets the alarm fire.',
    distanceKm: 5,
    speedMps: 22,
    accuracyM: 8,
    timeScale: 30,
    driftNearArrivalM: 1500,
  },
  {
    id: 'blackout',
    label: 'GPS Blackout + Recovery',
    description: 'Fixes vanish mid-journey while the vehicle keeps moving, then recover. Tracking must survive the gap.',
    distanceKm: 5,
    speedMps: 22,
    accuracyM: 8,
    timeScale: 30,
    gpsBlackoutAfterKm: 3,
    gpsBlackoutTicks: 12,
  },
  {
    id: 'stationary',
    label: 'Stationary Vehicle',
    description: 'Vehicle halts inside the last kilometre, then resumes. ETA pauses and confidence holds.',
    distanceKm: 5,
    speedMps: 22,
    accuracyM: 8,
    timeScale: 30,
    stationaryAfterKm: 1,
    stationaryTicks: 15,
  },
];

const FIX_INTERVAL_MS = 1000;
const ORIGIN = { latitude: 48.1374, longitude: 11.5755 };

interface SimulationState {
  timer: ReturnType<typeof setInterval> | null;
  fraction: number;
  totalMeters: number;
  destination: Coordinates;
  preset: SimulationPreset;
  blackoutTicksLeft: number;
  blackoutDone: boolean;
  stationaryTicksLeft: number;
  stationaryDone: boolean;
}

let active: SimulationState | null = null;

function offsetDestination(distanceKm: number): Coordinates {
  return {
    latitude: ORIGIN.latitude + distanceKm / 111.32,
    longitude: ORIGIN.longitude,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function advance(state: SimulationState): void {
  const stepMeters =
    state.preset.speedMps * (FIX_INTERVAL_MS / 1000) * state.preset.timeScale;
  state.fraction = Math.min(
    1,
    state.fraction + stepMeters / state.totalMeters
  );
}

function stopInternal(): void {
  if (active?.timer) clearInterval(active.timer);
  active = null;
}

function tick(): void {
  if (!active) return;
  const state = active;
  const wakeDistance = useJourneyStore.getState().wakeDistance;
  const remaining = state.totalMeters * (1 - state.fraction);

  let speed: number | null = state.preset.speedMps;
  let accuracy = state.preset.accuracyM;
  let drift = 0;
  let advancePosition = true;

  if (!state.blackoutDone) {
    if (
      state.preset.gpsBlackoutAfterKm !== undefined &&
      state.blackoutTicksLeft === 0 &&
      remaining <= state.preset.gpsBlackoutAfterKm * 1000
    ) {
      state.blackoutTicksLeft = state.preset.gpsBlackoutTicks ?? 10;
    }
    if (state.blackoutTicksLeft > 0) {
      state.blackoutTicksLeft -= 1;
      if (state.blackoutTicksLeft === 0) state.blackoutDone = true;
      advance(state);
      return;
    }
  }

  if (
    !state.stationaryDone &&
    state.preset.stationaryAfterKm !== undefined &&
    state.stationaryTicksLeft === 0 &&
    remaining <= state.preset.stationaryAfterKm * 1000
  ) {
    state.stationaryTicksLeft = state.preset.stationaryTicks ?? 10;
  }
  if (state.stationaryTicksLeft > 0) {
    state.stationaryTicksLeft -= 1;
    if (state.stationaryTicksLeft === 0) state.stationaryDone = true;
    speed = 0;
    advancePosition = false;
  }

  if (
    state.preset.driftNearArrivalM !== undefined &&
    remaining <= state.preset.driftNearArrivalM
  ) {
    accuracy = 250;
    speed = null;
    drift = 0.004;
  }

  const latitude = lerp(
    ORIGIN.latitude,
    state.destination.latitude,
    state.fraction
  );
  const longitude = lerp(
    ORIGIN.longitude,
    state.destination.longitude,
    state.fraction
  );

  LocationService.ingestLocation({
    coords: {
      latitude: latitude + drift,
      longitude: longitude - drift,
      altitude: null,
      accuracy,
      altitudeAccuracy: null,
      heading: null,
      speed,
    },
    timestamp: Date.now(),
  });

  if (remaining <= wakeDistance) {
    // Arrival flow stops tracking asynchronously; hold position until it
    // does so every in-range fix reaches the alarm evaluation.
    if (!LocationService.getIsTracking()) stopInternal();
    return;
  }

  if (advancePosition) advance(state);
}

export const JourneySimulator = {
  isRunning(): boolean {
    return active !== null;
  },

  start(preset: SimulationPreset): Coordinates {
    JourneySimulator.stop();

    const destination = offsetDestination(preset.distanceKm);
    LocationService.beginSimulatedJourney({ destination });

    active = {
      timer: null,
      fraction: 0,
      totalMeters: preset.distanceKm * 1000,
      destination,
      preset,
      blackoutTicksLeft: 0,
      blackoutDone: preset.gpsBlackoutAfterKm === undefined,
      stationaryTicksLeft: 0,
      stationaryDone: preset.stationaryAfterKm === undefined,
    };
    active.timer = setInterval(tick, FIX_INTERVAL_MS);

    return destination;
  },

  stop(): void {
    stopInternal();
    if (LocationService.isSimulating()) {
      LocationService.endSimulatedJourney();
    }
  },
};
