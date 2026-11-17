"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePreferencesStore } from "@/stores/preferences";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, gcTime: 5 * 60_000, retry: 1, refetchOnWindowFocus: false },
      mutations: { retry: 0 },
    },
  }));
  useEffect(() => {
    void fetch("/api/preferences").then(async (response) => {
      if (!response.ok) throw new Error(`Could not load preferences (${response.status}).`);
      const preferences = await response.json() as { theme: "dark" | "light" | "system"; readerMode: "vertical" | "single"; direction: "rtl" | "ltr" };
      usePreferencesStore.getState().hydratePreferences(preferences);
    }).catch((error: unknown) => console.error("[preferences] unable to load preferences", error));
  }, []);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
