import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Lightweight stale-while-revalidate cache backed by AsyncStorage
 * (localStorage on web). Callers render the cached value instantly and refresh
 * in the background, so navigating back to a screen never blanks to a spinner.
 *
 * Caching is best-effort: storage failures are swallowed and treated as a miss.
 */

const PREFIX = "cache:";

type CacheEntry<T> = { v: T; t: number };

export async function readCache<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    return parsed && "v" in parsed ? parsed.v : null;
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, value: T): Promise<void> {
  try {
    const entry: CacheEntry<T> = { v: value, t: Date.now() };
    await AsyncStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // Ignore: the cache is an optimization, not a source of truth.
  }
}

export async function clearCache(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(PREFIX + key);
  } catch {
    // Ignore.
  }
}
