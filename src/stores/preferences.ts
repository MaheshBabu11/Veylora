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
  autoScan: boolean;
  sidebarCollapsed: boolean;
  favorites: string[];
  collections: CustomCollection[];
  progressByChapter: Record<string, number>;
  readingStatuses: Record<string, string>;
  setTheme: (theme: Theme) => void;
  setReaderMode: (mode: ReaderMode) => void;
  setDirection: (direction: Direction) => void;
  setAutoScan: (autoScan: boolean) => void;
  setSidebarCollapsed: (sidebarCollapsed: boolean) => void;
  toggleFavorite: (seriesId: string) => void;
  addCollection: (title: string) => void;
  setReaderProgress: (chapterId: string, page: number) => void;
  setReadingStatus: (seriesId: string, status: string) => void;
  hydratePreferences: (preferences: { theme: Theme; readerMode: ReaderMode; direction: Direction; autoScan: boolean }) => void;
};

function savePreference(key: string, value: string | boolean) {
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
      autoScan: true,
      sidebarCollapsed: false,
      favorites: [],
      collections: [],
      progressByChapter: {},
      readingStatuses: {},
      setTheme: (theme) => { set({ theme }); savePreference("theme", theme); },
      setReaderMode: (readerMode) => { set({ readerMode }); savePreference("readerMode", readerMode); },
      setDirection: (direction) => { set({ direction }); savePreference("direction", direction); },
      setAutoScan: (autoScan) => { set({ autoScan }); savePreference("autoScan", autoScan); },
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
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
      name: "veylora-ui-state-v2",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ sidebarCollapsed }) => ({ sidebarCollapsed }),
    },
  ),
);
