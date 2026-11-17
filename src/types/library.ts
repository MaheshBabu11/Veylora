export type ReadingStatus = "Reading" | "Plan to read" | "Completed" | "On hold";

export const SERIES_FORMATS = ["Manga", "Manhwa", "Manhua", "Webtoon", "Comic", "Other"] as const;
export type SeriesFormat = typeof SERIES_FORMATS[number];

export type Series = {
  id: string;
  title: string;
  format: SeriesFormat;
  subtitle: string;
  author: string;
  genres: string[];
  genreIds: string[];
  status: ReadingStatus;
  featured: boolean;
  chapters: number;
  readChapters: number;
  updated: string;
  lastRead?: string;
  color: string;
  accent: string;
  art: "mountain" | "moon" | "flower" | "ocean" | "city" | "sun";
  rating: string;
  description: string;
  coverUrl?: string;
  favorite?: boolean;
  lastChapterId?: string;
  coverChapterId?: string;
  coverPageNumber?: number;
};
