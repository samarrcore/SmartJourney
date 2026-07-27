export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface PredictionResult {
  remainingDistanceMeters: number;
  etaSeconds: number | null; // null if speed is 0 or negative/unavailable
}

export class PredictionEngine {
  /**
   * Calculates the haversine distance between two coordinates in meters.
   * 
   * @param coord1 - First coordinate (latitude, longitude)
   * @param coord2 - Second coordinate (latitude, longitude)
   * @returns The distance in meters
   */
  public static calculateHaversineDistance(coord1: Coordinates, coord2: Coordinates): number {
    const R = 6371e3; // Earth radius in meters
    const phi1 = (coord1.latitude * Math.PI) / 180;
    const phi2 = (coord2.latitude * Math.PI) / 180;
    const deltaPhi = ((coord2.latitude - coord1.latitude) * Math.PI) / 180;
    const deltaLambda = ((coord2.longitude - coord1.longitude) * Math.PI) / 180;

    const a =
      Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }

  /**
   * Predicts the remaining distance and Estimated Time of Arrival (ETA).
   * 
   * @param current - Current coordinates
   * @param destination - Destination coordinates
   * @param speed - Current speed in meters/second
   * @returns PredictionResult containing remaining distance and ETA
   */
  public static predict(current: Coordinates, destination: Coordinates, speed: number | null): PredictionResult {
    const distance = this.calculateHaversineDistance(current, destination);
    
    let eta = null;
    if (speed !== null && speed > 0) {
      eta = distance / speed;
    }

    return {
      remainingDistanceMeters: distance,
      etaSeconds: eta,
    };
  }
}
