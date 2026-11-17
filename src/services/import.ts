export type BookChapterUpload = {
  file: File;
  chapterNumber: number;
};

export type BookUploadDetails = {
  seriesTitle?: string;
  seriesId?: string;
  chapters: BookChapterUpload[];
  authorName?: string;
  description?: string;
  genres?: string;
};

export type BookUploadResult = {
  seriesTitle: string;
  uploaded: { chapterNumber: number; fileName: string }[];
};

export async function uploadBookArchives(details: BookUploadDetails): Promise<BookUploadResult> {
  const body = new FormData();
  if (details.seriesId) {
    body.append("seriesId", details.seriesId);
  } else if (details.seriesTitle?.trim()) {
    body.append("seriesTitle", details.seriesTitle.trim());
    if (details.authorName?.trim()) body.append("authorName", details.authorName.trim());
    if (details.description?.trim()) body.append("description", details.description.trim());
    if (details.genres?.trim()) body.append("genres", details.genres.trim());
  } else {
    throw new Error("Choose an existing series or enter a name for a new one.");
  }
  for (const chapter of details.chapters) {
    body.append("files", chapter.file, chapter.file.name);
    body.append("chapterNumbers", String(chapter.chapterNumber));
  }

  const response = await fetch("/api/library/upload", { method: "POST", body });
  const result = await response.json().catch(() => null) as BookUploadResult | { error?: string } | null;
  if (!response.ok) {
    throw new Error(result && "error" in result && result.error ? result.error : `Upload failed (${response.status}).`);
  }
  if (!result || !("uploaded" in result) || !Array.isArray(result.uploaded)) {
    throw new Error("The server returned an invalid upload response.");
  }
  return result;
}
