"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowRight, BookOpen, ChevronLeft, ChevronRight, Maximize, Minus, Plus, Settings2, X } from "lucide-react";
import { usePreferencesStore } from "@/stores/preferences";
import { fetchJson, useChapter, useChapterPages, useChapters } from "@/services/library";

export function ReaderView({ chapterId }: { chapterId: string }) {
  const { data: chapter, isLoading, error } = useChapter(chapterId);
  const seriesId = chapter?.series_id ?? "";
  const { data: chapters = [] } = useChapters(seriesId);
  const { data: pages = [] } = useChapterPages(seriesId, chapterId);
  const queryClient = useQueryClient();
  const [pageOverride, setPageOverride] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const direction = usePreferencesStore((state) => state.direction);
  const setDirection = usePreferencesStore((state) => state.setDirection);
  const mode = usePreferencesStore((state) => state.readerMode);
  const setMode = usePreferencesStore((state) => state.setReaderMode);
  const savedPage = usePreferencesStore((state) => state.progressByChapter[chapterId] ?? chapter?.last_page ?? 1);
  const saveReaderProgress = usePreferencesStore((state) => state.setReaderProgress);
  const [zoom, setZoom] = useState(100);
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const [saveMessage, setSaveMessage] = useState("Progress saved");
  const totalPages = chapter?.page_count ?? 1;
  const page = Math.min(totalPages, Math.max(1, pageOverride ?? savedPage));
  const chapterIndex = chapters.findIndex((item) => item.id === chapterId);
  const previousChapter = chapterIndex > 0 ? chapters[chapterIndex - 1] : undefined;
  const nextChapter = chapterIndex >= 0 ? chapters[chapterIndex + 1] : undefined;
  const pageByNumber = useMemo(() => new Map(pages.map((item) => [item.pageNumber, item.url])), [pages]);

  const setPage = useCallback((value: number | ((current: number) => number)) => {
    setPageOverride((currentOverride) => {
      const current = currentOverride ?? savedPage;
      return typeof value === "function" ? value(current) : value;
    });
  }, [savedPage]);
  const step = useCallback((amount: number) => setPage((current) => Math.min(totalPages, Math.max(1, current + amount))), [setPage, totalPages]);

  useEffect(() => {
    if (!chapter || page > totalPages) return;
    const timeout = window.setTimeout(() => {
      saveReaderProgress(chapterId, page);
      setSaveMessage("Saving progress…");
      void fetchJson("/api/reading-progress", {
        method: "POST",
        body: JSON.stringify({ chapterId, page }),
      }).then(async () => {
        setSaveMessage("Progress saved");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["reading-progress"] }),
          queryClient.invalidateQueries({ queryKey: ["series"] }),
          queryClient.invalidateQueries({ queryKey: ["chapters", seriesId] }),
        ]);
      }).catch((saveError: unknown) => {
        setSaveMessage(saveError instanceof Error ? saveError.message : "Could not save progress.");
      });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [chapter, chapterId, seriesId, page, queryClient, saveReaderProgress, totalPages]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") step(direction === "rtl" ? -1 : 1);
      if (event.key === "ArrowLeft") step(direction === "rtl" ? 1 : -1);
      if (event.key === "Escape") setSettingsOpen(false);
      if (event.key.toLowerCase() === "f") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [direction, step]);

  if (isLoading) return <main className="reader-app"><div className="empty-state" role="status">Opening chapter…</div></main>;
  if (error || !chapter) return <main className="reader-app"><div className="empty-state" role="alert"><h2>Could not open this chapter.</h2><p>{error?.message ?? "Chapter not found."}</p><Link className="button button-subtle" href="/library">Back to library</Link></div></main>;

  return <main className="reader-app" onMouseMove={() => setToolbarVisible(true)}>
    <header className={`reader-topbar ${toolbarVisible ? "" : "reader-hidden"}`}>
      <Link href={`/series/${seriesId}`} className="reader-back"><ArrowLeft size={17} /><span>Back to series</span></Link>
      <div className="reader-chapter-title"><span>{chapter.series.title}</span><i>/</i><strong>{chapter.title}</strong></div>
      <div className="reader-top-actions"><span className="reader-save-indicator"><i /> {saveMessage}</span><button className="reader-tool" onClick={() => document.documentElement.requestFullscreen?.()} title="Toggle fullscreen"><Maximize size={17} /></button><button className="reader-tool" onClick={() => setSettingsOpen((value) => !value)} title="Reader settings"><Settings2 size={18} /></button></div>
    </header>
    <aside className={`reader-rail ${toolbarVisible ? "" : "reader-hidden"}`}><span className="reader-rail-brand">V</span><span className="reader-rail-line" /><span className="reader-rail-chapter">CH. {String(chapter.chapter_number).padStart(2, "0")}</span><span className="reader-rail-line" /><span className="reader-rail-page">{String(page).padStart(2, "0")} <i>/ {totalPages}</i></span></aside>
    {pages.length === 0 ? <div className="empty-state" role="alert">This archive has no readable pages.</div> : mode === "vertical" ? (
      <div className="reader-scroll" onScroll={(event) => {
        const element = event.currentTarget;
        const fraction = element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight);
        setPage(Math.max(1, Math.min(totalPages, Math.ceil(fraction * totalPages))));
      }}>
        <div className="reader-page-stack">
          {pages.map((item) => <div key={item.pageNumber} className="reader-page">
            <Image src={item.url} alt={`${chapter.series.title}, ${chapter.title}, page ${item.pageNumber}`} fill unoptimized sizes="(max-width: 800px) 100vw, 750px" style={{ objectFit: "contain", transform: `scale(${zoom / 100})` }} />
            <span className="reader-page-number">{String(item.pageNumber).padStart(2, "0")}</span>
          </div>)}
          <div className="reader-chapter-end"><span>END OF {chapter.title.toUpperCase()}</span><h2>One more, or a little rest?</h2><p>You’re {Math.round(chapter.chapter_number / Math.max(chapter.series.chapters, 1) * 100)}% through {chapter.series.title}.</p>{nextChapter && <Link href={`/reader/${nextChapter.id}`} className="button button-primary">Next chapter <ArrowRight size={15} /></Link>}</div>
        </div>
      </div>
    ) : (
      <div className="single-page-stage"><button className="page-nav page-nav-left" aria-label="Previous page" onClick={() => step(direction === "rtl" ? 1 : -1)}><ChevronLeft size={20} /></button><div className="reader-page single-reader-page"><Image src={pageByNumber.get(page) ?? pages[0].url} alt={`${chapter.series.title}, ${chapter.title}, page ${page}`} fill unoptimized sizes="(max-width: 800px) 80vw, 700px" style={{ objectFit: "contain", transform: `scale(${zoom / 100})` }} /><span className="reader-page-number">{String(page).padStart(2, "0")}</span></div><button className="page-nav page-nav-right" aria-label="Next page" onClick={() => step(direction === "rtl" ? -1 : 1)}><ChevronRight size={20} /></button></div>
    )}
    <footer className={`reader-bottom ${toolbarVisible ? "" : "reader-hidden"}`}>
      {previousChapter ? <Link href={`/reader/${previousChapter.id}`} className="reader-chapter-nav"><ChevronLeft size={17} /><span>Previous chapter</span></Link> : <span className="reader-chapter-nav" />}
      <div className="reader-progress-control"><span>CHAPTER {String(chapter.chapter_number).padStart(2, "0")}</span><input aria-label="Reading progress" type="range" min="1" max={totalPages} value={page} onChange={(event) => setPage(Number(event.target.value))} /><span>{String(page).padStart(2, "0")} <i>/ {totalPages}</i></span></div>
      {nextChapter ? <Link href={`/reader/${nextChapter.id}`} className="reader-chapter-nav next"><span>Next chapter</span><ChevronRight size={17} /></Link> : <span className="reader-chapter-nav next" />}
      <button className="reader-bottom-toggle" onClick={() => setToolbarVisible((value) => !value)} aria-label="Hide reader controls"><ArrowDown size={15} /></button>
    </footer>
    {settingsOpen && <div className="reader-settings-popover"><div className="reader-settings-head"><span>Reading settings</span><button onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={15} /></button></div><div className="reader-setting"><span>Reading mode</span><div className="reader-segment"><button className={mode === "vertical" ? "active" : ""} onClick={() => setMode("vertical")}><ArrowDown size={14} /> Vertical</button><button className={mode === "single" ? "active" : ""} onClick={() => setMode("single")}><BookOpen size={14} /> Single page</button></div></div><div className="reader-setting"><span>Reading direction</span><div className="reader-segment"><button className={direction === "rtl" ? "active" : ""} onClick={() => setDirection("rtl")}><ArrowRight size={14} /> Right to left</button><button className={direction === "ltr" ? "active" : ""} onClick={() => setDirection("ltr")}><ArrowLeft size={14} /> Left to right</button></div></div><div className="reader-setting zoom-setting"><span>Image zoom</span><div><button onClick={() => setZoom((value) => Math.max(70, value - 10))} aria-label="Zoom out"><Minus size={13} /></button><span>{zoom}%</span><button onClick={() => setZoom((value) => Math.min(140, value + 10))} aria-label="Zoom in"><Plus size={13} /></button></div></div><div className="reader-key-hint">← → <span>Change page</span><kbd>F</kbd><span>Fullscreen</span></div></div>}
  </main>;
}
