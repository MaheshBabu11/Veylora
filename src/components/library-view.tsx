"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, Check, Grid2X2, List, Search, SlidersHorizontal, X } from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { FilterDropdown } from "@/components/filter-dropdown";
import { SeriesCard } from "@/components/series-card";
import type { Series, ReadingStatus } from "@/types/library";
import { fetchJson, useSeriesList } from "@/services/library";

const statuses = ["All statuses", "Reading", "Plan to read", "Completed", "On hold"];
const subscribeToViewport = (callback: () => void) => {
  window.addEventListener("resize", callback);
  return () => window.removeEventListener("resize", callback);
};
const getViewportColumns = () => window.innerWidth <= 650 ? 2 : window.innerWidth <= 1180 ? 4 : 5;

export function LibraryView() {
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState("All genres");
  const [status, setStatus] = useState("All statuses");
  const [sort, setSort] = useState("Recently added");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [limit, setLimit] = useState(100);
  const viewportColumns = useSyncExternalStore(subscribeToViewport, getViewportColumns, () => 4);
  const columns = view === "grid" ? viewportColumns : 1;
  const [selected, setSelected] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useSeriesList({ query, genre, status, limit });
  const genres = ["All genres", ...Array.from(new Set((data?.items ?? []).flatMap((series) => series.genres))).sort()];

  useEffect(() => {
    const requestedGenre = new URLSearchParams(window.location.search).get("genre");
    if (requestedGenre) setGenre(requestedGenre);
  }, []);
  const filtered = useMemo(() => {
    const result = [...(data?.items ?? [])];
    if (sort === "Title A–Z") result.sort((a, b) => a.title.localeCompare(b.title));
    if (sort === "Most chapters") result.sort((a, b) => b.chapters - a.chapters);
    if (sort === "Reading progress") result.sort((a, b) => b.readChapters / b.chapters - a.readChapters / a.chapters);
    return result;
  }, [data?.items, sort]);

  const rows = useMemo(() => {
    const items: Series[][] = [];
    for (let i = 0; i < filtered.length; i += columns) items.push(filtered.slice(i, i + columns));
    return items;
  }, [filtered, columns]);
  // TanStack Virtual returns instance methods consumed directly by this render.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => columns === 2 ? 310 : 390,
    overscan: 3,
  });

  const toggleSelection = (id: string) => setSelected((old) => old.includes(id) ? old.filter((item) => item !== id) : [...old, id]);
  const updateSelectedStatus = async (nextStatus: ReadingStatus) => {
    const count = selected.length;
    try {
      await Promise.all(selected.map((id) => fetchJson(`/api/series/${id}`, {
        method: "PATCH", body: JSON.stringify({ status: nextStatus }),
      })));
      await queryClient.invalidateQueries({ queryKey: ["series"] });
      setSelected([]);
      setStatusMessage(`Updated ${count} title${count === 1 ? "" : "s"} to ${nextStatus.toLowerCase()}.`);
    } catch (requestError) {
      setStatusMessage(requestError instanceof Error ? requestError.message : "Unable to update titles.");
    }
  };

  return (
    <div className="library-page page-enter">
      <div className="page-heading library-heading">
        <div>
          <p className="eyebrow"><span className="eyebrow-line" /> YOUR PERSONAL COLLECTION</p>
          <h1>My library<span className="heading-period">.</span></h1>
          <p className="page-subtitle">Your books, kept right where they belong.</p>
        </div>
        <button className="button button-subtle" onClick={() => setSelected(filtered.map((item) => item.id))}><Check size={15} /> Select titles</button>
      </div>

      <div className="library-toolbar">
        <label className="library-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a story, author, genre..." /><kbd>⌘ F</kbd></label>
        <span className="toolbar-separator" />
        <FilterDropdown value={genre} options={genres} onChange={setGenre} label="Filter by genre" icon={<SlidersHorizontal size={15} />} />
        <FilterDropdown value={status} options={statuses} onChange={setStatus} label="Filter by reading status" />
        <FilterDropdown value={sort} options={["Recently added", "Title A–Z", "Most chapters", "Reading progress"]} onChange={setSort} label="Sort library" caption="SORT" className="sort-dropdown" />
        <span className="toolbar-separator" />
        <div className="view-switch" aria-label="Choose view mode">
          <button className={view === "grid" ? "selected" : ""} onClick={() => setView("grid")} aria-label="Grid view"><Grid2X2 size={16} /></button>
          <button className={view === "list" ? "selected" : ""} onClick={() => setView("list")} aria-label="List view"><List size={17} /></button>
        </div>
      </div>

      {selected.length > 0 && (
        <div className="bulk-toolbar">
          <button className="icon-button" onClick={() => setSelected([])} aria-label="Clear selection"><X size={15} /></button>
          <strong>{selected.length} selected</strong>
          <span className="bulk-divider" />
          <button onClick={() => updateSelectedStatus("Completed")}><Check size={14} /> Mark completed</button>
          <button onClick={() => updateSelectedStatus("Reading")}><BookOpen size={14} /> Mark as reading</button>
          <button onClick={() => setSelected([])} className="bulk-end">Done</button>
        </div>
      )}
      {statusMessage && <div className="toast-message" role="status">{statusMessage}<button onClick={() => setStatusMessage("")}><X size={13} /></button></div>}

      <div className="library-result-row"><span><strong>{data?.total ?? 0}</strong> titles <span className="result-dot">·</span> Showing your collection</span><button onClick={() => { setQuery(""); setGenre("All genres"); setStatus("All statuses"); }} className="clear-filters">Clear filters</button></div>
      {isLoading ? <div className="empty-state" role="status">Loading your library…</div> : null}
      {error ? <div className="empty-state" role="alert"><h2>Could not load your library.</h2><p>{error.message}</p><button className="button button-subtle" onClick={() => void queryClient.invalidateQueries({ queryKey: ["series"] })}>Try again</button></div> : null}
      {!isLoading && !error && filtered.length === 0 ? (
        <div className="empty-state"><div><Search size={22} /></div><h2>{data?.total === 0 ? "Your library is ready for its first book." : "No stories found."}</h2><p>{data?.total === 0 ? "Scan the books folder from Import to add your CBZ, ZIP, or CBR archives." : "Try a different title, author, or filter."}</p><button className="button button-subtle" onClick={() => { setQuery(""); setGenre("All genres"); setStatus("All statuses"); }}>Clear all filters</button></div>
      ) : !isLoading && !error && view === "list" ? (
        <div className="list-view">
          {filtered.map((series) => (
            <div className="list-row" key={series.id}>
              <button className={`list-check ${selected.includes(series.id) ? "checked" : ""}`} onClick={() => toggleSelection(series.id)} aria-label={`Select ${series.title}`}>{selected.includes(series.id) && <Check size={12} />}</button>
              <Link href={`/series/${series.id}`} className="list-cover"><CoverArt series={series} /></Link>
              <Link href={`/series/${series.id}`} className="list-main"><strong>{series.title}</strong><span>{series.author}</span></Link>
              <span className={`status-pill status-${series.status.toLowerCase().replaceAll(" ", "-")}`}>{series.status}</span>
              <span className="list-genres">{series.genres.join(" · ")}</span>
              <span className="list-chapters">{series.chapters} chapters</span>
              <span className="list-updated">{series.updated}</span>
            </div>
          ))}
        </div>
      ) : !isLoading && !error ? (
        <div className="virtual-grid-viewport" ref={scrollRef}>
          <div className="virtual-grid-inner" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((virtualRow) => (
              <div key={virtualRow.key} className="virtual-grid-row" style={{ transform: `translateY(${virtualRow.start}px)` }}>
                {rows[virtualRow.index].map((series) => (
                  <div className="virtual-grid-cell" key={series.id}>
                    <button className={`selection-check ${selected.includes(series.id) ? "checked" : ""}`} onClick={() => toggleSelection(series.id)} aria-label={`Select ${series.title}`}>{selected.includes(series.id) && <Check size={12} />}</button>
                    <SeriesCard series={series} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {data && data.total > limit && <button className="load-chapters" onClick={() => setLimit((value) => value + 100)}>Load more titles</button>}
      <div className="library-bottom-note">Your shelves are looking good <span>✦</span> <Link href="/settings">Personalize your library →</Link></div>
    </div>
  );
}
