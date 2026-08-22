import { TransportMode } from '../store/useJourneyStore';

export enum ConfidenceLevel {
  GOOD = 'GOOD',
  DEGRADED = 'DEGRADED',
  POOR = 'POOR',
}

export interface ConfidenceInputs {
  /** GPS horizontal accuracy in meters (null when unavailable). */
  accuracy: number | null;
  /** Current speed in m/s (null when unavailable). */
  speed: number | null;
  /** Epoch millis of the fix - used to penalize stale readings. */
  readingTimestamp?: number | null;
  /** Last N observed speeds (m/s) for movement-consistency analysis. */
  recentSpeeds?: (number | null)[];
  /** Plausible-speed ceiling depends on how the user travels. */
  transportMode?: TransportMode;
  /** Device battery level 0..1 (null when unknown). */
  batteryLevel?: number | null;
  isCharging?: boolean;
}

export interface ConfidenceResult {
  /** 0-100 composite score. */
  score: number;
  level: ConfidenceLevel;
}

/**
 * Maximum physically plausible sustained speeds per transport mode (m/s).
 */
const MAX_PLAUSIBLE_SPEED: Record<TransportMode, number> = {
  walking: 3,
  cycling: 20,
  driving: 70,
  transit: 90,
};

// Component weights (must sum to 100).
const W_ACCURACY = 50;
const W_SPEED_SANITY = 20;
const W_MOVEMENT_CONSISTENCY = 15;
const W_FRESHNESS = 10;
const W_BATTERY = 5;

export class ConfidenceEngine {
  /**
   * Computes a multi-signal confidence score (0-100) for a location reading.
   *
   * Signals: GPS accuracy, speed plausibility for the transport mode,
   * movement consistency across recent readings, freshness of the fix,
   * and device battery headroom.
   *
   * Levels per PRD section 12:
   *   >= 80 -> GOOD   ("very reliable")
   *   >= 50 -> DEGRADED ("tracking degraded")
   *   <  50 -> POOR   ("location uncertain")
   */
  public static evaluate(inputs: ConfidenceInputs): ConfidenceResult {
    const accuracyPoints = this.scoreAccuracy(inputs.accuracy);
    const speedPoints = this.scoreSpeedSanity(inputs.speed, inputs.transportMode);
    const movementPoints = this.scoreMovementConsistency(
      inputs.speed,
      inputs.recentSpeeds ?? []
    );
    const freshnessPoints = this.scoreFreshness(inputs.readingTimestamp ?? null);
    const batteryPoints = this.scoreBattery(
      inputs.batteryLevel ?? null,
      inputs.isCharging ?? false
    );

    const raw =
      accuracyPoints +
      speedPoints +
      movementPoints +
      freshnessPoints +
      batteryPoints;

    const score = Math.max(0, Math.min(100, Math.round(raw)));
    const level: ConfidenceLevel =
      score >= 80 ? ConfidenceLevel.GOOD : score >= 50 ? ConfidenceLevel.DEGRADED : ConfidenceLevel.POOR;

    return { score, level };
  }

  private static scoreAccuracy(accuracy: number | null): number {
    if (accuracy === null || accuracy < 0) return 0;
    if (accuracy <= 10) return 50;
    if (accuracy <= 20) return 44;
    if (accuracy <= 40) return 32;
    if (accuracy <= 60) return 18;
    return 5;
  }

  private static scoreSpeedSanity(
    speed: number | null,
    mode: TransportMode | undefined
  ): number {
    if (speed === null || speed < 0) return Math.round(W_SPEED_SANITY * 0.6);

    const maxPlausible = MAX_PLAUSIBLE_SPEED[mode ?? 'driving'];
    if (speed <= maxPlausible) return W_SPEED_SANITY;
    if (speed <= maxPlausible * 2) return Math.round(W_SPEED_SANITY / 2);
    return 0;
  }

  private static scoreMovementConsistency(
    currentSpeed: number | null,
    recentSpeeds: (number | null)[]
  ): number {
    const samples = [currentSpeed, ...recentSpeeds].filter(
      (s): s is number => typeof s === 'number' && s >= 0
    );

    if (samples.length < 3) {
      // Not enough evidence yet - neutral middle score.
      return Math.round(W_MOVEMENT_CONSISTENCY * 0.55);
    }

    const mean = samples.reduce((sum, s) => sum + s, 0) / samples.length;

    // Consistently stationary is a stable, trustworthy signal too.
    if (mean < 0.5) return W_MOVEMENT_CONSISTENCY - 1;

    const variance =
      samples.reduce((sum, s) => sum + (s - mean) ** 2, 0) / samples.length;
    const cv = Math.sqrt(variance) / mean;

    if (cv <= 0.35) return W_MOVEMENT_CONSISTENCY;
    if (cv <= 0.8) return 9;
    return 4;
  }

  private static scoreFreshness(readingTimestamp: number | null): number {
    if (!readingTimestamp) return Math.round(W_FRESHNESS * 0.5);
    const ageSeconds = Math.max(0, (Date.now() - readingTimestamp) / 1000);
    if (ageSeconds <= 30) return W_FRESHNESS;
    if (ageSeconds <= 120) return 6;
    if (ageSeconds <= 600) return 2;
    return 0;
  }

  private static scoreBattery(batteryLevel: number | null, isCharging: boolean): number {
    if (isCharging) return W_BATTERY;
    if (batteryLevel === null || batteryLevel < 0) return Math.round(W_BATTERY * 0.6);
    if (batteryLevel >= 0.3) return W_BATTERY;
    if (batteryLevel >= 0.15) return 3;
    return 1;
  }
}
