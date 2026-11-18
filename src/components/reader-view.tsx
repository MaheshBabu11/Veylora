"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowRight, BookOpen, ChevronLeft, ChevronRight, Maximize, Minus, Plus, Settings2, X } from "lucide-react";
import { usePreferencesStore } from "@/stores/preferences";
import { fetchJson, useChapter, useChapterPages, useChapters } from "@/services/library";

function ReaderStackPage({ url, alt, pageNumber, zoom }: { url: string; alt: string; pageNumber: number; zoom: number }) {
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);

  return <div className="reader-page" data-reader-page={pageNumber} style={aspectRatio ? { aspectRatio } : undefined}>
    <Image
      src={url}
      alt={alt}
      fill
      unoptimized
      sizes="100vw"
      onLoad={(event) => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (naturalWidth && naturalHeight) setAspectRatio(naturalWidth / naturalHeight);
      }}
      style={{ objectFit: "contain", transform: `scale(${zoom / 100})` }}
    />
    <span className="reader-page-number">{String(pageNumber).padStart(2, "0")}</span>
  </div>;
}

export function ReaderView({ chapterId }: { chapterId: string }) {
  const readerRef = useRef<HTMLElement | null>(null);
  const readerScrollRef = useRef<HTMLDivElement | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const hasRestoredProgress = useRef(false);
  const { data: chapter, isLoading, error } = useChapter(chapterId);
  const seriesId = chapter?.series_id ?? "";
  const { data: chapters = [] } = useChapters(seriesId);
  const { data: pages = [] } = useChapterPages(seriesId, chapterId);
  const queryClient = useQueryClient();
  const [pageOverride, setPageOverride] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const readerSettings = usePreferencesStore((state) => state.readerSettings);
  const setReaderSettings = usePreferencesStore((state) => state.setReaderSettings);
  const direction = usePreferencesStore((state) => state.direction);
  const setDirection = usePreferencesStore((state) => state.setDirection);
  const mode = usePreferencesStore((state) => state.readerMode);
  const setMode = usePreferencesStore((state) => state.setReaderMode);
  const savedPage = usePreferencesStore((state) => state.progressByChapter[chapterId] ?? chapter?.last_page ?? 1);
  const saveReaderProgress = usePreferencesStore((state) => state.setReaderProgress);
  const { bottomBarVisible, pageRailVisible, pageWidth, zoom } = readerSettings;
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
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (readerRef.current?.requestFullscreen) void readerRef.current.requestFullscreen();
  }, []);
  const scrollToReaderPage = useCallback((targetPage: number) => {
    const container = readerScrollRef.current;
    const target = container?.querySelector<HTMLElement>(`[data-reader-page="${targetPage}"]`);
    if (!container || !target) return false;

    const topbarHeight = readerRef.current?.querySelector(".reader-topbar")?.getBoundingClientRect().height ?? 0;
    const containerTop = container.getBoundingClientRect().top;
    const targetTop = target.getBoundingClientRect().top;
    container.scrollTo({
      top: container.scrollTop + targetTop - containerTop - topbarHeight,
      behavior: "smooth",
    });
    return true;
  }, []);

  useEffect(() => {
    if (mode !== "vertical" || !chapter || pages.length === 0 || hasRestoredProgress.current) return;
    const frame = window.requestAnimationFrame(() => {
      hasRestoredProgress.current = scrollToReaderPage(page);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [chapter, mode, page, pages.length, scrollToReaderPage]);

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
      if (event.key === "Escape") {
        setSettingsOpen(false);
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select, [role='textbox']"))) return;
      if (settingsOpen) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        step(direction === "rtl" ? -1 : 1);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(direction === "rtl" ? 1 : -1);
      }
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [direction, settingsOpen, step, toggleFullscreen]);

  if (isLoading) return <main className="reader-app"><div className="empty-state" role="status">Opening chapter…</div></main>;
  if (error || !chapter) return <main className="reader-app"><div className="empty-state" role="alert"><h2>Could not open this chapter.</h2><p>{error?.message ?? "Chapter not found."}</p><Link className="button button-subtle" href="/library">Back to library</Link></div></main>;

  return <main ref={readerRef} className="reader-app" onMouseMove={() => setToolbarVisible(true)}>
    <header className={`reader-topbar ${toolbarVisible ? "" : "reader-hidden"}`}>
      <Link href={`/series/${seriesId}`} className="reader-back"><ArrowLeft size={17} /><span>Back to series</span></Link>
      <div className="reader-chapter-title"><span>{chapter.series.title}</span><i>/</i><strong>{chapter.title}</strong></div>
      <div className="reader-top-actions"><span className="reader-save-indicator"><i /> {saveMessage}</span><button className="reader-tool" onClick={toggleFullscreen} title="Toggle fullscreen"><Maximize size={17} /></button><button className="reader-tool" onClick={() => setSettingsOpen((value) => !value)} title="Reader settings"><Settings2 size={18} /></button></div>
    </header>
    <aside className={`reader-rail ${toolbarVisible && pageRailVisible ? "" : "reader-hidden"}`}><span className="reader-rail-brand">V</span><span className="reader-rail-line" /><span className="reader-rail-chapter">CH. {String(chapter.chapter_number).padStart(2, "0")}</span><span className="reader-rail-line" /><span className="reader-rail-page">{String(page).padStart(2, "0")} <i>/ {totalPages}</i></span></aside>
    {pages.length === 0 ? <div className="empty-state" role="alert">This archive has no readable pages.</div> : mode === "vertical" ? (
      <div ref={readerScrollRef} className="reader-scroll" onScroll={(event) => {
        const element = event.currentTarget;
        const readerTop = element.getBoundingClientRect().top
          + (readerRef.current?.querySelector(".reader-topbar")?.getBoundingClientRect().height ?? 0);
        const currentPage = [...element.querySelectorAll<HTMLElement>("[data-reader-page]")]
          .find((pageElement) => pageElement.getBoundingClientRect().bottom > readerTop);
        if (currentPage) setPage(Number(currentPage.dataset.readerPage));
      }}>
        <div className="reader-page-stack" style={{ width: `${pageWidth}%` }}>
          {pages.map((item) => <ReaderStackPage
            key={item.pageNumber}
            url={item.url}
            alt={`${chapter.series.title}, ${chapter.title}, page ${item.pageNumber}`}
            pageNumber={item.pageNumber}
            zoom={zoom}
          />)}
          <div className="reader-chapter-end"><span>END OF {chapter.title.toUpperCase()}</span><h2>One more, or a little rest?</h2><p>You’re {Math.round(chapter.chapter_number / Math.max(chapter.series.chapters, 1) * 100)}% through {chapter.series.title}.</p>{nextChapter && <Link href={`/reader/${nextChapter.id}`} className="button button-primary">Next chapter <ArrowRight size={15} /></Link>}</div>
        </div>
      </div>
    ) : (
      <div className="single-page-stage" onTouchStart={(event) => {
        const touch = event.changedTouches[0];
        touchStart.current = { x: touch.clientX, y: touch.clientY };
      }} onTouchEnd={(event) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start) return;
        const touch = event.changedTouches[0];
        const deltaX = touch.clientX - start.x;
        const deltaY = touch.clientY - start.y;
        if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
        step(deltaX < 0 ? (direction === "rtl" ? -1 : 1) : (direction === "rtl" ? 1 : -1));
      }} onTouchCancel={() => { touchStart.current = null; }}>
        <button type="button" className="page-nav page-nav-left" aria-label="Previous page" onClick={() => step(direction === "rtl" ? 1 : -1)}><ChevronLeft size={20} /></button>
        <div className="reader-page single-reader-page"><Image src={pageByNumber.get(page) ?? pages[0].url} alt={`${chapter.series.title}, ${chapter.title}, page ${page}`} fill unoptimized sizes="(max-width: 800px) 80vw, 700px" style={{ objectFit: "contain", transform: `scale(${zoom / 100})` }} /><span className="reader-page-number">{String(page).padStart(2, "0")}</span></div>
        <button type="button" className="page-nav page-nav-right" aria-label="Next page" onClick={() => step(direction === "rtl" ? -1 : 1)}><ChevronRight size={20} /></button>
      </div>
    )}
    <footer className={`reader-bottom ${toolbarVisible && bottomBarVisible ? "" : "reader-hidden"}`}>
      {previousChapter ? <Link href={`/reader/${previousChapter.id}`} className="reader-chapter-nav"><ChevronLeft size={17} /><span>Previous chapter</span></Link> : <span className="reader-chapter-nav" />}
      <div className="reader-progress-control"><span>CHAPTER {String(chapter.chapter_number).padStart(2, "0")}</span><input aria-label="Reading progress" type="range" min="1" max={totalPages} value={page} onChange={(event) => {
        const selectedPage = Number(event.target.value);
        setPage(selectedPage);
        if (mode === "vertical") scrollToReaderPage(selectedPage);
      }} /><span>{String(page).padStart(2, "0")} <i>/ {totalPages}</i></span></div>
      {nextChapter ? <Link href={`/reader/${nextChapter.id}`} className="reader-chapter-nav next"><span>Next chapter</span><ChevronRight size={17} /></Link> : <span className="reader-chapter-nav next" />}
      <button className="reader-bottom-toggle" onClick={() => setToolbarVisible((value) => !value)} aria-label="Hide reader controls"><ArrowDown size={15} /></button>
    </footer>
    {!toolbarVisible && <button type="button" className="reader-controls-reveal" onClick={() => setToolbarVisible(true)} aria-label="Show reader controls">Show controls</button>}
    {settingsOpen && <div className="reader-settings-popover">
      <div className="reader-settings-head">
        <span>Reading settings</span>
        <button onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={15} /></button>
      </div>
      <div className="reader-setting">
        <span>Reading mode</span>
        <div className="reader-segment">
          <button className={mode === "vertical" ? "active" : ""} onClick={() => setMode("vertical")}><ArrowDown size={14} /> Vertical</button>
          <button className={mode === "single" ? "active" : ""} onClick={() => setMode("single")}><BookOpen size={14} /> Single page</button>
        </div>
      </div>
      <div className="reader-setting">
        <span>Reading direction</span>
        <div className="reader-segment">
          <button className={direction === "rtl" ? "active" : ""} onClick={() => setDirection("rtl")}><ArrowRight size={14} /> Right to left</button>
          <button className={direction === "ltr" ? "active" : ""} onClick={() => setDirection("ltr")}><ArrowLeft size={14} /> Left to right</button>
        </div>
      </div>
      <div className="reader-setting reader-visibility-setting">
        <span>Reader controls</span>
        <label><input type="checkbox" checked={bottomBarVisible} onChange={(event) => setReaderSettings({ bottomBarVisible: event.target.checked })} /> Show bottom bar</label>
        <label><input type="checkbox" checked={pageRailVisible} onChange={(event) => setReaderSettings({ pageRailVisible: event.target.checked })} /> Show side page indicator</label>
      </div>
      {mode === "vertical" && <div className="reader-setting reader-width-setting">
        <div><span>Vertical page width</span><strong>{pageWidth}%</strong></div>
        <input aria-label="Vertical page width" type="range" min="40" max="100" step="5" value={pageWidth} onChange={(event) => setReaderSettings({ pageWidth: Number(event.target.value) })} />
      </div>}
      <div className="reader-setting zoom-setting">
        <span>Image zoom</span>
        <div>
          <button onClick={() => setReaderSettings({ zoom: Math.max(70, zoom - 10) })} aria-label="Zoom out"><Minus size={13} /></button>
          <span>{zoom}%</span>
          <button onClick={() => setReaderSettings({ zoom: Math.min(140, zoom + 10) })} aria-label="Zoom in"><Plus size={13} /></button>
        </div>
      </div>
      <div className="reader-key-hint">← → <span>Change page</span><kbd>F</kbd><span>Fullscreen</span></div>
    </div>}
  </main>;
}
