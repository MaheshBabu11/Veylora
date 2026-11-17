"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowDownAZ, ArrowLeft, ArrowUpAZ, Bookmark, BookOpen, Check, ChevronDown, Clock3, Pencil, Play, Plus, Star, Tag, UserRound } from "lucide-react";
import { CoverArt } from "@/components/cover-art";
import { EditSeriesDialog, type SeriesDetailsUpdate } from "@/components/edit-series-dialog";
import { useOpenImportForSeries } from "@/components/import-series-context";
import type { ReadingStatus } from "@/types/library";
import { fetchJson, useChapters, useSeries } from "@/services/library";

export function  DetailView({ seriesId }: { seriesId: string }) {
  const openImportForSeries = useOpenImportForSeries();
  const { data: series, isLoading, error } = useSeries(seriesId);
  const { data: chapterData = [] } = useChapters(seriesId);
  const queryClient = useQueryClient();
  const [reverse, setReverse] = useState(false);
  const [message, setMessage] = useState("");
  const [chapterLimit, setChapterLimit] = useState(18);
  const [editing, setEditing] = useState(false);
  if (isLoading) return <div className="empty-state" role="status">Loading title…</div>;
  if (error || !series) return <div className="empty-state" role="alert"><h2>Could not load this title.</h2><p>{error?.message ?? "Title not found."}</p><Link className="button button-subtle" href="/library">Back to library</Link></div>;
  const favorite = series.favorite ?? false;
  const status = series.status as ReadingStatus;
  const chapters = [...chapterData].slice(0, chapterLimit);
  if (reverse) chapters.reverse();
  const updateSeries = async (patch: { favorite?: boolean; status?: ReadingStatus }) => {
    try {
      await fetchJson(`/api/series/${series.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      await queryClient.invalidateQueries({ queryKey: ["series"] });
      setMessage("");
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : "Unable to update title.");
    }
  };
  const saveSeriesDetails = async (details: SeriesDetailsUpdate, coverFile?: File) => {
    if (coverFile) {
      const formData = new FormData();
      formData.append("cover", coverFile);
      await fetchJson(`/api/series/${series.id}/cover`, { method: "POST", body: formData });
    }
    await fetchJson(`/api/series/${series.id}`, { method: "PATCH", body: JSON.stringify(details) });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["series"] }),
      queryClient.invalidateQueries({ queryKey: ["genres"] }),
    ]);
    setEditing(false);
    setMessage("");
  };
  return (
    <div className="detail-page page-enter">
      <Link href="/library" className="back-link"><ArrowLeft size={15} /> Back to library</Link>
      <section className="detail-hero">
        <div className="detail-cover-wrap"><CoverArt series={series} /><span className="detail-cover-shadow" /></div>
        <div className="detail-copy">
          <p className="eyebrow"><span className="eyebrow-line" /> {series.genres[0]?.toUpperCase() ?? "UNCATEGORIZED"} · {series.status.toUpperCase()}</p>
          <h1>{series.title}<span className="heading-period">.</span></h1>
          <div className="detail-rating"><span className="rating-star"><Star size={15} fill="currentColor" /></span><strong>{series.rating}</strong><span>Local archive</span><i /></div>
          <p className="detail-description">{series.description}</p>
          <div className="detail-facts">
            <div><span className="detail-fact-heading"><UserRound size={12} /> AUTHOR</span><strong>{series.author || "Unknown creator"}</strong></div>
            <div><span className="detail-fact-heading"><BookOpen size={12} /> CHAPTERS</span><strong>{series.chapters} chapters</strong></div>
            <div><span className="detail-fact-heading"><Archive size={12} /> FORMAT</span><strong>{series.format}</strong></div>
            <div><span className="detail-fact-heading"><Bookmark size={12} /> READING LIST</span><strong>{series.status}</strong></div>
          </div>
          <div className="genre-list">{series.genres.map((item) => <span key={item}><Tag size={12} />{item}</span>)}</div>
          <div className="detail-actions">
            <Link href={chapters[0] ? `/reader/${chapters.find((chapter) => chapter.chapter_number === series.readChapters)?.id ?? chapters[0].id}` : "#chapters"} className="button button-primary"><Play size={15} fill="currentColor" /> {series.readChapters ? "Continue reading" : "Start reading"}</Link>
            <button className={`button button-subtle ${favorite ? "button-active" : ""}`} onClick={() => void updateSeries({ favorite: !favorite })}>{favorite ? <Check size={16} /> : <Bookmark size={16} />}{favorite ? "In favorites" : "Add to favorites"}</button>
            <label className="status-select"><span className="status-select-dot" /><select value={status} onChange={(event) => void updateSeries({ status: event.target.value as ReadingStatus })} aria-label="Reading status"><option>Reading</option><option>Plan to read</option><option>Completed</option><option>On hold</option></select><ChevronDown size={14} /></label>
            <button className="button button-subtle" onClick={() => setEditing(true)}><Pencil size={15} /> Edit details</button>
          </div>
        </div>
      </section>

      <section className="chapter-section">
        <div className="section-heading chapter-heading">
          <div><div className="section-title-row"><h2>Chapters</h2><span className="section-note">{series.chapters} chapters in your library</span></div></div>
          <div className="chapter-heading-actions">
            <button className="button button-subtle button-small" onClick={() => openImportForSeries({ id: series.id, title: series.title })}><Plus size={15} /> Add chapters</button>
            <button className="button button-subtle button-small" onClick={() => setReverse((old) => !old)}>{reverse ? <ArrowDownAZ size={15} /> : <ArrowUpAZ size={15} />}{reverse ? "Oldest first" : "Newest first"}</button>
          </div>
        </div>
        <div className="chapter-list">
          {chapters.map((chapter) => {
            const read = Boolean(chapter.last_read);
            return (
              <Link key={chapter.id} href={`/reader/${chapter.id}`} className={`chapter-row ${read ? "chapter-read" : ""}`}>
                <span className="chapter-read-indicator">{read ? <Check size={12} /> : String(chapter.chapter_number).padStart(2, "0")}</span>
                <span className="chapter-main"><strong>Chapter {String(chapter.chapter_number).padStart(2, "0")}</strong><small>{chapter.title}</small></span>
                <span className="chapter-pages">{chapter.page_count} pages</span>
                <span className="chapter-last-read">{read ? <><Clock3 size={12} />{chapter.last_page == null ? "Read" : `Page ${chapter.last_page}`}</> : "Unread"}</span>
                <Play className="chapter-play" size={14} fill="currentColor" />
              </Link>
            );
          })}
          {chapterLimit < chapterData.length && <button className="load-chapters" onClick={() => setChapterLimit((limit) => limit + 18)}><Plus size={14} /> Load more chapters</button>}
        </div>
      </section>
      {message && <div className="toast-message" role="alert">{message}<button onClick={() => setMessage("")}>×</button></div>}
      {editing && <EditSeriesDialog series={series} onClose={() => setEditing(false)} onSave={saveSeriesDetails} />}
    </div>
  );
}
