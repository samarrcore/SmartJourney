export enum ConfidenceLevel {
  GOOD = 'GOOD',
  DEGRADED = 'DEGRADED',
  POOR = 'POOR',
}

export interface LocationData {
  accuracy: number | null;
  speed: number | null;
}

export class ConfidenceEngine {
  /**
   * Evaluates the confidence level of a location reading based on accuracy and a basic speed sanity check.
   * 
   * @param location - The location data containing accuracy (meters) and speed (meters/second).
   * @returns ConfidenceLevel (GOOD, DEGRADED, POOR)
   */
  public static evaluate(location: LocationData): ConfidenceLevel {
    const { accuracy, speed } = location;

    // Speed sanity check
    // If speed is incredibly high (> 150 m/s is roughly 540 km/h, unrealistic for normal ground travel),
    // we consider the reading unreliable.
    if (speed !== null && speed > 150) {
      return ConfidenceLevel.POOR;
    }

    if (accuracy === null) {
      return ConfidenceLevel.POOR;
    }

    if (accuracy <= 20) {
      return ConfidenceLevel.GOOD;
    } else if (accuracy <= 60) {
      return ConfidenceLevel.DEGRADED;
    } else {
      return ConfidenceLevel.POOR;
    }
  }
}
