import { watch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { pool } from "./db";
import { getBooksRoot } from "./filesystem";
import { queueLibraryScan } from "./library-scan-jobs";

const DEBOUNCE_MS = 900;
const STABILITY_CHECK_MS = 800;
const RETRY_MS = 1_500;
const POLL_SCAN_MS = 2_000;
const AUTOMATIC_SCAN_COOLDOWN_MS = 60_000;

type ArchiveSnapshot = { path: string; size: number; mtimeMs: number };
type DeferredArchives = Map<string, number>;
type WatcherState = {
  watcher?: FSWatcher;
  debounceTimer?: ReturnType<typeof setTimeout>;
  pendingPaths: Set<string>;
  deferredJobId?: string;
  deferredArchives: DeferredArchives;
  deferredAttempts: number;
  deferredTimer?: ReturnType<typeof setTimeout>;
  restarting?: boolean;
  lastAutomaticScanAt?: number;
};

const globalForWatcher = globalThis as typeof globalThis & { veyloraLibraryWatcher?: WatcherState };
const state = globalForWatcher.veyloraLibraryWatcher ?? {
  pendingPaths: new Set<string>(),
  deferredArchives: new Map<string, number>(),
  deferredAttempts: 0,
};
globalForWatcher.veyloraLibraryWatcher = state;

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function isArchivePath(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return !path.isAbsolute(relative)
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !relative.split(path.sep).some((part) => part.startsWith("."))
    && /\.(cbz|zip|cbr)$/i.test(candidate);
}

async function snapshotArchives(paths: string[]) {
  const snapshots = await Promise.all(paths.map(async (archivePath): Promise<ArchiveSnapshot | null> => {
    try {
      const info = await stat(archivePath);
      return info.isFile() ? { path: archivePath, size: info.size, mtimeMs: info.mtimeMs } : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }));
  return new Map(snapshots.filter((snapshot): snapshot is ArchiveSnapshot => snapshot !== null).map((snapshot) => [snapshot.path, snapshot]));
}

function schedulePendingScan(paths: Iterable<string>, delay = DEBOUNCE_MS) {
  for (const archivePath of paths) state.pendingPaths.add(archivePath);
  if (state.debounceTimer) clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => {
    state.debounceTimer = undefined;
    void processPendingArchives();
  }, delay);
}

async function isAutomaticScanningEnabled() {
  const result = await pool.query<{ autoScan: boolean }>(
    "SELECT auto_scan AS \"autoScan\" FROM user_preferences WHERE user_id = 'local'",
  );
  return result.rows[0]?.autoScan ?? true;
}

function deferUntilScanCompletes(jobId: string, archives: ArchiveSnapshot[], attempts = 0) {
  if (attempts >= 3) {
    console.error("[scanner] automatic scan follow-up limit reached", { jobId });
    return;
  }
  state.deferredJobId = jobId;
  state.deferredAttempts = attempts;
  for (const archive of archives) {
    state.deferredArchives.set(archive.path, archive.mtimeMs);
  }
  if (state.deferredTimer) return;

  const checkJob = async () => {
    state.deferredTimer = undefined;
    try {
      const result = await pool.query<{ status: string }>("SELECT status FROM scan_jobs WHERE id = $1", [state.deferredJobId]);
      const status = result.rows[0]?.status;
      if (status === "queued" || status === "running") {
        state.deferredTimer = setTimeout(() => void checkJob(), POLL_SCAN_MS);
        return;
      }
      const archivesToRetry = [...state.deferredArchives];
      state.deferredArchives.clear();
      const previousJobId = state.deferredJobId;
      const previousAttempts = state.deferredAttempts;
      state.deferredJobId = undefined;
      if (!await isAutomaticScanningEnabled() || !archivesToRetry.length) return;

      const current = await snapshotArchives(archivesToRetry.map(([archivePath]) => archivePath));
      const changed = [...current.values()].filter((archive) => {
        const oldMtime = archivesToRetry.find(([archivePath]) => archivePath === archive.path)?.[1];
        return oldMtime !== undefined && archive.mtimeMs >= oldMtime;
      });
      if (!changed.length) return;

      const cooldownRemaining = AUTOMATIC_SCAN_COOLDOWN_MS - (Date.now() - (state.lastAutomaticScanAt ?? 0));
      if (cooldownRemaining > 0) {
        schedulePendingScan(changed.map((archive) => archive.path), cooldownRemaining);
        return;
      }

      const nextJob = await queueLibraryScan();
      if (nextJob.created) state.lastAutomaticScanAt = Date.now();
      if (!nextJob.created) {
        const createdAt = new Date(nextJob.createdAt).getTime();
        const newer = changed.filter((archive) => archive.mtimeMs > createdAt);
        if (newer.length) deferUntilScanCompletes(nextJob.id, newer, previousAttempts + 1);
      }
      console.info("[scanner] queued follow-up for archives changed during a scan", { previousJobId, jobId: nextJob.id });
    } catch (error) {
      console.error("[scanner] could not schedule automatic scan follow-up", error);
      state.deferredTimer = setTimeout(() => void checkJob(), RETRY_MS);
    }
  };
  state.deferredTimer = setTimeout(() => void checkJob(), POLL_SCAN_MS);
}

async function processPendingArchives() {
  const paths = [...state.pendingPaths];
  state.pendingPaths.clear();
  if (!paths.length) return;

  try {
    const before = await snapshotArchives(paths);
    if (!before.size) return;
    await sleep(STABILITY_CHECK_MS);
    const after = await snapshotArchives(paths);
    const stable = [...after.values()].filter((archive) => {
      const previous = before.get(archive.path);
      return previous?.size === archive.size && previous.mtimeMs === archive.mtimeMs;
    });
    const unstablePaths = [...after.values()].filter((archive) => {
      const previous = before.get(archive.path);
      return previous && (previous.size !== archive.size || previous.mtimeMs !== archive.mtimeMs);
    }).map((archive) => archive.path);
    if (unstablePaths.length) schedulePendingScan(unstablePaths, RETRY_MS);
    if (!stable.length || !await isAutomaticScanningEnabled()) return;

    const cooldownRemaining = AUTOMATIC_SCAN_COOLDOWN_MS - (Date.now() - (state.lastAutomaticScanAt ?? 0));
    if (cooldownRemaining > 0) {
      schedulePendingScan(stable.map((archive) => archive.path), cooldownRemaining);
      return;
    }

    const job = await queueLibraryScan();
    if (job.created) state.lastAutomaticScanAt = Date.now();
    if (!job.created) {
      const createdAt = new Date(job.createdAt).getTime();
      const changedDuringScan = stable.filter((archive) => archive.mtimeMs > createdAt);
      if (changedDuringScan.length) deferUntilScanCompletes(job.id, changedDuringScan);
    }
    console.info("[scanner] archive change queued for indexing", { jobId: job.id, archives: stable.length });
  } catch (error) {
    console.error("[scanner] automatic scan could not be queued", error);
    schedulePendingScan(paths, RETRY_MS);
  }
}

function restartWatcher() {
  if (state.restarting) return;
  state.restarting = true;
  setTimeout(() => {
    state.restarting = false;
    void startLibraryWatcher();
  }, RETRY_MS);
}

export async function startLibraryWatcher() {
  if (state.watcher) return;
  try {
    const root = await getBooksRoot();
    const watcher = watch(root, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      const archivePath = path.resolve(root, filename.toString());
      if (isArchivePath(root, archivePath)) schedulePendingScan([archivePath]);
    });
    state.watcher = watcher;
    watcher.on("error", (error) => {
      console.error("[scanner] archive watcher failed", error);
      watcher.close();
      state.watcher = undefined;
      restartWatcher();
    });
    console.info("[scanner] watching books directory for archive changes", { root });
  } catch (error) {
    console.error("[scanner] could not start archive watcher", error);
    restartWatcher();
  }
}
