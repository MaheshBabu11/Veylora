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

type UploadJobStatus = {
  id: string;
  status: string;
  progress: number;
  total: number;
  error: string | null;
  series_title: string;
  uploaded: { chapterNumber: number; fileName: string }[];
};

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export async function uploadBookArchives(
  details: BookUploadDetails,
  onProgress?: (percentage: number) => void,
  onJobQueued?: (jobId: string) => void,
  onJobProgress?: (progress: number, total: number, status: string) => void,
  signal?: AbortSignal,
): Promise<BookUploadResult> {
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

  const jobId = await new Promise<string>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/library/upload");
    const abort = () => request.abort();
    signal?.addEventListener("abort", abort, { once: true });
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress?.(Math.min(100, Math.round(event.loaded / event.total * 100)));
    });
    request.addEventListener("load", () => {
      signal?.removeEventListener("abort", abort);
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
      if (!result || !("id" in result) || typeof result.id !== "string") {
        reject(new Error("The server returned an invalid upload response."));
        return;
      }
      onProgress?.(100);
      onJobQueued?.(result.id);
      resolve(result.id);
    });
    request.addEventListener("error", () => {
      signal?.removeEventListener("abort", abort);
      reject(new Error("The upload could not reach the server."));
    });
    request.addEventListener("abort", () => {
      signal?.removeEventListener("abort", abort);
      reject(new Error("The upload was cancelled."));
    });
    request.send(body);
  });

  while (true) {
    const response = await fetch(`/api/library/uploads/${jobId}`, { cache: "no-store" });
    const job = await response.json().catch(() => null) as UploadJobStatus | { error?: string } | null;
    if (!response.ok) {
      throw new Error(job && "error" in job && job.error ? job.error : `Could not read upload status (${response.status}).`);
    }
    if (!job || !("status" in job) || typeof job.status !== "string") {
      throw new Error("The server returned an invalid upload status.");
    }
    onJobProgress?.(job.progress, job.total, job.status);
    if (job.status === "completed") {
      if (typeof job.series_title !== "string" || !Array.isArray(job.uploaded)) {
        throw new Error("The server returned an invalid completed upload.");
      }
      return { seriesTitle: job.series_title, uploaded: job.uploaded };
    }
    if (job.status === "failed") throw new Error(job.error || "The server could not process the uploaded archives.");
    if (job.status === "cancelled") throw new Error("The upload was cancelled.");
    await delay(1_500);
  }
}
