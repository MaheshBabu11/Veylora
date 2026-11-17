"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type Theme = "dark" | "light" | "system";
type ReaderMode = "vertical" | "single";
type Direction = "rtl" | "ltr";
type CustomCollection = { title: string; createdAt: number };

type PreferencesState = {
  theme: Theme;
  readerMode: ReaderMode;
  direction: Direction;
  favorites: string[];
  collections: CustomCollection[];
  progressByChapter: Record<string, number>;
  readingStatuses: Record<string, string>;
  setTheme: (theme: Theme) => void;
  setReaderMode: (mode: ReaderMode) => void;
  setDirection: (direction: Direction) => void;
  toggleFavorite: (seriesId: string) => void;
  addCollection: (title: string) => void;
  setReaderProgress: (chapterId: string, page: number) => void;
  setReadingStatus: (seriesId: string, status: string) => void;
  hydratePreferences: (preferences: { theme: Theme; readerMode: ReaderMode; direction: Direction }) => void;
};

function savePreference(key: string, value: string) {
  void fetch("/api/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [key]: value }),
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Preference save failed (${response.status}).`);
  }).catch((error: unknown) => console.error("[preferences] unable to save preference", error));
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: "dark",
      readerMode: "vertical",
      direction: "rtl",
      favorites: [],
      collections: [],
      progressByChapter: {},
      readingStatuses: {},
      setTheme: (theme) => { set({ theme }); savePreference("theme", theme); },
      setReaderMode: (readerMode) => { set({ readerMode }); savePreference("readerMode", readerMode); },
      setDirection: (direction) => { set({ direction }); savePreference("direction", direction); },
      toggleFavorite: (seriesId) => set((state) => ({
        favorites: state.favorites.includes(seriesId)
          ? state.favorites.filter((id) => id !== seriesId)
          : [...state.favorites, seriesId],
      })),
      addCollection: (title) => set((state) => ({
        collections: [...state.collections, { title, createdAt: Date.now() }],
      })),
      setReaderProgress: (chapterId, page) => set((state) => ({
        progressByChapter: { ...state.progressByChapter, [chapterId]: page },
      })),
      setReadingStatus: (seriesId, status) => set((state) => ({
        readingStatuses: { ...state.readingStatuses, [seriesId]: status },
      })),
      hydratePreferences: (preferences) => set(preferences),
    }),
    {
      name: "veylora-preferences",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ theme, readerMode, direction, favorites, collections, progressByChapter, readingStatuses }) => ({
        theme,
        readerMode,
        direction,
        favorites,
        collections,
        progressByChapter,
        readingStatuses,
      }),
    },
  ),
);
