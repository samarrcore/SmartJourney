import { Platform } from 'react-native';

/**
 * Tile configuration for the map views.
 *
 * react-native-maps on Android is a wrapper around the Google Maps SDK
 * (`com.google.android.gms:play-services-maps`), so with no Google Maps API key
 * configured the base map cannot authorise: it logs an Authorization failure and
 * draws nothing. Setting the map type to 'none' disables that base map, and
 * UrlTile then draws tiles from a plain URL template, which needs no key.
 *
 * `flipY` is left at its default of false because OpenStreetMap uses the
 * standard XYZ scheme; setting it true would flip every tile vertically.
 *
 * Before shipping, point this at a tile service you are entitled to use. The
 * public OpenStreetMap tile server is intended for light use only, and its usage
 * policy expects an identifying User-Agent that react-native-maps cannot send -
 * the fetch is performed by the Google Maps SDK's UrlTileProvider, which gives us
 * no hook to set headers.
 */
export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** 'none' is Android-only; other platforms keep their default base map. */
export const KEYLESS_MAP_TYPE = Platform.OS === 'android' ? 'none' : 'standard';
