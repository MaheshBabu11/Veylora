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
const COVER_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif"]);

type WatchedFileSnapshot = { path: string; size: number; mtimeMs: number };
type DeferredArchives = Map<string, number>;
type WatcherState = {
  watcher?: FSWatcher;
  debounceTimer?: ReturnType<typeof setTimeout>;
  pendingPaths: Set<string>;
  pendingFullScan: boolean;
  deferredJobId?: string;
  deferredArchives: DeferredArchives;
  deferredAttempts: number;
  deferredFullScan: boolean;
  deferredTimer?: ReturnType<typeof setTimeout>;
  restarting?: boolean;
  lastAutomaticScanAt?: number;
};

const globalForWatcher = globalThis as typeof globalThis & { veyloraLibraryWatcher?: WatcherState };
const state = globalForWatcher.veyloraLibraryWatcher ?? {
  pendingPaths: new Set<string>(),
  pendingFullScan: false,
  deferredArchives: new Map<string, number>(),
  deferredAttempts: 0,
  deferredFullScan: false,
};
globalForWatcher.veyloraLibraryWatcher = state;

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function isLibraryWatcherRunning() {
  return Boolean(state.watcher);
}

function isIndexablePath(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  const isArchive = /\.(cbz|zip|cbr)$/i.test(candidate);
  const isCoverImage = path.dirname(relative) !== "."
    && path.parse(candidate).name.toLowerCase() === "cover"
    && COVER_IMAGE_EXTENSIONS.has(path.extname(candidate).toLowerCase());
  return (isArchive || isCoverImage)
    && !path.isAbsolute(relative)
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !relative.split(path.sep).some((part) => part.startsWith("."));
}

async function snapshotChangedFiles(paths: string[]) {
  const snapshots = await Promise.all(paths.map(async (filePath): Promise<WatchedFileSnapshot | null> => {
    try {
      const info = await stat(filePath);
      return info.isFile() ? { path: filePath, size: info.size, mtimeMs: info.mtimeMs } : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }));
  return new Map(snapshots.filter((snapshot): snapshot is WatchedFileSnapshot => snapshot !== null).map((snapshot) => [snapshot.path, snapshot]));
}

function schedulePendingScan(paths: Iterable<string>, delay = DEBOUNCE_MS, fullScan = false) {
  for (const archivePath of paths) state.pendingPaths.add(archivePath);
  state.pendingFullScan ||= fullScan;
  if (state.debounceTimer) clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => {
    state.debounceTimer = undefined;
    void processPendingArchives();
  }, delay);
}

async function isAutomaticScanningEnabled() {
  const result = await pool.query<{ autoScan: boolean }>(
    "SELECT auto_scan AS \"autoScan\" FROM library_settings WHERE singleton = true",
  );
  return result.rows[0]?.autoScan ?? true;
}

function deferUntilScanCompletes(jobId: string, files: WatchedFileSnapshot[], attempts = 0, fullScan = false) {
  if (attempts >= 3) {
    console.error("[scanner] automatic scan follow-up limit reached", { jobId });
    return;
  }
  state.deferredJobId = jobId;
  state.deferredAttempts = attempts;
  state.deferredFullScan ||= fullScan;
  for (const file of files) {
    state.deferredArchives.set(file.path, file.mtimeMs);
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
      const needsFullScan = state.deferredFullScan;
      state.deferredArchives.clear();
      state.deferredFullScan = false;
      const previousJobId = state.deferredJobId;
      const previousAttempts = state.deferredAttempts;
      state.deferredJobId = undefined;
      if (!await isAutomaticScanningEnabled() || (!archivesToRetry.length && !needsFullScan)) return;

      const current = await snapshotChangedFiles(archivesToRetry.map(([filePath]) => filePath));
      const changed = [...current.values()].filter((file) => {
        const oldMtime = archivesToRetry.find(([filePath]) => filePath === file.path)?.[1];
        return oldMtime !== undefined && file.mtimeMs >= oldMtime;
      });
      if (!changed.length && !needsFullScan) return;

      const cooldownRemaining = AUTOMATIC_SCAN_COOLDOWN_MS - (Date.now() - (state.lastAutomaticScanAt ?? 0));
      if (cooldownRemaining > 0) {
        schedulePendingScan(changed.map((file) => file.path), cooldownRemaining, needsFullScan);
        return;
      }

      const nextJob = await queueLibraryScan();
      if (nextJob.created) state.lastAutomaticScanAt = Date.now();
      if (!nextJob.created) {
        const createdAt = new Date(nextJob.createdAt).getTime();
        const newer = changed.filter((file) => file.mtimeMs > createdAt);
        if (newer.length || needsFullScan) deferUntilScanCompletes(nextJob.id, newer, previousAttempts + 1, needsFullScan);
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
  const requestedFullScan = state.pendingFullScan;
  state.pendingFullScan = false;
  if (!paths.length && !requestedFullScan) return;

  let fullScanNeeded = requestedFullScan;
  try {
    const before = await snapshotChangedFiles(paths);
    await sleep(STABILITY_CHECK_MS);
    const after = await snapshotChangedFiles(paths);
    const removed = paths.some((filePath) => !after.has(filePath));
    fullScanNeeded ||= removed;
    const stable = [...after.values()].filter((file) => {
      const previous = before.get(file.path);
      return previous?.size === file.size && previous.mtimeMs === file.mtimeMs;
    });
    const unstablePaths = [...after.values()].filter((file) => {
      const previous = before.get(file.path);
      return previous && (previous.size !== file.size || previous.mtimeMs !== file.mtimeMs);
    }).map((file) => file.path);
    if (unstablePaths.length) schedulePendingScan(unstablePaths, RETRY_MS);
    if ((!stable.length && !fullScanNeeded) || !await isAutomaticScanningEnabled()) return;

    const cooldownRemaining = AUTOMATIC_SCAN_COOLDOWN_MS - (Date.now() - (state.lastAutomaticScanAt ?? 0));
    if (cooldownRemaining > 0) {
      schedulePendingScan(stable.map((file) => file.path), cooldownRemaining, fullScanNeeded);
      return;
    }

    const job = await queueLibraryScan();
    if (job.created) state.lastAutomaticScanAt = Date.now();
    if (!job.created) {
      const createdAt = new Date(job.createdAt).getTime();
      const changedDuringScan = stable.filter((file) => file.mtimeMs > createdAt);
      if (changedDuringScan.length || fullScanNeeded) deferUntilScanCompletes(job.id, changedDuringScan, 0, fullScanNeeded);
    }
    console.info("[scanner] library file change queued for indexing", { jobId: job.id, files: stable.length });
  } catch (error) {
    console.error("[scanner] automatic scan could not be queued", error);
    schedulePendingScan(paths, RETRY_MS, fullScanNeeded);
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
    const watcher = watch(root, { recursive: true }, (eventType, filename) => {
      if (!filename) {
        schedulePendingScan([], DEBOUNCE_MS, true);
        return;
      }
      const archivePath = path.resolve(root, filename.toString());
      if (isIndexablePath(root, archivePath)) schedulePendingScan([archivePath]);
      else if (eventType === "rename") {
        const relative = path.relative(root, archivePath);
        const isVisiblePath = relative !== ""
          && relative !== ".."
          && !relative.startsWith(`..${path.sep}`)
          && !path.isAbsolute(relative)
          && !relative.split(path.sep).some((part) => part.startsWith("."));
        if (isVisiblePath) schedulePendingScan([], DEBOUNCE_MS, true);
      }
    });
    state.watcher = watcher;
    watcher.on("error", (error) => {
      console.error("[scanner] archive watcher failed", error);
      watcher.close();
      state.watcher = undefined;
      restartWatcher();
    });
    console.info("[scanner] watching books directory for archive and cover changes", { root });
  } catch (error) {
    console.error("[scanner] could not start archive watcher", error);
    restartWatcher();
  }
}
