import nextEnv from "@next/env";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());

if (!process.argv.includes("--confirm")) {
  console.error("Refusing to reset the database. Re-run with `npm run db:reset -- --confirm`.");
  process.exitCode = 1;
} else if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set in the local environment before resetting the database.");
  process.exitCode = 1;
} else {
  let target;
  try {
    target = new URL(process.env.DATABASE_URL);
  } catch {
    console.error("DATABASE_URL is not a valid PostgreSQL URL.");
    process.exitCode = 1;
  }

  if (target) {
    const database = decodeURIComponent(target.pathname.replace(/^\//, ""));
    if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || database !== "books") {
      console.error("Refusing to reset: this script only targets the local `books` database.");
      process.exitCode = 1;
    } else {
      const { Pool } = pg;
      const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
      try {
        const activeJobs = await pool.query(
          "SELECT 1 FROM scan_jobs WHERE status IN ('queued', 'running') LIMIT 1",
        );
        if (activeJobs.rowCount) {
          throw new Error("A library scan is active. Wait for it to finish before resetting the database.");
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(`TRUNCATE TABLE
            bookmarks,
            collection_series,
            collections,
            reading_history,
            reading_progress,
            chapter_pages,
            chapters,
            series_authors,
            series_genres,
            authors,
            genres,
            series,
            library_directories,
            user_preferences,
            scan_jobs
            RESTART IDENTITY`);
          await client.query("INSERT INTO user_preferences(user_id) VALUES ('local')");
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
        console.info(`Reset application data in ${target.hostname}:${target.port || "5432"}/${database}.`);
        console.info("Migration history and database schema were preserved; the local preference row is back to defaults.");
      } catch (error) {
        console.error("Database reset failed.", error);
        process.exitCode = 1;
      } finally {
        await pool.end();
      }
    }
  }
}
