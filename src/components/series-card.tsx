"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookOpen, Check, CircleDot, MoreHorizontal, Tag, UserRound } from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import type { Series } from "@/types/library";
import { fetchJson } from "@/services/library";

export function SeriesCard({ series, compact = false }: { series: Series; compact?: boolean }) {
  const [favorite, setFavorite] = useState(series.favorite ?? false);
  const [errorMessage, setErrorMessage] = useState("");
  const queryClient = useQueryClient();
  const toggleFavorite = useMutation({
    mutationFn: (nextFavorite: boolean) => fetchJson<Series>(`/api/series/${series.id}`, {
      method: "PATCH",
      body: JSON.stringify({ favorite: nextFavorite }),
    }),
    onSuccess: async (updated) => {
      setFavorite(updated.favorite ?? false);
      setErrorMessage("");
      await queryClient.invalidateQueries({ queryKey: ["series"] });
    },
    onError: (error) => setErrorMessage(error instanceof Error ? error.message : "Unable to update favorites."),
  });
  const progress = series.chapters ? Math.round((series.readChapters / series.chapters) * 100) : 0;
  const statusClass = series.status.toLowerCase().replaceAll(" ", "-");
  return (
    <article className={`series-card ${compact ? "series-card-compact" : ""}`}>
      <Link href={`/series/${series.id}`} className="cover-link" aria-label={`Open ${series.title}`}>
        <CoverArt series={series} />
        <span className="card-hover-actions" aria-hidden="true">
          <span className="quick-read">View details <span>↗</span></span>
        </span>
      </Link>
      <div className="series-card-copy">
        <div className="card-title-row">
          <Link href={`/series/${series.id}`} className="card-title">{series.title}</Link>
          <button
            className={`icon-button card-menu ${favorite ? "is-saved" : ""}`}
            onClick={() => toggleFavorite.mutate(!favorite)}
            disabled={toggleFavorite.isPending}
            aria-label={favorite ? "Remove bookmark" : "Bookmark series"}
            title={favorite ? "Saved to favorites" : "Add to favorites"}
          >
            {favorite ? <Check size={16} /> : <Bookmark size={16} />}
          </button>
          <button className="icon-button card-menu-more" aria-label={`More options for ${series.title}`} title="More options">
            <MoreHorizontal size={17} />
          </button>
        </div>
        <div className="card-meta">
          <span><UserRound size={11} /> {series.author || "Unknown creator"}</span>
          <i aria-hidden="true">·</i>
          <span><BookOpen size={11} /> {series.chapters} chapters</span>
        </div>
        <div className="card-tags">
          <span className={`card-status card-status-${statusClass}`}><CircleDot size={10} />{series.status}</span>
          {series.genres[0] && <span className="card-genre"><Tag size={10} />{series.genres[0]}</span>}
        </div>
        {series.status === "Reading" && (
          <div className="card-progress">
            <span className="progress-track"><span style={{ width: `${progress}%` }} /></span>
            <span>{progress}%</span>
          </div>
        )}
        {errorMessage && <span role="alert">{errorMessage}</span>}
      </div>
    </article>
  );
}
