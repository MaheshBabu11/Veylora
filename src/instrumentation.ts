export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startLibraryWatcher } = await import("./server/library-watcher");
    await startLibraryWatcher();
  }
}
