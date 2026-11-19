import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { listSeries } from "@/server/repository";

const { Pool } = pg;
const database = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

afterAll(() => database.end());

function percentile(samples: number[], percentileValue: number) {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * percentileValue) - 1)];
}

describe("generated large-library benchmark", () => {
  const benchmark = process.env.VEYLORA_RUN_BENCHMARK === "1" ? it : it.skip;

  benchmark("measures repository pagination, search, and chapter-count sorting", async () => {
    const seriesCount = 5_000;
    const chaptersPerSeries = 5;
    await database.query(
      `INSERT INTO series(title, source_path, format, description)
       SELECT 'Benchmark Series ' || lpad(number::text, 5, '0'),
         '/veylora-benchmark/series-' || number, 'Manga', 'Generated benchmark fixture'
       FROM generate_series(1, $1) AS generated(number)`,
      [seriesCount],
    );
    await database.query(
      `INSERT INTO chapters(series_id, chapter_number, title, source_path, page_count)
       SELECT series.id, chapter_number, 'Chapter ' || chapter_number,
         series.source_path || '/chapter-' || chapter_number || '.cbz', 20
       FROM series
       CROSS JOIN generate_series(1, $1) AS generated(chapter_number)
       WHERE series.source_path LIKE '/veylora-benchmark/%'`,
      [chaptersPerSeries],
    );

    const queries = [
      { name: "title-page", sort: "title" },
      { name: "chapter-count-sort", sort: "chapters" },
      { name: "full-text-search", sort: "recent", query: "Benchmark 04999" },
    ] as const;
    const sampleCount = 30;
    const report: Record<string, { p50Ms: number; p95Ms: number }> = {};

    for (const query of queries) {
      for (let iteration = 0; iteration < 3; iteration += 1) {
        await listSeries({
          userId: "benchmark-user",
          query: "query" in query ? query.query : undefined,
          sort: query.sort,
          limit: 100,
          offset: 0,
        });
      }

      const samples: number[] = [];
      let total = 0;
      for (let iteration = 0; iteration < sampleCount; iteration += 1) {
        const startedAt = performance.now();
        const result = await listSeries({
          userId: "benchmark-user",
          query: "query" in query ? query.query : undefined,
          sort: query.sort,
          limit: 100,
          offset: 0,
        });
        samples.push(performance.now() - startedAt);
        total = result.total;
      }
      expect(total).toBe(query.name === "full-text-search" ? 1 : seriesCount);
      report[query.name] = {
        p50Ms: Math.round(percentile(samples, 0.5) * 100) / 100,
        p95Ms: Math.round(percentile(samples, 0.95) * 100) / 100,
      };
    }

    console.info("Generated large-library benchmark", {
      seriesCount,
      chapters: seriesCount * chaptersPerSeries,
      warmupRunsPerQuery: 3,
      samplesPerQuery: sampleCount,
      report,
    });
  }, 120_000);
});
