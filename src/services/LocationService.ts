import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import * as TaskManager from 'expo-task-manager';
import { PredictionEngine, Coordinates } from '../engine/PredictionEngine';
import {
  ConfidenceEngine,
  ConfidenceLevel,
  ConfidenceInputs,
} from '../engine/ConfidenceEngine';
import { useJourneyStore } from '../store/useJourneyStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useHistoryStore } from '../store/useHistoryStore';
import AlarmService, { AlarmStage } from './AlarmService';

export const BACKGROUND_LOCATION_TASK = 'BACKGROUND_LOCATION_TASK';

/** Outcome of startup reconciliation between persisted journey and native state. */
export type RecoveryStatus = 'idle' | 'recovered' | 'interrupted';

/** Result of an explicit user-requested resume after an interruption. */
export type ResumeStatus = 'resumed' | 'missing_permissions' | 'no_journey';

/** Readings kept for movement-consistency analysis in the ConfidenceEngine. */
const SPEED_HISTORY_SIZE = 5;

/**
 * How many consecutive in-range readings are required before firing the
 * alarm when confidence is POOR (GPS drift / false-positive protection).
 */
const LOW_CONFIDENCE_CONFIRMATIONS = 2;

/** Fallback polling config used when the native config is unknown. */
const DEFAULT_INTERVAL_MS = 10000;
const DEFAULT_DISTANCE_M = 10;

export interface LocationUpdateListener {
  (
    location: Location.LocationObject,
    distance: number,
    eta: number | null,
    confidence: ConfidenceLevel
  ): void;
}

interface TrackingOptions {
  destination: Coordinates;
  interval?: number;
  distanceInterval?: number;
}

export class LocationService {
  private static isTracking = false;
  private static currentInterval = 10000;
  private static destination: Coordinates | null = null;
  private static listeners: LocationUpdateListener[] = [];

  /** True once permissions have been verified in this session. */
  private static permissionsVerified = false;

  /** Guards against overlapping adaptive restarts. */
  private static restartPromise: Promise<void> | null = null;

  /** Ensures startup reconciliation runs once and can be awaited by startTracking. */
  private static recoveryPromise: Promise<RecoveryStatus> | null = null;

  /** How often the watchdog verifies native tracking survived while a journey is active. */
  private static readonly WATCHDOG_INTERVAL_MS = 60_000;
  private static watchdogTimer: ReturnType<typeof setInterval> | null = null;

  // Battery cache - refreshed at most once per minute to keep the task cheap.
  private static batteryLevel: number | null = null;
  private static batteryCharging = false;
  private static lastBatteryCheck = 0;

  private static journeyStartedAt = 0;

  // Per-journey flags.
  private static speedHistory: (number | null)[] = [];
  private static hasTriggeredGentleAlert = false;
  private static inRangeConfirmations = 0;

  /**
   * Initializes the location task manager.
   * Must be called in the global scope (App.tsx) outside any React component
   * so it is registered as early as possible.
   */
  public static initializeTaskManager() {
    TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
      if (error) {
        console.error('Background Location Task Error:', error);
        return;
      }
      if (data) {
        const { locations } = data as { locations: Location.LocationObject[] };
        if (locations && locations.length > 0) {
          const latestLocation = locations[locations.length - 1];
          this.handleLocationUpdate(latestLocation);
        }
      }
    });
  }

  public static addListener(listener: LocationUpdateListener) {
    this.listeners.push(listener);
  }

  public static removeListener(listener: LocationUpdateListener) {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  public static getIsTracking(): boolean {
    return this.isTracking;
  }

  /**
   * Internal handler for new locations coming from the background task.
   */
  private static async handleLocationUpdate(location: Location.LocationObject) {
    const storeState = useJourneyStore.getState();
    const wakeDistance = storeState.wakeDistance;

    this.pushSpeed(location.coords.speed);
    await this.refreshBattery();

    const confidenceInputs: ConfidenceInputs = {
      accuracy: location.coords.accuracy ?? null,
      speed: location.coords.speed ?? null,
      readingTimestamp: location.timestamp,
      recentSpeeds: this.speedHistory.slice(0, -1),
      transportMode: storeState.transportMode,
      batteryLevel: this.batteryLevel,
      isCharging: this.batteryCharging,
    };
    const confidenceResult = ConfidenceEngine.evaluate(confidenceInputs);

    let distance = 0;
    let eta: number | null = null;

    if (this.destination && this.isTracking) {
      const currentCoords: Coordinates = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };

      const prediction = PredictionEngine.predict(
        currentCoords,
        this.destination,
        location.coords.speed
      );

      distance = prediction.remainingDistanceMeters;
      eta = prediction.etaSeconds;

      useJourneyStore.getState().setLiveStats({
        currentSpeed: location.coords.speed || 0,
        remainingDistance: distance,
        confidenceTier: this.tierFromLevel(confidenceResult.level),
        confidenceScore: confidenceResult.score,
        eta: eta !== null ? Date.now() + eta * 1000 : 0,
        batteryLevel: this.batteryLevel,
      });

      this.evaluateAlarms(distance, wakeDistance, confidenceResult.level);
      void this.adaptPollingInterval(distance);
    }

    this.listeners.forEach((listener) =>
      listener(location, distance, eta, confidenceResult.level)
    );
  }

  /**
   * Multi-stage alarm decision (PRD section 13):
   * distance + confidence + confirmation count decide when alarms fire.
   * Stage escalation beyond stage 3 is handled inside AlarmService via timers.
   */
  private static evaluateAlarms(
    distance: number,
    wakeDistance: number,
    level: ConfidenceLevel
  ) {
    if (distance <= wakeDistance) {
      // False-positive protection: with poor confidence require multiple
      // consecutive readings inside the wake radius before alarming.
      if (level === ConfidenceLevel.POOR) {
        this.inRangeConfirmations += 1;
        if (this.inRangeConfirmations < LOW_CONFIDENCE_CONFIRMATIONS) {
          return;
        }
      }

      this.triggerArrivalFlow(wakeDistance);
    } else {
      this.inRangeConfirmations = 0;

      if (
        !this.hasTriggeredGentleAlert &&
        distance <= wakeDistance * 1.5 &&
        AlarmService.currentStage < AlarmStage.GENTLE_VIBRATION
      ) {
        this.hasTriggeredGentleAlert = true;
        AlarmService.triggerGentleAlert().catch(console.error);
      }
    }
  }

  /** Fires the full alarm, records the completed journey and stops tracking. */
  private static triggerArrivalFlow(wakeDistance: number) {
    const journey = useJourneyStore.getState();

    if (journey.destination) {
      useHistoryStore.getState().recordJourney({
        destinationName: journey.destination.name || 'Unknown Destination',
        lat: journey.destination.lat,
        lng: journey.destination.lng,
        transportMode: journey.transportMode,
        wakeDistance,
        startedAt: this.journeyStartedAt || Date.now(),
        endedAt: Date.now(),
        outcome: 'completed',
      });
    }

    journey.setIsTrackingActive(false);
    AlarmService.triggerAlarm().catch(console.error);

    // Tracking can stop now - the AlarmService keeps escalating until dismissed.
    this.stopTracking().catch(console.error);
  }

  /**
   * Reads the device power state into the cache. Throttled to one native
   * call per minute; failures keep the previous cached values.
   */
  private static async refreshBattery(force = false) {
    const now = Date.now();
    if (!force && now - this.lastBatteryCheck < 60_000) return;
    this.lastBatteryCheck = now;

    try {
      const [state, level] = await Promise.all([
        Battery.getBatteryStateAsync(),
        Battery.getBatteryLevelAsync(),
      ]);
      this.batteryLevel = level >= 0 ? level : null;
      this.batteryCharging =
        state === Battery.BatteryState.CHARGING ||
        state === Battery.BatteryState.FULL;
    } catch (error) {
      console.error('Battery read failed:', error);
    }
  }

  private static pushSpeed(speed: number | null) {
    this.speedHistory.unshift(speed ?? null);
    if (this.speedHistory.length > SPEED_HISTORY_SIZE + 1) {
      this.speedHistory.pop();
    }
  }

  private static tierFromLevel(level: ConfidenceLevel): 'high' | 'medium' | 'low' {
    switch (level) {
      case ConfidenceLevel.GOOD:
        return 'high';
      case ConfidenceLevel.DEGRADED:
        return 'medium';
      default:
        return 'low';
    }
  }

  /**
   * Requests foreground and background location permissions.
   * Safe to call repeatedly - already-granted permissions resolve instantly.
   */
  public static async requestPermissions(): Promise<boolean> {
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== 'granted') return false;

    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
    if (bgStatus === 'granted') {
      this.permissionsVerified = true;
    }
    return bgStatus === 'granted';
  }

  /**
   * Starts tracking location in the background and foreground.
   */
  public static async startTracking(options: TrackingOptions) {
    const { destination, interval = 10000, distanceInterval = 10 } = options;

    if (this.recoveryPromise) {
      await this.recoveryPromise;
    }

    if (!this.permissionsVerified) {
      const hasPermission = await this.requestPermissions();
      if (!hasPermission) {
        throw new Error('Location permissions not granted');
      }
    }

    this.destination = destination;
    this.speedHistory = [];
    this.hasTriggeredGentleAlert = false;
    this.inRangeConfirmations = 0;
    this.journeyStartedAt = Date.now();

    const store = useJourneyStore.getState();
    store.setStartedAt(this.journeyStartedAt);
    store.setTrackingInterrupted(false);

    void this.refreshBattery(true);

    await this.applyTrackingConfig(interval, distanceInterval);

    this.currentInterval = interval;
    this.isTracking = true;

    useJourneyStore.getState().setIsTrackingActive(true);

    const destinationName =
      useJourneyStore.getState().destination?.name ?? undefined;
    AlarmService.triggerJourneyReminder(destinationName).catch(console.error);
    this.startTrackingWatchdog();
  }

  /**
   * Stops all location tracking. Robust against JS reloads: it checks the
   * real native state instead of trusting an in-memory flag.
   */
  public static async stopTracking() {
    try {
      const started = await Location.hasStartedLocationUpdatesAsync(
        BACKGROUND_LOCATION_TASK
      );
      if (started) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      }
    } catch (error) {
      console.error('Failed to stop location updates:', error);
    } finally {
      this.isTracking = false;
      this.destination = null;
      this.restartPromise = null;
      this.stopTrackingWatchdog();
      useJourneyStore.getState().setIsTrackingActive(false);
    }
  }

  /**
   * Reconciles the persisted journey with real native tracking state after a
   * JavaScript process restart. Runs once per session; startTracking awaits
   * it so a late recovery can never overwrite a newly started journey.
   *
   * - Native tracking alive  -> rehydrates this service and resumes alarm
   *   evaluation ('recovered').
   * - Native tracking dead   -> flags the journey as interrupted so the UI
   *   can offer resume/discard ('interrupted').
   * - Orphaned native tracking with no persisted journey -> stopped ('idle').
   */
  public static reconcileActiveJourney(): Promise<RecoveryStatus> {
    if (!this.recoveryPromise) {
      this.recoveryPromise = this.performReconciliation();
    }
    return this.recoveryPromise;
  }

  private static async performReconciliation(): Promise<RecoveryStatus> {
    try {
      const journey = useJourneyStore.getState();
      const hadActiveJourney = journey.isTrackingActive && !!journey.destination;

      let nativeAlive = false;
      try {
        nativeAlive = await Location.hasStartedLocationUpdatesAsync(
          BACKGROUND_LOCATION_TASK
        );
      } catch (error) {
        console.error('Failed to query native tracking state:', error);
      }

      if (!hadActiveJourney) {
        if (nativeAlive) {
          await this.stopTracking();
        }
        return 'idle';
      }

      if (nativeAlive) {
        if (this.rehydrateFromStore()) {
          useJourneyStore.getState().setTrackingInterrupted(false);
          this.startTrackingWatchdog();
          return 'recovered';
        }
        return 'idle';
      }

      useJourneyStore.getState().setTrackingInterrupted(true);
      return 'interrupted';
    } catch (error) {
      console.error('Journey reconciliation failed:', error);
      return 'idle';
    }
  }

  /**
   * Restores per-journey state from the persisted store so the background
   * task pipeline (confidence -> prediction -> alarms) resumes unchanged.
   * Returns false when there is nothing to recover or a newer journey
   * already owns tracking.
   */
  private static rehydrateFromStore(): boolean {
    const journey = useJourneyStore.getState();
    if (!journey.destination || !journey.isTrackingActive) return false;
    if (this.isTracking) return false;

    this.destination = {
      latitude: journey.destination.lat,
      longitude: journey.destination.lng,
    };
    this.speedHistory = [];
    this.hasTriggeredGentleAlert = false;
    this.inRangeConfirmations = 0;
    this.journeyStartedAt = journey.startedAt ?? Date.now();
    this.currentInterval = DEFAULT_INTERVAL_MS;
    this.isTracking = true;
    void this.refreshBattery(true);

    void Location.getBackgroundPermissionsAsync()
      .then(({ status }) => {
        this.permissionsVerified = status === 'granted';
      })
      .catch(() => undefined);

    return true;
  }

  /**
   * User-requested resume of an interrupted journey. Checks permissions
   * without prompting, restarts native tracking and clears the interrupted
   * flag. Throws only when the native restart itself fails.
   */
  public static async resumeAfterInterruption(): Promise<ResumeStatus> {
    const [fg, bg] = await Promise.all([
      Location.getForegroundPermissionsAsync(),
      Location.getBackgroundPermissionsAsync(),
    ]);
    if (fg.status !== 'granted' || bg.status !== 'granted') {
      return 'missing_permissions';
    }

    if (!this.rehydrateFromStore()) return 'no_journey';

    try {
      await this.applyTrackingConfig(DEFAULT_INTERVAL_MS, DEFAULT_DISTANCE_M);
    } catch (error) {
      this.isTracking = false;
      this.destination = null;
      throw error;
    }

    this.permissionsVerified = true;
    useJourneyStore.getState().setIsTrackingActive(true);
    useJourneyStore.getState().setTrackingInterrupted(false);
    this.startTrackingWatchdog();
    return 'resumed';
  }

  // -------------------------------------------------------------------
  // Dev-only simulation hooks used by src/dev/JourneySimulator.ts.
  // These bypass the native location stack and must never run in production.
  // -------------------------------------------------------------------

  private static simulationActive = false;

  public static isSimulating(): boolean {
    return this.simulationActive;
  }

  public static beginSimulatedJourney(options: { destination: Coordinates }): void {
    this.destination = options.destination;
    this.speedHistory = [];
    this.hasTriggeredGentleAlert = false;
    this.inRangeConfirmations = 0;
    this.journeyStartedAt = Date.now();
    this.currentInterval = DEFAULT_INTERVAL_MS;
    this.simulationActive = true;
    this.isTracking = true;
    void this.refreshBattery(true);
  }

  public static ingestLocation(location: Location.LocationObject): void {
    if (!this.simulationActive) return;
    void this.handleLocationUpdate(location);
  }

  public static endSimulatedJourney(): void {
    this.simulationActive = false;
    this.isTracking = false;
    this.destination = null;
  }

  public static getPollingInterval(): number {
    return this.currentInterval;
  }

  // -------------------------------------------------------------------
  // Runtime watchdog
  // -------------------------------------------------------------------

  /**
   * The background task emits nothing once the OS has killed it, so native
   * tracking death mid-journey is invisible to the event pipeline. An
   * independent probe notices, and surfaces through the existing
   * interrupted-journey flow rather than failing silently.
   */
  private static startTrackingWatchdog() {
    this.stopTrackingWatchdog();
    this.watchdogTimer = setInterval(() => {
      void this.verifyNativeTrackingAlive();
    }, this.WATCHDOG_INTERVAL_MS);
  }

  private static stopTrackingWatchdog() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private static async verifyNativeTrackingAlive() {
    if (!this.isTracking || this.simulationActive) return;
    try {
      const started = await Location.hasStartedLocationUpdatesAsync(
        BACKGROUND_LOCATION_TASK
      );
      if (started) return;

      console.error('Native tracking died mid-journey');
      this.isTracking = false;
      this.destination = null;
      useJourneyStore.getState().setTrackingInterrupted(true);
    } catch (error) {
      console.error('Tracking watchdog query failed:', error);
    }
  }

  /**
   * Adapts the polling interval dynamically based on remaining distance.
   * Restarts are debounced through restartPromise so rapid updates never
   * overlap, and never re-trigger permission prompts.
   */
  private static async adaptPollingInterval(distanceToDestination: number) {
    let newInterval: number;
    let newDistanceInterval: number;

    if (distanceToDestination > 50000) {
      newInterval = 60000; // > 50 km -> every minute / 1 km steps
      newDistanceInterval = 1000;
    } else if (distanceToDestination > 10000) {
      newInterval = 30000; // > 10 km -> every 30 s / 500 m steps
      newDistanceInterval = 500;
    } else if (distanceToDestination > 2000) {
      newInterval = 15000; // > 2 km -> every 15 s / 100 m steps
      newDistanceInterval = 100;
    } else {
      newInterval = 5000; // < 2 km -> every 5 s / 10 m steps
      newDistanceInterval = 10;
    }

    if (
      this.currentInterval === newInterval ||
      !this.isTracking ||
      !this.destination ||
      this.restartPromise
    ) {
      return;
    }

    const destination = this.destination;
    this.currentInterval = newInterval;

    if (this.simulationActive) return;

    this.restartPromise = this.reconfigure(destination, newInterval, newDistanceInterval)
      .catch((error) => {
        console.error('Adaptive reconfiguration failed, retrying once:', error);
        return this.applyTrackingConfig(newInterval, newDistanceInterval);
      })
      .catch((error) => {
        console.error('Adaptive reconfiguration retry failed:', error);
      })
      .finally(() => {
        this.restartPromise = null;
      });
  }

  /**
   * Re-registers the background task with new intervals. Skips permission
   * checks because they were already validated when tracking started.
   */
  private static async reconfigure(
    destination: Coordinates,
    interval: number,
    distanceInterval: number
  ) {
    const highAccuracy = useSettingsStore.getState().highAccuracyMode;
    await this.applyTrackingConfig(interval, distanceInterval, highAccuracy);
  }

  private static async applyTrackingConfig(
    interval: number,
    distanceInterval: number,
    highAccuracy?: boolean
  ) {
    const useHighAccuracy =
      highAccuracy ?? useSettingsStore.getState().highAccuracyMode;

    // Stop any existing registration first so option changes apply cleanly.
    try {
      const started = await Location.hasStartedLocationUpdatesAsync(
        BACKGROUND_LOCATION_TASK
      );
      if (started) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      }
    } catch {
      // Ignore - a fresh start below will surface real errors.
    }

    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: useHighAccuracy
        ? Location.Accuracy.High
        : Location.Accuracy.Balanced,
      timeInterval: interval,
      distanceInterval,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'SmartJourney Tracking',
        notificationBody: 'Actively tracking your location to destination.',
        notificationColor: '#4F46E5',
      },
    });
  }
}
