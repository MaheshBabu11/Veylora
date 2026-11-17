"use client";

import { useState, type FormEvent } from "react";
import { ArrowUpRight, Library, Plus, Upload, X } from "lucide-react";
import { uploadBookArchives, type BookUploadResult } from "@/services/import";
import { useSeriesList } from "@/services/library";
import type { ImportSeriesTarget } from "@/components/import-series-context";

type Props = {
  scanning: boolean;
  initialSeries?: ImportSeriesTarget;
  onClose: () => void;
  onScanLibrary?: () => void;
  onImportComplete: (result: BookUploadResult) => Promise<void>;
};

function suggestedChapterNumber(name: string, fallback: number) {
  const match = name.match(/(?:chapter|ch|vol(?:ume)?)[ ._-]*(\d+)/i);
  return match ? Number(match[1]) : fallback;
}

function suggestedSeriesTitle(name: string) {
  const withoutExtension = name.replace(/\.(cbz|zip)$/i, "");
  const title = withoutExtension.replace(/(?:chapter|ch|vol(?:ume)?)[ ._-]*\d+.*$/i, "").replace(/[._-]+/g, " ").trim();
  return title || "New Series";
}

export function ImportDialog({ scanning, initialSeries, onClose, onScanLibrary, onImportComplete }: Props) {
  const [seriesMode, setSeriesMode] = useState<"new" | "existing">(initialSeries ? "existing" : "new");
  const [seriesTitle, setSeriesTitle] = useState("");
  const [seriesId, setSeriesId] = useState(initialSeries?.id ?? "");
  const [authorName, setAuthorName] = useState("");
  const [description, setDescription] = useState("");
  const [genres, setGenres] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [chapterNumbers, setChapterNumbers] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const { data: library, isLoading: loadingSeries, error: seriesError } = useSeriesList({ limit: 500, sort: "title", enabled: !initialSeries });
  const existingSeries = library?.items ?? [];

  const selectFiles = (selectedFiles: File[]) => {
    if (selectedFiles.length > 100) {
      setFiles([]);
      setChapterNumbers([]);
      setError("Select no more than 100 chapter archives at a time.");
      return;
    }
    setError("");
    setFiles(selectedFiles);
    if (!seriesTitle && selectedFiles[0]) setSeriesTitle(suggestedSeriesTitle(selectedFiles[0].name));
    const usedNumbers = new Set<number>();
    setChapterNumbers(selectedFiles.map((file, index) => {
      let number = suggestedChapterNumber(file.name, index + 1);
      while (usedNumbers.has(number)) number += 1;
      usedNumbers.add(number);
      return String(number);
    }));
  };

  const submitUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setUploading(true);
    try {
      const chapters = files.map((file, index) => ({
        file,
        chapterNumber: Number(chapterNumbers[index]),
      }));
      const result = await uploadBookArchives({
        ...(seriesMode === "existing" ? { seriesId } : { seriesTitle }),
        chapters,
        ...(seriesMode === "new" ? { authorName, description, genres } : {}),
      });
      await onImportComplete(result);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "The archives could not be uploaded.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="overlay-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !uploading && onClose()}>
      <div className="import-dialog import-dialog-upload" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <button className="dialog-close import-close" onClick={onClose} aria-label="Close import dialog" disabled={uploading}><X size={17} /></button>
        <div className="dialog-icon"><Plus size={20} /></div>
        <p className="eyebrow">{initialSeries ? "CONTINUE READING" : "GROW YOUR COLLECTION"}</p>
        <h2 id="import-title">{initialSeries ? "Add chapters." : "Import chapters."}</h2>
        <p className="import-description">{initialSeries ? `Upload new chapters directly to ${initialSeries.title}.` : "Add one or more CBZ/ZIP chapters to a new series or continue an existing one."}</p>

        <form className="import-upload-form" onSubmit={(event) => void submitUpload(event)}>
          {!initialSeries && <div className="import-series-mode" role="group" aria-label="Series destination">
            <button type="button" className={seriesMode === "new" ? "selected" : ""} onClick={() => { setSeriesMode("new"); setSeriesId(""); }}>
              <Plus size={14} /> New series
            </button>
            <button type="button" className={seriesMode === "existing" ? "selected" : ""} onClick={() => setSeriesMode("existing")}>
              <Library size={14} /> Existing series
            </button>
          </div>}
          {initialSeries ? (
            <label className="import-upload-field">
              <span>Series destination</span>
              <input value={initialSeries.title} readOnly />
            </label>
          ) : seriesMode === "new" ? (
            <label className="import-upload-field">
              <span>Series name <b>Required</b></span>
              <input value={seriesTitle} onChange={(event) => setSeriesTitle(event.target.value)} maxLength={100} required placeholder="e.g. The Moonlit Garden" />
            </label>
          ) : (
            <label className="import-upload-field">
              <span>Choose a series <b>Required</b></span>
              <select value={seriesId} onChange={(event) => setSeriesId(event.target.value)} required disabled={uploading || loadingSeries || existingSeries.length === 0}>
                <option value="">{loadingSeries ? "Loading your series…" : "Select an existing series"}</option>
                {existingSeries.map((series) => <option value={series.id} key={series.id}>{series.title} · {series.chapters} chapters</option>)}
              </select>
              {seriesError && <small role="alert">Could not load series: {seriesError.message}</small>}
              {!loadingSeries && !seriesError && existingSeries.length === 0 && <small>No series found yet. Create a new series or scan your library first.</small>}
            </label>
          )}
          <label className="import-upload-field">
            <span>Chapter archives <b>Required</b></span>
            <input type="file" accept=".cbz,.zip,application/zip" multiple required disabled={uploading || scanning} onChange={(event) => selectFiles(Array.from(event.currentTarget.files ?? []))} />
            <small>Select up to 100 chapter archives at once (2 GiB per file, 4 GiB total).</small>
          </label>

          {files.length > 0 && <div className="import-chapter-list">
            {files.map((file, index) => <label className="import-chapter-row" key={`${file.name}-${index}`}>
              <span title={file.name}>{file.name}</span>
              <span>Chapter</span>
              <input aria-label={`Chapter number for ${file.name}`} type="number" min="1" step="1" required value={chapterNumbers[index] ?? ""} onChange={(event) => setChapterNumbers((numbers) => numbers.map((number, numberIndex) => numberIndex === index ? event.target.value : number))} />
            </label>)}
          </div>}

          {seriesMode === "new" && <details className="import-optional-details">
            <summary>Series details <span>Optional</span></summary>
            <label className="import-upload-field">
              <span>Author</span>
              <input value={authorName} onChange={(event) => setAuthorName(event.target.value)} maxLength={160} placeholder="Author or artist" />
            </label>
            <label className="import-upload-field">
              <span>Description</span>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} rows={3} placeholder="A short series description" />
            </label>
            <label className="import-upload-field">
              <span>Genres <small>Comma-separated</small></span>
              <input value={genres} onChange={(event) => setGenres(event.target.value)} maxLength={1200} placeholder="Adventure, Fantasy" />
            </label>
          </details>}

          {error && <p className="import-upload-error" role="alert">{error}</p>}
          <button className="import-upload-submit" type="submit" disabled={uploading || scanning || files.length === 0 || (seriesMode === "existing" && !seriesId)}>
            <Upload size={15} />{uploading ? "Uploading…" : scanning ? "Library scan in progress…" : files.length ? `Upload ${files.length} chapter${files.length === 1 ? "" : "s"}` : "Upload chapters"}
          </button>
        </form>

        {onScanLibrary && <div className="import-existing">
          <span>Already have books in the folder?</span>
          <button onClick={onScanLibrary} disabled={scanning || uploading}><Library size={15} /><span>{scanning ? "Scan in progress" : "Scan existing books"}</span><ArrowUpRight size={14} /></button>
        </div>}
        <p className="import-footnote">Local-only · Archives stay on this device</p>
      </div>
    </div>
  );
}
