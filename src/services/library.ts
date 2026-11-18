"use client";

import { useQuery } from "@tanstack/react-query";
import type { Series } from "@/types/library";

export type SeriesListResult = { items: Series[]; total: number; limit: number; offset: number };
export type GenreDefinition = { id: string; name: string; slug: string; seriesCount: number };
export type Chapter = {
  id: string;
  chapter_number: number;
  title: string;
  page_count: number;
  last_page?: number | null;
  last_read?: string;
};
export type ChapterPage = { pageNumber: number; url: string };
export type ChapterDetail = Chapter & { id: string; series_id: string; series: Series };
export type AuthUser = { id: string; username: string };

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!(typeof FormData !== "undefined" && init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `Request failed (${response.status}).`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function useSeriesList(options: { query?: string; status?: string; genre?: string; featured?: boolean; sort?: string; limit?: number; offset?: number; enabled?: boolean } = {}) {
  const params = new URLSearchParams();
  if (options.query?.trim()) params.set("q", options.query.trim());
  if (options.status && options.status !== "All statuses") params.set("status", options.status);
  if (options.genre && options.genre !== "All genres") params.set("genre", options.genre);
  if (options.featured !== undefined) params.set("featured", String(options.featured));
  if (options.sort) params.set("sort", options.sort);
  params.set("limit", String(options.limit ?? 100));
  params.set("offset", String(options.offset ?? 0));
  const suffix = params.toString();
  return useQuery({
    queryKey: ["series", options],
    queryFn: () => fetchJson<SeriesListResult>(`/api/series?${suffix}`),
    enabled: options.enabled ?? true,
  });
}

export function useSession() {
  return useQuery({
    queryKey: ["auth", "session"],
    queryFn: () => fetchJson<AuthUser | null>("/api/auth/session"),
    retry: false,
  });
}

export function useSeries(id: string) {
  return useQuery({ queryKey: ["series", id], queryFn: () => fetchJson<Series>(`/api/series/${id}`), enabled: Boolean(id) });
}

export function useChapters(id: string) {
  return useQuery({ queryKey: ["chapters", id], queryFn: () => fetchJson<Chapter[]>(`/api/series/${id}/chapters`), enabled: Boolean(id) });
}

export function useGenres(enabled = true) {
  return useQuery({
    queryKey: ["genres"],
    queryFn: () => fetchJson<GenreDefinition[]>("/api/genres"),
    enabled,
  });
}

export function useChapter(id: string) {
  return useQuery({
    queryKey: ["chapter", id],
    queryFn: () => fetchJson<ChapterDetail>(`/api/chapters/${id}`),
    enabled: Boolean(id),
  });
}

export function useChapterPages(seriesId: string, chapterId: string) {
  return useQuery({
    queryKey: ["chapter-pages", seriesId, chapterId],
    queryFn: () => fetchJson<ChapterPage[]>(`/api/series/${seriesId}/chapters/${chapterId}/pages`),
    enabled: Boolean(seriesId && chapterId),
  });
}

export { fetchJson };
