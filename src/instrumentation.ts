export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startLibraryScanWorker } = await import("./server/library-scan-worker");
    startLibraryScanWorker();
    const { startLibraryUploadWorker } = await import("./server/library-upload-worker");
    startLibraryUploadWorker();
    const { startLibraryWatcher } = await import("./server/library-watcher");
    await startLibraryWatcher();
  }
}
