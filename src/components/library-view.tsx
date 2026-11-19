"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Check, Grid2X2, List, Search, SlidersHorizontal, X } from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { FilterDropdown } from "@/components/filter-dropdown";
import { SeriesCard } from "@/components/series-card";
import { useOpenImportDialog } from "@/components/import-series-context";
import type { Series, ReadingStatus } from "@/types/library";
import { fetchJson, useGenres, useInfiniteSeriesList } from "@/services/library";
import { usePreferencesStore } from "@/stores/preferences";

const statuses = ["All statuses", "Reading", "Plan to read", "Completed", "On hold"];
type Collection = { id: string; name: string; description: string; series_ids: string[] };
const subscribeToViewport = (callback: () => void) => {
  window.addEventListener("resize", callback);
  return () => window.removeEventListener("resize", callback);
};
const getViewportColumns = () => window.innerWidth <= 650 ? 2 : window.innerWidth <= 1180 ? 4 : 5;

export function LibraryView({ collectionId }: { collectionId?: string }) {
  const [query, setQuery] = useState("");
  const [genre, setGenre] = useState("All genres");
  const [status, setStatus] = useState("All statuses");
  const [selectedCollectionId, setSelectedCollectionId] = useState(collectionId ?? "");
  const [sort, setSort] = useState("Recently added");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const view = usePreferencesStore((state) => state.defaultView);
  const setView = usePreferencesStore((state) => state.setDefaultView);
  const viewportColumns = useSyncExternalStore(subscribeToViewport, getViewportColumns, () => 4);
  const columns = view === "grid" ? viewportColumns : 1;
  const [selected, setSelected] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const openImport = useOpenImportDialog();
  const { data: collections = [], isLoading: collectionsLoading, error: collectionsError } = useQuery({
    queryKey: ["collections"],
    queryFn: () => fetchJson<Collection[]>("/api/collections"),
  });
  const activeCollection = collections.find((collection) => collection.id === selectedCollectionId);
  const { data: genreDefinitions = [], error: genresError } = useGenres();
  const sortKey = sort === "Last read" ? "last-read"
    : sort === "Title A–Z" ? "title"
      : sort === "Most chapters" ? "chapters"
        : sort === "Reading progress" ? "progress"
          : "recent";
  const {
    data: pages,
    isLoading,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useInfiniteSeriesList({
    query,
    genre,
    status,
    collectionId: selectedCollectionId || undefined,
    sort: sortKey,
  });
  const data = pages?.pages[0];
  const filtered = useMemo(() => pages?.pages.flatMap((page) => page.items) ?? [], [pages?.pages]);
  const genres = ["All genres", ...genreDefinitions.map((definition) => definition.name)];
  const collectionOptions = ["All collections", ...collections.map((collection) => collection.name)];
  const collectionFilterValue = activeCollection?.name ?? "All collections";
  const activeFilterCount = Number(genre !== "All genres") + Number(status !== "All statuses") + Number(Boolean(selectedCollectionId));
  const isEmptyLibrary = !selectedCollectionId && data?.total === 0 && !query.trim() && genre === "All genres" && status === "All statuses";

  useEffect(() => {
    const requestedGenre = new URLSearchParams(window.location.search).get("genre");
    if (requestedGenre) setGenre(requestedGenre);
    setSelectedCollectionId(collectionId ?? "");
  }, [collectionId]);
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

  const changeCollectionFilter = (name: string) => {
    const nextCollectionId = collections.find((collection) => collection.name === name)?.id ?? "";
    setSelectedCollectionId(nextCollectionId);
    const url = new URL(window.location.href);
    if (nextCollectionId) url.searchParams.set("collection", nextCollectionId);
    else url.searchParams.delete("collection");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };
  const clearFilters = () => {
    setQuery("");
    setGenre("All genres");
    setStatus("All statuses");
    setSort("Recently added");
    changeCollectionFilter("All collections");
  };

  if (selectedCollectionId && collectionsLoading) return <div className="empty-state" role="status">Loading collection…</div>;
  if (selectedCollectionId && collectionsError) return <div className="empty-state" role="alert"><h2>Could not load this collection.</h2><p>{collectionsError.message}</p></div>;
  if (selectedCollectionId && !activeCollection) return <div className="empty-state" role="alert"><h2>Collection not found.</h2><Link className="button button-subtle" href="/collections">Back to collections</Link></div>;

  return (
    <div className="library-page page-enter">
      <div className="page-heading library-heading">
        <div>
          <p className="eyebrow"><span className="eyebrow-line" /> YOUR PERSONAL COLLECTION</p>
          <h1>{activeCollection?.name ?? "My library"}<span className="heading-period">.</span></h1>
          <p className="page-subtitle">{activeCollection ? "Stories gathered on this shelf." : "Your books, kept right where they belong."}</p>
        </div>
        <button className="button button-subtle" onClick={() => setSelected(filtered.map((item) => item.id))}><Check size={15} /> Select loaded titles</button>
      </div>

      <div className="library-toolbar">
        <label className="library-search"><Search size={16} /><input aria-label="Search titles, authors, or genres" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a story, author, genre..." /></label>
        <button
          className={`library-filter-toggle ${filtersOpen ? "open" : ""}`}
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="library-filter-panel"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <SlidersHorizontal size={16} /> Filters
          {activeFilterCount > 0 && <span className="library-filter-count">{activeFilterCount}</span>}
        </button>
        <div className="view-switch" aria-label="Choose view mode">
          <button type="button" className={view === "grid" ? "selected" : ""} onClick={() => setView("grid")} aria-label="Grid view" aria-pressed={view === "grid"}><Grid2X2 size={16} /></button>
          <button type="button" className={view === "list" ? "selected" : ""} onClick={() => setView("list")} aria-label="List view" aria-pressed={view === "list"}><List size={17} /></button>
        </div>
      </div>
      {filtersOpen && (
        <section className="library-filter-panel" id="library-filter-panel" aria-label="Library filters">
          <div className="library-filter-panel-heading">
            <div><strong>Refine your library</strong><span>Choose a genre, collection, status, or sort order.</span></div>
            <button type="button" className="library-filter-reset" onClick={clearFilters} disabled={activeFilterCount === 0 && sort === "Recently added" && !query}>Reset</button>
          </div>
          <div className="library-filter-controls">
            <FilterDropdown value={genre} options={genres} onChange={setGenre} label="Filter by genre" icon={<SlidersHorizontal size={15} />} searchable searchPlaceholder="Search genres..." />
            <FilterDropdown value={collectionFilterValue} options={collectionOptions} onChange={changeCollectionFilter} label="Filter by collection" searchable searchPlaceholder="Search collections..." />
            <FilterDropdown value={status} options={statuses} onChange={setStatus} label="Filter by reading status" />
            <FilterDropdown value={sort} options={["Recently added", "Last read", "Title A–Z", "Most chapters", "Reading progress"]} onChange={setSort} label="Sort library" caption="SORT" className="sort-dropdown" />
          </div>
          {genresError && <p className="library-filter-error" role="alert">Could not load genres: {genresError.message}</p>}
          {collectionsError && <p className="library-filter-error" role="alert">Could not load collections: {collectionsError.message}</p>}
        </section>
      )}

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

      <div className="library-result-row"><span><strong>{data?.total ?? 0}</strong> titles <span className="result-dot">·</span> {activeCollection ? `In ${activeCollection.name}` : "Showing your collection"}</span><button onClick={clearFilters} className="clear-filters">Clear filters</button></div>
      {isLoading ? <div className="empty-state" role="status">Loading your library…</div> : null}
      {error ? <div className="empty-state" role="alert"><h2>Could not load your library.</h2><p>{error.message}</p><button className="button button-subtle" onClick={() => void queryClient.invalidateQueries({ queryKey: ["series"] })}>Try again</button></div> : null}
      {!isLoading && !error && filtered.length === 0 ? (
        <div className="empty-state"><div>{isEmptyLibrary ? <BookOpen size={22} /> : <Search size={22} />}</div><h2>{activeCollection?.series_ids.length === 0 ? "This collection is empty." : isEmptyLibrary ? "Your library is ready for its first book." : "No stories found."}</h2><p>{activeCollection?.series_ids.length === 0 ? "Manage this collection to add stories to its shelf." : isEmptyLibrary ? "Upload chapter archives or scan the books folder to add your collection." : "Try a different title, author, or filter."}</p>{activeCollection?.series_ids.length === 0 ? <Link className="button button-subtle" href="/collections">Manage collection</Link> : isEmptyLibrary ? <button type="button" className="button button-primary" onClick={openImport}><BookOpen size={15} /> Import or scan books</button> : <button type="button" className="button button-subtle" onClick={clearFilters}>Clear all filters</button>}</div>
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
              <div
                key={virtualRow.key}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                className="virtual-grid-row"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
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
      {hasNextPage && <button className="load-chapters" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>{isFetchingNextPage ? "Loading titles…" : "Load more titles"}</button>}
      <div className="library-bottom-note">Your shelves are looking good <span>✦</span> <Link href="/settings">Personalize your library →</Link></div>
    </div>
  );
}
