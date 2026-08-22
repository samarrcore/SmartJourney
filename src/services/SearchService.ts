export interface PlaceResult {
  id: string;
  title: string;
  subtitle: string;
  lat: number;
  lng: number;
}

interface NominatimPlace {
  place_id?: number;
  display_name?: string;
  name?: string;
  lat?: string;
  lon?: string;
}

const SEARCH_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const REVERSE_ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';

const HEADERS = {
  'User-Agent': 'SmartJourney/1.0 (location-based travel alarm app)',
  Accept: 'application/json',
};

function splitDisplayName(displayName: string): { title: string; subtitle: string } {
  const parts = displayName.split(', ');
  return {
    title: parts[0] || displayName,
    subtitle: parts.slice(1).join(', '),
  };
}

export const SearchService = {
  /**
   * Forward geocoding via OpenStreetMap Nominatim.
   * Returns an empty array when the query is too short or nothing matches.
   */
  async searchPlaces(query: string, limit: number = 8): Promise<PlaceResult[]> {
    const trimmed = query.trim();
    if (trimmed.length < 2) return [];

    const url =
      `${SEARCH_ENDPOINT}?q=${encodeURIComponent(trimmed)}` +
      `&format=jsonv2&addressdetails=0&limit=${limit}`;
    const response = await fetch(url, { headers: HEADERS });

    if (!response.ok) {
      throw new Error(`Search failed with status ${response.status}`);
    }

    const places = (await response.json()) as NominatimPlace[];
    return places
      .filter((place) => place.lat && place.lon)
      .map((place) => {
        const { title, subtitle } = splitDisplayName(place.name || place.display_name || '');
        return {
          id: String(place.place_id ?? `${place.lat},${place.lon}`),
          title,
          subtitle,
          lat: parseFloat(place.lat!),
          lng: parseFloat(place.lon!),
        };
      });
  },

  /**
   * Reverse geocoding for pins dropped on the map.
   * Never throws - falls back to a generic label with raw coordinates.
   */
  async reverseGeocode(lat: number, lng: number): Promise<PlaceResult> {
    const fallback: PlaceResult = {
      id: `pin_${lat.toFixed(5)}_${lng.toFixed(5)}`,
      title: 'Dropped Pin',
      subtitle: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      lat,
      lng,
    };

    try {
      const url = `${REVERSE_ENDPOINT}?lat=${lat}&lon=${lng}&format=jsonv2&zoom=18`;
      const response = await fetch(url, { headers: HEADERS });
      if (!response.ok) return fallback;

      const place = (await response.json()) as NominatimPlace;
      if (!place || !place.display_name) return fallback;

      const { title, subtitle } = splitDisplayName(place.name || place.display_name);
      return { ...fallback, title, subtitle };
    } catch {
      return fallback;
    }
  },
};
