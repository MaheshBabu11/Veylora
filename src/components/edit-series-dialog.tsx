"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { ImagePlus, Save, X } from "lucide-react";
import { useGenres } from "@/services/library";
import { SERIES_FORMATS, type Series, type SeriesFormat } from "@/types/library";

const MAX_COVER_BYTES = 20 * 1024 * 1024;
const COVER_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export type SeriesDetailsUpdate = {
  title: string;
  format: SeriesFormat;
  authorName: string;
  description: string;
  genreIds: string[];
  featured: boolean;
};

export function EditSeriesDialog({
  series,
  onClose,
  onSave,
}: {
  series: Series;
  onClose: () => void;
  onSave: (details: SeriesDetailsUpdate, coverFile?: File) => Promise<void>;
}) {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const { data: genres = [], isLoading: genresLoading, error: genresError } = useGenres();
  const [title, setTitle] = useState(series.title);
  const [format, setFormat] = useState<SeriesFormat>(series.format);
  const [authorName, setAuthorName] = useState(series.author === "Unknown author" ? "" : series.author);
  const [description, setDescription] = useState(series.description === "No description has been added." ? "" : series.description);
  const [genreIds, setGenreIds] = useState(() => series.genreIds ?? []);
  const [featured, setFeatured] = useState(series.featured);
  const [coverFile, setCoverFile] = useState<File | undefined>();
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [coverUnavailable, setCoverUnavailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setPortalTarget(document.body));
    return () => cancelAnimationFrame(frame);
  }, []);

  const toggleGenre = (genreId: string) => {
    setGenreIds((selected) => selected.includes(genreId)
      ? selected.filter((id) => id !== genreId)
      : [...selected, genreId]);
  };

  const selectCover = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_COVER_BYTES) {
      setErrorMessage("Cover images must be 20 MiB or smaller.");
      event.target.value = "";
      return;
    }
    if (file.type && !COVER_MIME_TYPES.has(file.type)) {
      setErrorMessage("Choose a JPEG, PNG, WebP, or GIF image.");
      event.target.value = "";
      return;
    }
    setErrorMessage("");
    setCoverFile(file);
    setCoverUnavailable(false);
    const reader = new FileReader();
    reader.onload = () => setCoverPreview(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => setErrorMessage("Could not preview the selected cover image.");
    reader.readAsDataURL(file);
  };

  const clearCoverSelection = () => {
    setCoverFile(undefined);
    setCoverPreview(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        format,
        authorName: authorName.trim(),
        description,
        genreIds,
        featured,
      }, coverFile);
    } catch (saveError) {
      setErrorMessage(saveError instanceof Error ? saveError.message : "Could not save series details.");
    } finally {
      setSaving(false);
    }
  };

  const imageSource = coverPreview ?? (!coverUnavailable ? series.coverUrl : undefined);

  const dialog = (
    <div className="overlay-backdrop edit-series-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="edit-series-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-series-title">
        <button className="dialog-close import-close" onClick={onClose} aria-label="Close" type="button"><X size={17} /></button>
        <p className="eyebrow"><span className="eyebrow-line" /> YOUR LIBRARY, YOUR WAY</p>
        <h2 id="edit-series-title">Edit series details</h2>
        <p className="edit-series-intro">Changes to the title are kept when your library is scanned again.</p>
        <form onSubmit={submit}>
          <div className="edit-series-grid">
            <div className="edit-series-fields">
              <label className="edit-field">
                <span>Series title</span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required />
              </label>
              <label className="edit-field">
                <span>Format</span>
                <select value={format} onChange={(event) => {
                  const selectedFormat = SERIES_FORMATS.find((option) => option === event.currentTarget.value);
                  if (selectedFormat) setFormat(selectedFormat);
                }}>
                  {SERIES_FORMATS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label className="edit-field">
                <span>Author <small>Optional</small></span>
                <input value={authorName} onChange={(event) => setAuthorName(event.target.value)} maxLength={160} placeholder="Add an author" />
              </label>
              <label className="edit-field">
                <span>Description <small>Optional</small></span>
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={20000} rows={4} placeholder="A short introduction to this series" />
              </label>
              <div className="edit-field">
                <span>Genres</span>
                {genresLoading ? <p className="edit-field-hint">Loading genres…</p> : genresError
                  ? <p className="edit-field-hint" role="alert">Could not load genres: {genresError.message}</p>
                  : genres.length
                    ? <div className="edit-genre-options">{genres.map((genre) => (
                      <label key={genre.id} className={genreIds.includes(genre.id) ? "edit-genre-selected" : ""}>
                        <input
                          type="checkbox"
                          checked={genreIds.includes(genre.id)}
                          disabled={!genreIds.includes(genre.id) && genreIds.length >= 32}
                          onChange={() => toggleGenre(genre.id)}
                        />
                        <span>{genre.name}</span>
                      </label>
                    ))}</div>
                    : <p className="edit-field-hint">No genres defined yet. <Link href="/categories">Create genres in Categories</Link>.</p>}
              </div>
              <label className={`edit-featured-toggle ${featured ? "selected" : ""}`}>
                <input type="checkbox" checked={featured} onChange={(event) => setFeatured(event.target.checked)} />
                <span><strong>Feature on Home</strong><small>Show this series in your featured selection.</small></span>
              </label>
            </div>
            <div className="edit-cover-panel">
              <div className="edit-cover-heading"><ImagePlus size={16} /><span>Upload cover image</span></div>
              <div className="edit-cover-preview">
                {imageSource
                  ? <Image
                    key={coverPreview ?? series.coverUrl}
                    src={imageSource}
                    alt={`${series.title} cover preview`}
                    width={240}
                    height={340}
                    unoptimized
                    onError={() => setCoverUnavailable(true)}
                  />
                  : <div className="edit-cover-placeholder"><ImagePlus size={24} /><span>Choose an image to set the series cover.</span></div>}
              </div>
              <label className="edit-field edit-cover-upload">
                <span>Cover image <small>Optional · max 20 MiB</small></span>
                <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={selectCover} />
              </label>
              {coverFile && <button type="button" className="edit-clear-cover" onClick={clearCoverSelection}>Remove selected file</button>}
              <p className="edit-field-hint">JPEG, PNG, WebP, and GIF images are supported. Leave empty to keep the current cover.</p>
            </div>
          </div>
          {errorMessage && <p className="edit-form-error" role="alert">{errorMessage}</p>}
          <div className="edit-series-footer">
            <button type="button" className="button button-subtle" onClick={onClose}>Cancel</button>
            <button type="submit" className="button button-primary" disabled={saving || !title.trim() || Boolean(genresError)}>
              <Save size={15} /> {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
  return portalTarget ? createPortal(dialog, portalTarget) : null;
}
