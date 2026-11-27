import { SAVED_FILTER_STORAGE_KEY, SavedAssetFilter } from "@/pages/shared/options";

export const loadStoredTab = <T extends string>(storageKey: string, allowedKeys: readonly T[], fallback: T): T => {
  try {
    const value = window.localStorage.getItem(storageKey);
    return allowedKeys.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
};

export const saveStoredTab = (storageKey: string, value: string) => {
  try {
    window.localStorage.setItem(storageKey, value);
  } catch {
    // Ignore private browsing or storage quota failures; tab navigation should still work.
  }
};

export const loadSavedFilters = (): SavedAssetFilter[] => {
  try {
    const value = window.localStorage.getItem(SAVED_FILTER_STORAGE_KEY);
    if (!value) {
      return [];
    }
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => item as SavedAssetFilter) : [];
  } catch {
    return [];
  }
};

export const saveFilters = (filters: SavedAssetFilter[]) => {
  window.localStorage.setItem(SAVED_FILTER_STORAGE_KEY, JSON.stringify(filters));
};
