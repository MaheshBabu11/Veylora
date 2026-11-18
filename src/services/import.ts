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

export async function uploadBookArchives(details: BookUploadDetails, onProgress?: (percentage: number) => void): Promise<BookUploadResult> {
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

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/library/upload");
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress?.(Math.min(100, Math.round(event.loaded / event.total * 100)));
    });
    request.addEventListener("load", () => {
      let result: BookUploadResult | { error?: string } | null = null;
      try {
        result = JSON.parse(request.responseText) as BookUploadResult | { error?: string };
      } catch {
        reject(new Error("The server returned an invalid upload response."));
        return;
      }
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(result && "error" in result && result.error ? result.error : `Upload failed (${request.status}).`));
        return;
      }
      if (!result || !("uploaded" in result) || !Array.isArray(result.uploaded)) {
        reject(new Error("The server returned an invalid upload response."));
        return;
      }
      resolve(result);
    });
    request.addEventListener("error", () => reject(new Error("The upload could not reach the server.")));
    request.addEventListener("abort", () => reject(new Error("The upload was cancelled.")));
    request.send(body);
  });
}
