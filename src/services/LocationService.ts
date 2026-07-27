import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { PredictionEngine, Coordinates } from '../engine/PredictionEngine';
import { ConfidenceEngine, ConfidenceLevel } from '../engine/ConfidenceEngine';

export const BACKGROUND_LOCATION_TASK = 'BACKGROUND_LOCATION_TASK';

export interface LocationUpdateListener {
  (location: Location.LocationObject, distance: number, eta: number | null, confidence: ConfidenceLevel): void;
}

export class LocationService {
  private static isTracking = false;
  private static currentInterval = 10000;
  private static destination: Coordinates | null = null;
  private static listeners: LocationUpdateListener[] = [];
  private static hasTriggeredStage1 = false;

  /**
   * Initializes the location task manager. 
   * This should ideally be called in the global scope (e.g., in App.tsx or index.ts)
   * outside of any React component to ensure it's registered early.
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
          const latestLocation = locations[0];
          this.handleLocationUpdate(latestLocation);
        }
      }
    });
  }

  /**
   * Adds a listener to receive location updates and predictions.
   * @param listener Callback function
   */
  public static addListener(listener: LocationUpdateListener) {
    this.listeners.push(listener);
  }

  /**
   * Removes a previously added listener.
   * @param listener Callback function
   */
  public static removeListener(listener: LocationUpdateListener) {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  /**
   * Internal handler for new locations from the background task.
   */
  private static handleLocationUpdate(location: Location.LocationObject) {
    let distance = 0;
    let eta = null;
    
    const confidence = ConfidenceEngine.evaluate({
      accuracy: location.coords.accuracy,
      speed: location.coords.speed
    });

    if (this.destination) {
      const currentCoords = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude
      };
      
      const prediction = PredictionEngine.predict(
        currentCoords, 
        this.destination, 
        location.coords.speed
      );

      distance = prediction.remainingDistanceMeters;
      eta = prediction.etaSeconds;

      // Import inside function to avoid circular dependencies if any
      const { useJourneyStore } = require('../store/useJourneyStore');
      const AlarmService = require('./AlarmService').default;
      
      const storeState = useJourneyStore.getState();
      const wakeDistance = storeState.wakeDistance;

      // Update global state
      useJourneyStore.getState().setLiveStats({
        currentSpeed: location.coords.speed || 0,
        remainingDistance: distance,
        confidenceTier: confidence.toLowerCase() as any,
        eta: eta !== null ? Date.now() + eta * 1000 : 0,
      });

      // Alarm Logic
      if (distance <= wakeDistance) {
        AlarmService.triggerStage2('Wake Up!', 'You have reached your destination.');
        this.stopTracking(); // Stop tracking once we reach destination
      } else if (distance <= wakeDistance * 1.5) {
        // Trigger stage 1 once (need a flag to prevent spamming, or just trust notifee handles duplicates, but better use a simple memory flag)
        if (!this.hasTriggeredStage1) {
          AlarmService.triggerStage1('Approaching Destination', 'Get ready, you are almost there.');
          this.hasTriggeredStage1 = true;
        }
      }

      this.adaptPollingInterval(distance);
    }

    this.listeners.forEach(listener => listener(location, distance, eta, confidence));
  }

  /**
   * Requests necessary permissions for foreground and background location tracking.
   */
  public static async requestPermissions(): Promise<boolean> {
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== 'granted') return false;

    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
    return bgStatus === 'granted';
  }

  /**
   * Starts tracking location in the background and foreground.
   * @param destination The target destination to calculate distance to.
   * @param interval Polling interval in ms. Defaults to 10 seconds.
   * @param distanceInterval Distance interval in meters. Defaults to 10 meters.
   */
  public static async startTracking(
    destination: Coordinates,
    interval: number = 10000, 
    distanceInterval: number = 10
  ) {
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      throw new Error('Location permissions not granted');
    }

    this.destination = destination;
    this.hasTriggeredStage1 = false;

    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: interval,
      distanceInterval: distanceInterval,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'SmartJourney Tracking',
        notificationBody: 'Actively tracking your location to destination.',
        notificationColor: '#0000FF',
      },
    });
    
    this.currentInterval = interval;
    this.isTracking = true;
  }

  /**
   * Stops all location tracking.
   */
  public static async stopTracking() {
    if (this.isTracking) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      this.isTracking = false;
      this.destination = null;
    }
  }

  /**
   * Adapts the polling interval dynamically based on remaining distance.
   */
  private static async adaptPollingInterval(distanceToDestination: number) {
    let newInterval = 10000;
    let newDistanceInterval = 10;

    if (distanceToDestination > 50000) { // > 50km
      newInterval = 60000; // 1 min
      newDistanceInterval = 1000; // 1 km
    } else if (distanceToDestination > 10000) { // > 10km
      newInterval = 30000; // 30 sec
      newDistanceInterval = 500; // 500 m
    } else if (distanceToDestination > 2000) { // > 2km
      newInterval = 15000; // 15 sec
      newDistanceInterval = 100; // 100 m
    } else { // < 2km
      newInterval = 5000; // 5 sec
      newDistanceInterval = 10; // 10 m
    }

    // Only restart if the interval significantly changed to avoid constant restarting
    if (this.currentInterval !== newInterval && this.isTracking && this.destination) {
      // Re-register with new intervals
      await this.startTracking(this.destination, newInterval, newDistanceInterval);
    }
  }
}
