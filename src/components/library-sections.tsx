"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, BookOpen, Check, Clock3, FolderHeart, Plus, Search, Sparkles, Tag, X } from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { SeriesCard } from "@/components/series-card";
import { fetchJson, useGenres, useSeriesList } from "@/services/library";
import type { GenreDefinition } from "@/services/library";
import type { Series } from "@/types/library";

type Collection = { id: string; name: string; description: string; series_ids: string[] };

const pageInfo: Record<string, { title: string; subtitle: string; eyebrow: string }> = {
  "recently-added": { title: "Recently added", subtitle: "New arrivals, still settling onto the shelves.", eyebrow: "THE LATEST FROM YOUR LIBRARY" },
  "continue-reading": { title: "Continue reading", subtitle: "Every story right where you left it.", eyebrow: "PICK UP THE THREAD" },
  history: { title: "Reading history", subtitle: "A trail of all the worlds you’ve visited.", eyebrow: "YOUR READING JOURNEY" },
  favorites: { title: "Favorites", subtitle: "The ones you’ll always come back to.", eyebrow: "KEPT CLOSE" },
  categories: { title: "Categories", subtitle: "Browse the collection by genre.", eyebrow: "FIND YOUR NEXT MOOD" },
  authors: { title: "Authors", subtitle: "The storytellers behind your collection.", eyebrow: "PEOPLE WHO MAKE STORIES" },
};

export function LibrarySection({ kind }: { kind: string }) {
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newCollection, setNewCollection] = useState("");
  const [newGenre, setNewGenre] = useState("");
  const [message, setMessage] = useState("");
  const [editingCollection, setEditingCollection] = useState<Collection | null>(null);
  const [selectedSeriesIds, setSelectedSeriesIds] = useState<string[]>([]);
  const [collectionSearch, setCollectionSearch] = useState("");
  const queryClient = useQueryClient();
  const { data: library, isLoading, error } = useSeriesList({ limit: 500, sort: "updated" });
  const series = useMemo(() => library?.items ?? [], [library?.items]);
  const { data: collectionLibrary, isLoading: collectionSeriesLoading, error: collectionSeriesError } = useSeriesList({
    query: collectionSearch,
    limit: 500,
    sort: "updated",
    enabled: kind === "collections" && Boolean(editingCollection),
  });
  const collectionSeries = collectionLibrary?.items ?? [];
  const { data: collections = [] } = useQuery({
    queryKey: ["collections"],
    queryFn: () => fetchJson<Collection[]>("/api/collections"),
    enabled: kind === "collections",
  });
  const { data: genreDefinitions = [], isLoading: genresLoading, error: genresError } = useGenres(kind === "categories");
  const createCollection = useMutation({
    mutationFn: (name: string) => fetchJson("/api/collections", {
      method: "POST",
      body: JSON.stringify({ name, description: "" }),
    }),
    onSuccess: async () => {
      setNewCollection("");
      setShowCreate(false);
      setMessage("Collection created.");
      await queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
    onError: (createError) => setMessage(createError instanceof Error ? createError.message : "Could not create collection."),
  });
  const updateCollectionSeries = useMutation({
    mutationFn: ({ collectionId, seriesIds }: { collectionId: string; seriesIds: string[] }) => fetchJson("/api/collections", {
      method: "PATCH",
      body: JSON.stringify({ collectionId, seriesIds }),
    }),
    onSuccess: async () => {
      setEditingCollection(null);
      setMessage("Collection updated.");
      await queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
    onError: (updateError) => setMessage(updateError instanceof Error ? updateError.message : "Could not update collection."),
  });
  const createGenre = useMutation({
    mutationFn: (name: string) => fetchJson<GenreDefinition>("/api/genres", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
    onSuccess: async () => {
      setNewGenre("");
      setMessage("Genre added.");
      await queryClient.invalidateQueries({ queryKey: ["genres"] });
    },
    onError: (createError) => setMessage(createError instanceof Error ? createError.message : "Could not add genre."),
  });
  const filtered = useMemo(() => {
    let items = series;
    if (kind === "continue-reading") items = items.filter((item) => item.status === "Reading" && item.lastChapterId);
    if (kind === "favorites") items = items.filter((item) => item.favorite);
    if (kind === "history") items = items.filter((item) => item.lastRead);
    if (kind === "recently-added") items = [...items].sort((a, b) => b.updated.localeCompare(a.updated));
    return items.filter((item) => `${item.title} ${item.author}`.toLowerCase().includes(query.toLowerCase()));
  }, [kind, series, query]);
  const info = pageInfo[kind];
  if (!info && kind !== "collections") return null;
  if (isLoading) return <div className="empty-state" role="status">Loading your library…</div>;
  if (error) return <div className="empty-state" role="alert"><h2>Could not load your library.</h2><p>{error.message}</p></div>;

  if (kind === "collections") {
    return (
      <div className="listing-page page-enter">
        <div className="page-heading">
          <div><p className="eyebrow"><span className="eyebrow-line" /> YOUR STORIES, YOUR WAY</p><h1>Collections<span className="heading-period">.</span></h1><p className="page-subtitle">A shelf for every mood and moment.</p></div>
          <button className="button button-primary" onClick={() => setShowCreate(true)}><Plus size={16} /> New collection</button>
        </div>
        <div className="collection-grid">
          {collections.map((collection, index) => {
            const covers = collection.series_ids.map((id) => series.find((item) => item.id === id)).filter((item): item is Series => Boolean(item)).slice(0, 3);
            return (
              <article className={`collection-card collection-card-${index + 1}`} key={collection.id} style={{ "--collection-color": "#78948e" } as React.CSSProperties}>
                <Link href={`/library?collection=${encodeURIComponent(collection.id)}`} className="collection-art-stack" aria-label={`Open ${collection.name}`}>
                  <div className="collection-orbit" />
                  {covers.map((item, coverIndex) => <div className={`collection-cover-stack stack-${coverIndex + 1}`} key={item.id}><CoverArt series={item} /></div>)}
                  <span className="collection-count">{collection.series_ids.length} STORIES</span>
                </Link>
                <div className="collection-copy"><div><h2>{collection.name}</h2><p>{collection.description || "A personal shelf."}</p></div><ArrowRight size={17} /></div>
                <button
                  className="collection-manage"
                  onClick={() => {
                    setEditingCollection(collection);
                    setSelectedSeriesIds(collection.series_ids);
                    setCollectionSearch("");
                  }}
                ><Plus size={14} /> Manage stories</button>
              </article>
            );
          })}
          <button className="collection-create-card" onClick={() => setShowCreate(true)}><span><Plus size={19} /></span><strong>Start a new collection</strong><small>Gather stories around a feeling.</small></button>
        </div>
        {showCreate && (
          <div className="overlay-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowCreate(false)}>
            <div className="create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-title">
              <button className="dialog-close import-close" onClick={() => setShowCreate(false)} aria-label="Close"><X size={17} /></button>
              <div className="dialog-icon"><FolderHeart size={20} /></div><p className="eyebrow">MAKE IT YOURS</p><h2 id="create-title">A new little shelf.</h2>
              <p className="import-description">Give your collection a name. You can add stories anytime.</p>
              <form onSubmit={(event) => { event.preventDefault(); if (newCollection.trim()) createCollection.mutate(newCollection.trim()); }}>
                <input className="dialog-input" value={newCollection} onChange={(event) => setNewCollection(event.target.value)} placeholder="e.g. Rainy day reads" autoFocus />
                <button className="button button-primary" type="submit" disabled={createCollection.isPending}><Plus size={15} /> Create collection</button>
              </form>
            </div>
          </div>
        )}
        {editingCollection && (
          <div className="overlay-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setEditingCollection(null)}>
            <div className="create-dialog collection-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="manage-collection-title">
              <button className="dialog-close import-close" onClick={() => setEditingCollection(null)} aria-label="Close"><X size={17} /></button>
              <div className="dialog-icon"><FolderHeart size={20} /></div><p className="eyebrow">YOUR PERSONAL SHELF</p><h2 id="manage-collection-title">{editingCollection.name}</h2>
              <p className="import-description">Choose the stories you want in this collection.</p>
              <label className="collection-picker-search"><Search size={15} /><input value={collectionSearch} onChange={(event) => setCollectionSearch(event.target.value)} placeholder="Search your library..." aria-label="Search your library" autoFocus /></label>
              <div className="collection-picker" aria-label="Series in your library">
                {collectionSeriesLoading && <div className="collection-picker-state" role="status">Loading titles…</div>}
                {collectionSeriesError && <div className="collection-picker-state" role="alert">Could not load titles: {collectionSeriesError.message}</div>}
                {!collectionSeriesLoading && !collectionSeriesError && collectionSeries.length === 0 && <div className="collection-picker-state">No matching titles found.</div>}
                {collectionSeries.map((item) => {
                  const checked = selectedSeriesIds.includes(item.id);
                  return (
                    <label className="collection-picker-row" key={item.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!checked && selectedSeriesIds.length >= 500}
                        onChange={() => setSelectedSeriesIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])}
                      />
                      <span className="collection-picker-copy"><strong>{item.title}</strong><small>{item.author || item.format}</small></span>
                    </label>
                  );
                })}
              </div>
              <div className="collection-manager-footer">
                <span>{selectedSeriesIds.length} stories selected</span>
                <div className="collection-manager-actions">
                  <button className="button button-subtle" onClick={() => setEditingCollection(null)} disabled={updateCollectionSeries.isPending}>Cancel</button>
                  <button className="button button-primary" onClick={() => updateCollectionSeries.mutate({ collectionId: editingCollection.id, seriesIds: selectedSeriesIds })} disabled={updateCollectionSeries.isPending || collectionSeriesLoading || Boolean(collectionSeriesError)}>
                    {updateCollectionSeries.isPending ? "Saving…" : "Save stories"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {message && <div className="toast-message" role="status">{message}<button onClick={() => setMessage("")}><X size={13} /></button></div>}
      </div>
    );
  }

  if (kind === "categories") {
    return (
      <div className="listing-page page-enter">
        <div className="page-heading"><div><p className="eyebrow"><span className="eyebrow-line" /> {info.eyebrow}</p><h1>{info.title}<span className="heading-period">.</span></h1><p className="page-subtitle">{info.subtitle}</p></div>
          <form className="genre-create" onSubmit={(event) => { event.preventDefault(); if (newGenre.trim()) createGenre.mutate(newGenre.trim()); }}>
            <input value={newGenre} onChange={(event) => setNewGenre(event.target.value)} maxLength={64} placeholder="Define a genre" aria-label="New genre name" required />
            <button type="submit" className="button button-primary" disabled={createGenre.isPending}><Plus size={15} /> Add genre</button>
          </form>
        </div>
        <div className="category-grid">
          {genreDefinitions.map((genre, index) => {
            const items = series.filter((item) => item.genres.includes(genre.name));
            return <Link href={`/library?genre=${encodeURIComponent(genre.name)}`} className={`category-card category-${(index % 7) + 1}`} key={genre.id}><span className="category-index">{String(index + 1).padStart(2, "0")}</span><Tag size={17} /><strong>{genre.name}</strong><span>{genre.seriesCount} {genre.seriesCount === 1 ? "story" : "stories"} <ArrowRight size={14} /></span><div className="category-mini-covers">{items.slice(0, 3).map((item) => <span key={item.id} className={`category-mini art-${item.art}`} />)}</div></Link>;
          })}
        </div>
        {genresError && <div className="empty-state" role="alert"><h2>Could not load genres.</h2><p>{genresError.message}</p></div>}
        {genresLoading && <div className="empty-state" role="status">Loading genres…</div>}
        {!genresLoading && !genresError && genreDefinitions.length === 0 && <div className="empty-state"><h2>No genres defined yet.</h2><p>Add a genre here, then assign it while editing a series.</p></div>}
        {message && <div className="toast-message" role="status">{message}<button onClick={() => setMessage("")}><X size={13} /></button></div>}
      </div>
    );
  }

  if (kind === "authors") {
    const authors = Array.from(new Map(series.map((item) => [item.author, item])).values());
    return (
      <div className="listing-page page-enter">
        <div className="page-heading"><div><p className="eyebrow"><span className="eyebrow-line" /> {info.eyebrow}</p><h1>{info.title}<span className="heading-period">.</span></h1><p className="page-subtitle">{info.subtitle}</p></div><label className="library-search author-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find an author..." /></label></div>
        <div className="author-grid">{authors.filter((item) => item.author.toLowerCase().includes(query.toLowerCase())).map((item, index) => <Link href={`/series/${item.id}`} className="author-card" key={item.author}><div className={`author-avatar author-avatar-${(index % 8) + 1}`}><span>{item.author.split(" ").map((part) => part[0]).join("")}</span></div><div><strong>{item.author}</strong><span>{series.filter((entry) => entry.author === item.author).length} titles in your library</span></div><ArrowRight size={15} /></Link>)}</div>
      </div>
    );
  }

  return (
    <div className="listing-page page-enter">
      <div className="page-heading"><div><p className="eyebrow"><span className="eyebrow-line" /> {info.eyebrow}</p><h1>{info.title}<span className="heading-period">.</span></h1><p className="page-subtitle">{info.subtitle}</p></div><label className="library-search author-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a title..." /></label></div>
      {kind === "history" && <div className="history-date"><Clock3 size={15} /><strong>READING HISTORY</strong><span>{filtered.length} titles</span></div>}
      {kind === "continue-reading" && <div className="reading-streak"><span className="streak-icon"><Sparkles size={16} /></span><span><strong>Pick up where you left off.</strong><small>Your progress is saved in PostgreSQL.</small></span></div>}
      <div className="section-title-row listing-count"><h2>{kind === "history" ? "Recently opened" : kind === "continue-reading" ? "In progress" : kind === "favorites" ? "Saved for you" : "In your collection"}</h2><span className="section-note">{filtered.length} titles</span></div>
      {filtered.length ? <div className="series-grid">{filtered.map((item) => <SeriesCard series={item} key={item.id} />)}</div> : <div className="empty-state"><div><BookOpen size={22} /></div><h2>Nothing on this shelf just yet.</h2><p>{kind === "favorites" ? "Bookmark a title to keep it close." : "Add a local archive or start reading to see it here."}</p><Link className="button button-subtle" href="/library">Explore library</Link></div>}
      <div className="listing-footer"><Check size={14} /> Your collection, always close at hand.</div>
    </div>
  );
}
