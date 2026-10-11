/**
 * localStorage-based watch history for series.
 * Tracks the last-watched clip ID per series so the feed can resume from it.
 */

const STORAGE_KEY = "wonka_series_watch";
const MAX_ENTRIES = 200;

type WatchEntry = { clipId: string; ts: number };
type WatchMap = Record<string, WatchEntry>;

function readMap(): WatchMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as WatchMap) : {};
  } catch {
    return {};
  }
}

function writeMap(map: WatchMap): void {
  try {
    const entries = Object.entries(map);
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => a[1].ts - b[1].ts);
      for (const [key] of entries.slice(0, entries.length - MAX_ENTRIES)) {
        delete map[key];
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch { /* private mode or quota exceeded */ }
}

/** Get the clip ID of the last-watched episode for a series, or null. */
export function getLastWatchedClipId(seriesId: string): string | null {
  return readMap()[seriesId]?.clipId ?? null;
}

/** Save the last-watched clip for a series. */
export function setLastWatched(seriesId: string, clipId: string): void {
  const map = readMap();
  map[seriesId] = { clipId, ts: Date.now() };
  writeMap(map);
}
