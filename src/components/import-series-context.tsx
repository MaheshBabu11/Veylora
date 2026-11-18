"use client";

import { createContext, useContext } from "react";

export type ImportSeriesTarget = { id: string; title: string };

const ImportSeriesContext = createContext<((series?: ImportSeriesTarget) => void) | null>(null);

export function ImportSeriesProvider({
  onOpen,
  children,
}: {
  onOpen: (series?: ImportSeriesTarget) => void;
  children: React.ReactNode;
}) {
  return <ImportSeriesContext.Provider value={onOpen}>{children}</ImportSeriesContext.Provider>;
}

export function useOpenImportForSeries() {
  const onOpen = useContext(ImportSeriesContext);
  if (!onOpen) throw new Error("useOpenImportForSeries must be used within ImportSeriesProvider.");
  return onOpen;
}

export function useOpenImportDialog() {
  const onOpen = useContext(ImportSeriesContext);
  if (!onOpen) throw new Error("useOpenImportDialog must be used within ImportSeriesProvider.");
  return () => onOpen();
}
