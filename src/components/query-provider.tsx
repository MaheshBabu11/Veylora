"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fetchJson, useSession } from "@/services/library";
import { usePreferencesStore, type ReaderSettings } from "@/stores/preferences";

function PreferencesHydrator() {
  const { data: user } = useSession();
  const { data: preferences } = useQuery({
    queryKey: ["preferences", user?.id],
    queryFn: () => fetchJson<{
      theme: "dark" | "light" | "system";
      readerMode: "vertical" | "single";
      direction: "rtl" | "ltr";
      readerSettings: Partial<ReaderSettings>;
      autoScan: boolean;
      defaultView: "grid" | "list";
    }>("/api/preferences"),
    enabled: Boolean(user),
    retry: false,
  });

  useEffect(() => {
    if (preferences) usePreferencesStore.getState().hydratePreferences(preferences);
  }, [preferences]);

  return null;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, gcTime: 5 * 60_000, retry: 1, refetchOnWindowFocus: false },
      mutations: { retry: 0 },
    },
  }));
  return <QueryClientProvider client={client}><PreferencesHydrator />{children}</QueryClientProvider>;
}
