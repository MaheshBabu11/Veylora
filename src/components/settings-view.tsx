"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronRight, FolderOpen, HardDrive, Moon, ScanLine, Sun, TabletSmartphone, Trash2 } from "lucide-react";
import { usePreferencesStore } from "@/stores/preferences";
import { fetchJson } from "@/services/library";

type Directory = { path: string; status: string; last_scanned_at: string | null };
type StorageStats = { archiveCount: number; archiveBytes: number; cacheBytes: number; availableBytes: number; booksRoot: string };

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

export function SettingsView() {
  const [autoScan, setAutoScan] = useState(true);
  const [message, setMessage] = useState("");
  const [scanJobId, setScanJobId] = useState("");
  const queryClient = useQueryClient();
  const { data: directories = [] } = useQuery({ queryKey: ["directories"], queryFn: () => fetchJson<Directory[]>("/api/library/directories") });
  const { data: storage } = useQuery({ queryKey: ["storage"], queryFn: () => fetchJson<StorageStats>("/api/storage") });
  const theme = usePreferencesStore((state) => state.theme);
  const setTheme = usePreferencesStore((state) => state.setTheme);
  const readerMode = usePreferencesStore((state) => state.readerMode);
  const setReaderMode = usePreferencesStore((state) => state.setReaderMode);
  const direction = usePreferencesStore((state) => state.direction);
  const setDirection = usePreferencesStore((state) => state.setDirection);

  useEffect(() => {
    if (!scanJobId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const job = await fetchJson<{ status: string; progress: number; total: number; error: string | null }>(`/api/jobs/${scanJobId}`);
        if (!active) return;
        if (job.status === "completed" || job.status === "completed_with_errors" || job.status === "failed") {
          setMessage(job.error || `Scan complete: ${job.progress} archive(s) checked.`);
          setScanJobId("");
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["directories"] }),
            queryClient.invalidateQueries({ queryKey: ["storage"] }),
            queryClient.invalidateQueries({ queryKey: ["series"] }),
          ]);
          return;
        }
        setMessage(`Scanning library… ${job.progress}/${job.total}`);
        timer = setTimeout(() => void poll(), 1200);
      } catch (error) {
        if (active) {
          setMessage(error instanceof Error ? error.message : "Could not check scan progress.");
          setScanJobId("");
        }
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [scanJobId, queryClient]);

  const startScan = async () => {
    try {
      const job = await fetchJson<{ id: string }>("/api/library/scan", { method: "POST", body: "{}" });
      setScanJobId(job.id);
      setMessage("Scan queued.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start library scan.");
    }
  };

  const clearCache = async () => {
    try {
      const result = await fetchJson<{ removed: number }>("/api/cache", { method: "DELETE" });
      setMessage(`Cleared ${result.removed} cached page(s). Original archives are untouched.`);
      await queryClient.invalidateQueries({ queryKey: ["storage"] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not clear the page cache.");
    }
  };

  return <div className="settings-page page-enter">
    <div className="page-heading"><div><p className="eyebrow"><span className="eyebrow-line" /> YOUR SPACE, YOUR RULES</p><h1>Settings<span className="heading-period">.</span></h1><p className="page-subtitle">A few ways to make Veylora feel like yours.</p></div></div>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings sections"><a className="current" href="#library-settings">Library</a><a href="#reader-settings">Reader</a><a href="#appearance-settings">Appearance</a><a href="#storage-settings">Storage</a></nav>
      <div className="settings-content">
        <section className="settings-section" id="library-settings"><div className="settings-section-head"><div className="settings-section-icon"><FolderOpen size={17} /></div><div><h2>Library folders</h2><p>Local places where your stories live.</p></div></div>{directories.map((directory) => <div className="folder-row" key={directory.path}><span className="folder-icon"><FolderOpen size={17} /></span><span><strong>Books Library</strong><small>{directory.path} · {storage?.archiveCount ?? 0} archives</small></span><span className="folder-state"><i /> {directory.status === "not_scanned" ? "Ready" : directory.status}</span></div>)}<div className="settings-toggle-row"><div><strong>Scan folders automatically</strong><small>Keep your library up to date as files are added.</small></div><button className={`toggle ${autoScan ? "on" : ""}`} onClick={() => setAutoScan((value) => !value)} aria-label="Toggle automatic scanning"><i /></button></div><button className="settings-action" onClick={() => void startScan()} disabled={Boolean(scanJobId)}><ScanLine size={15} /><span><strong>Scan library now</strong><small>{directories[0]?.last_scanned_at ? `Last scanned ${new Date(directories[0].last_scanned_at).toLocaleString()}` : "Index archives in the configured books folder"}</small></span><ChevronRight size={15} /></button><p className="upload-hint">Use <strong>Import</strong> in the top bar to upload chapters and add optional series details.</p></section>
        <section className="settings-section" id="reader-settings"><div className="settings-section-head"><div className="settings-section-icon"><TabletSmartphone size={17} /></div><div><h2>Reader defaults</h2><p>Comfortable reading, chapter after chapter.</p></div></div><label className="settings-select-row"><span>Default reading direction</span><select value={direction} onChange={(event) => setDirection(event.target.value as "rtl" | "ltr")}><option value="rtl">Right to left</option><option value="ltr">Left to right</option></select></label><label className="settings-select-row"><span>Reading mode</span><select value={readerMode} onChange={(event) => setReaderMode(event.target.value as "vertical" | "single")}><option value="vertical">Continuous scroll</option><option value="single">Single page</option></select></label><label className="settings-select-row"><span>Page transitions</span><select defaultValue="Smooth"><option>Smooth</option><option>Instant</option></select></label></section>
        <section className="settings-section" id="appearance-settings"><div className="settings-section-head"><div className="settings-section-icon"><Moon size={17} /></div><div><h2>Appearance</h2><p>Set the mood for your library.</p></div></div><div className="theme-choices">{["dark", "light", "system"].map((item) => <button key={item} className={`theme-choice ${theme === item ? "chosen" : ""}`} onClick={() => setTheme(item as "dark" | "light" | "system")}><span>{item === "dark" ? <Moon size={17} /> : item === "light" ? <Sun size={17} /> : <HardDrive size={17} />}</span>{item[0].toUpperCase() + item.slice(1)}{theme === item && <Check size={13} />}</button>)}</div></section>
        <section className="settings-section" id="storage-settings"><div className="settings-section-head"><div className="settings-section-icon"><HardDrive size={17} /></div><div><h2>Storage & privacy</h2><p>Your stories stay yours, on this device.</p></div></div><div className="storage-meter"><div className="storage-meter-copy"><strong>Local library storage</strong><span>{formatBytes(storage?.archiveBytes ?? 0)} used <i>of</i> {formatBytes(storage?.availableBytes ?? 0)} available</span></div><div className="storage-meter-bar"><i style={{ width: storage && storage.archiveBytes + storage.cacheBytes > 0 ? `${Math.min(100, storage.archiveBytes / Math.max(storage.archiveBytes + storage.availableBytes, 1) * 100)}%` : "0%" }} /></div><div className="storage-types"><span><i className="storage-series" /> Archives <strong>{formatBytes(storage?.archiveBytes ?? 0)}</strong></span><span><i className="storage-cache" /> Page cache <strong>{formatBytes(storage?.cacheBytes ?? 0)}</strong></span></div></div><button className="settings-action" onClick={() => void clearCache()}><Trash2 size={15} /><span><strong>Clear page cache</strong><small>Cached pages can be regenerated; source archives are untouched.</small></span><ChevronRight size={15} /></button><div className="privacy-note"><Check size={15} /><span><strong>Private by nature.</strong> Veylora doesn&apos;t upload or share your reading data.</span></div></section>
      </div>
    </div>
    {message && <div className="toast-message settings-toast" role="status">{message}<button onClick={() => setMessage("")}><Check size={14} /></button></div>}
  </div>;
}
