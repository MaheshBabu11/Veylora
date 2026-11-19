"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, FolderOpen, HardDrive, Library, Moon, RotateCcw, ScanLine, Sun, TabletSmartphone, Trash2, X } from "lucide-react";
import { usePreferencesStore } from "@/stores/preferences";
import { fetchJson } from "@/services/library";

type Directory = { path: string; status: string; last_scanned_at: string | null };
type StorageStats = { archiveCount: number; archiveBytes: number; cacheBytes: number; availableBytes: number; booksRoot: string };
type ScanJob = {
  id: string;
  status: string;
  progress: number;
  total: number;
  error: string | null;
  attempts: number;
  max_attempts: number;
  cancel_requested: boolean;
  created_at: string;
};
type UploadJob = {
  id: string;
  status: string;
  progress: number;
  total: number;
  error: string | null;
  attempts: number;
  max_attempts: number;
  cancel_requested: boolean;
  created_at: string;
  series_title: string;
  chapter_count: number;
};
const EMPTY_SCAN_JOBS: ScanJob[] = [];
const EMPTY_UPLOAD_JOBS: UploadJob[] = [];
const settingsSections = [
  { id: "library-settings", label: "Library", icon: Library },
  { id: "reader-settings", label: "Reader", icon: TabletSmartphone },
  { id: "appearance-settings", label: "Appearance", icon: Moon },
  { id: "storage-settings", label: "Storage & privacy", icon: HardDrive },
];
type SelectOption = { value: string; label: string };

function SettingsSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(Math.max(0, options.findIndex((option) => option.value === value)));
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  const openMenu = () => {
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
  };
  const moveFocus = (index: number) => {
    const nextIndex = (index + options.length) % options.length;
    setActiveIndex(nextIndex);
  };

  return (
    <div className="settings-select" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="settings-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => open ? setOpen(false) : openMenu()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) openMenu();
            else moveFocus(activeIndex + (event.key === "ArrowDown" ? 1 : -1));
          }
        }}
      >
        <span>{selected?.label}</span>
        <ChevronDown className={open ? "settings-select-chevron open" : "settings-select-chevron"} size={15} />
      </button>
      {open && (
        <div
          id={id}
          className="settings-select-menu"
          role="listbox"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              moveFocus(activeIndex + (event.key === "ArrowDown" ? 1 : -1));
            } else if (event.key === "Home" || event.key === "End") {
              event.preventDefault();
              moveFocus(event.key === "Home" ? 0 : options.length - 1);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              triggerRef.current?.focus();
            } else if (event.key === "Tab") {
              setOpen(false);
            }
          }}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              ref={(element) => { optionRefs.current[index] = element; }}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={`settings-select-option ${option.value === value ? "selected" : ""}`}
              tabIndex={-1}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

export function SettingsView() {
  const [message, setMessage] = useState("");
  const [activeSection, setActiveSection] = useState(settingsSections[0].id);
  const queryClient = useQueryClient();
  const previousScanStatuses = useRef(new Map<string, string>());
  const previousUploadStatuses = useRef(new Map<string, string>());
  const { data: directories = [] } = useQuery({ queryKey: ["directories"], queryFn: () => fetchJson<Directory[]>("/api/library/directories") });
  const { data: storage } = useQuery({ queryKey: ["storage"], queryFn: () => fetchJson<StorageStats>("/api/storage") });
  const { data: scanHistory } = useQuery({
    queryKey: ["scan-history"],
    queryFn: () => fetchJson<{ items: ScanJob[] }>("/api/library/scan/history"),
    refetchInterval: 5_000,
  });
  const { data: uploadHistory } = useQuery({
    queryKey: ["upload-history"],
    queryFn: () => fetchJson<{ items: UploadJob[] }>("/api/library/uploads"),
    refetchInterval: 5_000,
  });
  const scanJobs = scanHistory?.items ?? EMPTY_SCAN_JOBS;
  const uploadJobs = uploadHistory?.items ?? EMPTY_UPLOAD_JOBS;
  const theme = usePreferencesStore((state) => state.theme);
  const setTheme = usePreferencesStore((state) => state.setTheme);
  const readerMode = usePreferencesStore((state) => state.readerMode);
  const setReaderMode = usePreferencesStore((state) => state.setReaderMode);
  const direction = usePreferencesStore((state) => state.direction);
  const setDirection = usePreferencesStore((state) => state.setDirection);
  const autoScan = usePreferencesStore((state) => state.autoScan);
  const setAutoScan = usePreferencesStore((state) => state.setAutoScan);

  useEffect(() => {
    let completedJob = false;
    for (const job of scanJobs) {
      const previousStatus = previousScanStatuses.current.get(job.id);
      if (["queued", "running"].includes(previousStatus ?? "") &&
          ["completed", "completed_with_errors", "failed", "cancelled"].includes(job.status)) {
        completedJob = true;
      }
      previousScanStatuses.current.set(job.id, job.status);
    }
    if (completedJob) {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["directories"] }),
        queryClient.invalidateQueries({ queryKey: ["storage"] }),
        queryClient.invalidateQueries({ queryKey: ["series"] }),
        queryClient.invalidateQueries({ queryKey: ["chapters"] }),
      ]);
    }
  }, [queryClient, scanJobs]);

  useEffect(() => {
    let completedJob = false;
    for (const job of uploadJobs) {
      const previousStatus = previousUploadStatuses.current.get(job.id);
      if (["queued", "running"].includes(previousStatus ?? "") &&
          ["completed", "failed", "cancelled"].includes(job.status)) {
        completedJob = true;
      }
      previousUploadStatuses.current.set(job.id, job.status);
    }
    if (completedJob) {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["storage"] }),
        queryClient.invalidateQueries({ queryKey: ["series"] }),
        queryClient.invalidateQueries({ queryKey: ["chapters"] }),
        queryClient.invalidateQueries({ queryKey: ["scan-history"] }),
      ]);
    }
  }, [queryClient, uploadJobs]);

  useEffect(() => {
    const sections = settingsSections
      .map(({ id }) => document.getElementById(id))
      .filter((section): section is HTMLElement => section !== null);
    if (!sections.length) return;

    const observer = new IntersectionObserver((entries) => {
      const visibleSections = entries.filter((entry) => entry.isIntersecting);
      const current = visibleSections.sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (current) setActiveSection(current.target.id);
    }, { rootMargin: "-18% 0px -65% 0px", threshold: [0, 0.1, 0.25, 0.5] });

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const startScan = async () => {
    try {
      await fetchJson<{ id: string }>("/api/library/scan", { method: "POST", body: "{}" });
      setMessage("Scan queued.");
      await queryClient.invalidateQueries({ queryKey: ["scan-history"] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start library scan.");
    }
  };

  const updateScanJob = async (jobId: string, action: "cancel" | "retry") => {
    try {
      await fetchJson(`/api/jobs/${jobId}/${action}`, { method: "POST", body: "{}" });
      setMessage(action === "cancel" ? "Scan cancellation requested." : "Scan queued for retry.");
      await queryClient.invalidateQueries({ queryKey: ["scan-history"] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Could not ${action} the scan.`);
    }
  };

  const updateUploadJob = async (jobId: string, action: "cancel" | "retry") => {
    try {
      await fetchJson(`/api/library/uploads/${jobId}/${action}`, { method: "POST", body: "{}" });
      setMessage(action === "cancel" ? "Upload cancellation requested." : "Upload queued for retry.");
      await queryClient.invalidateQueries({ queryKey: ["upload-history"] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Could not ${action} the upload.`);
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
    <div className="page-heading"><div><p className="eyebrow"><span className="eyebrow-line" /> YOUR SPACE, YOUR RULES</p><h1>Settings<span className="heading-period">.</span></h1><p className="page-subtitle">Library, reader, appearance, and storage preferences live here. Manage your profile and password from the account menu.</p></div></div>
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings sections">
        {settingsSections.map(({ id, label, icon: Icon }) => (
          <a
            key={id}
            className={activeSection === id ? "current" : ""}
            href={`#${id}`}
            aria-current={activeSection === id ? "location" : undefined}
            onClick={() => setActiveSection(id)}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{label}</span>
          </a>
        ))}
      </nav>
      <div className="settings-content">
        <section className="settings-section" id="library-settings">
          <div className="settings-section-head"><div className="settings-section-icon"><FolderOpen size={17} /></div><div><h2>Library folders</h2><p>Local places where your stories live.</p></div></div>
          {directories.map((directory) => <div className="folder-row" key={directory.path}><span className="folder-icon"><FolderOpen size={17} /></span><span><strong>Books Library</strong><small>{directory.path} · {storage?.archiveCount ?? 0} archives</small></span><span className="folder-state"><i /> {directory.status === "not_scanned" ? "Ready" : directory.status}</span></div>)}
          <div className="settings-toggle-row"><div><strong>Automatic library scanning</strong><small>Index archives when they are added or updated. Shared across accounts.</small></div><button type="button" className={`toggle ${autoScan ? "on" : ""}`} role="switch" aria-checked={autoScan} aria-label="Automatic library scanning" onClick={() => setAutoScan(!autoScan)}><i /></button></div>
          <button className="settings-action" onClick={() => void startScan()}><ScanLine size={15} /><span><strong>Scan library now</strong><small>{directories[0]?.last_scanned_at ? `Last scanned ${new Date(directories[0].last_scanned_at).toLocaleString()}` : "Index archives in the configured books folder"}</small></span><ChevronRight size={15} /></button>
          {scanJobs.length > 0 && <div className="scan-job-list" aria-label="Recent library scans">
            {scanJobs.slice(0, 5).map((job) => {
              const active = job.status === "queued" || job.status === "running";
              const canRetry = ["failed", "completed_with_errors", "cancelled"].includes(job.status);
              return <div className="scan-job-row" key={job.id}>
                <span><strong>{job.cancel_requested ? "Cancelling scan…" : job.status === "running" ? `Scanning ${job.progress}/${job.total} archives` : job.status === "queued" ? "Scan queued" : `Scan ${job.status.replaceAll("_", " ")}`}</strong><small>{new Date(job.created_at).toLocaleString()}{active ? ` · attempt ${job.attempts}/${job.max_attempts}` : ""}</small>{job.error && <small className="scan-job-error">{job.error}</small>}</span>
                {active && !job.cancel_requested && <button type="button" aria-label="Cancel scan" title="Cancel scan" onClick={() => void updateScanJob(job.id, "cancel")}><X size={15} /></button>}
                {canRetry && <button type="button" aria-label="Retry scan" title="Retry scan" onClick={() => void updateScanJob(job.id, "retry")}><RotateCcw size={15} /></button>}
              </div>;
            })}
          </div>}
          {uploadJobs.length > 0 && <div className="scan-job-list" aria-label="Recent archive uploads">
            {uploadJobs.slice(0, 5).map((job) => {
              const active = job.status === "queued" || job.status === "running";
              return <div className="scan-job-row" key={job.id}>
                <span><strong>{job.cancel_requested ? "Cancelling upload…" : job.status === "running" ? `Processing ${job.series_title} · ${job.progress}/${job.total}` : job.status === "queued" ? `Upload queued · ${job.series_title}` : `Upload ${job.status} · ${job.series_title}`}</strong><small>{new Date(job.created_at).toLocaleString()}{active ? ` · attempt ${job.attempts}/${job.max_attempts}` : ` · ${job.chapter_count} chapter(s)`}</small>{job.error && <small className="scan-job-error">{job.error}</small>}</span>
                {active && !job.cancel_requested && <button type="button" aria-label="Cancel upload" title="Cancel upload" onClick={() => void updateUploadJob(job.id, "cancel")}><X size={15} /></button>}
                {job.status === "failed" && <button type="button" aria-label="Retry upload" title="Retry upload" onClick={() => void updateUploadJob(job.id, "retry")}><RotateCcw size={15} /></button>}
              </div>;
            })}
          </div>}
          <p className="upload-hint">Automatic scanning watches the configured folder. Use <strong>Import</strong> in the top bar to upload chapters and add series details.</p>
        </section>
        <section className="settings-section" id="reader-settings"><div className="settings-section-head"><div className="settings-section-icon"><TabletSmartphone size={17} /></div><div><h2>Reader defaults</h2><p>Comfortable reading, chapter after chapter.</p></div></div><label className="settings-select-row"><span>Default reading direction</span><SettingsSelect value={direction} onChange={(value) => setDirection(value as "rtl" | "ltr")} options={[{ value: "rtl", label: "Right to left" }, { value: "ltr", label: "Left to right" }]} /></label><label className="settings-select-row"><span>Reading mode</span><SettingsSelect value={readerMode} onChange={(value) => setReaderMode(value as "vertical" | "single")} options={[{ value: "vertical", label: "Continuous scroll" }, { value: "single", label: "Single page" }]} /></label></section>
        <section className="settings-section" id="appearance-settings"><div className="settings-section-head"><div className="settings-section-icon"><Moon size={17} /></div><div><h2>Appearance</h2><p>Set the mood for your library.</p></div></div><div className="theme-choices">{["dark", "light", "system"].map((item) => <button key={item} className={`theme-choice ${theme === item ? "chosen" : ""}`} onClick={() => setTheme(item as "dark" | "light" | "system")}><span>{item === "dark" ? <Moon size={17} /> : item === "light" ? <Sun size={17} /> : <HardDrive size={17} />}</span>{item[0].toUpperCase() + item.slice(1)}{theme === item && <Check size={13} />}</button>)}</div></section>
        <section className="settings-section" id="storage-settings"><div className="settings-section-head"><div className="settings-section-icon"><HardDrive size={17} /></div><div><h2>Storage & privacy</h2><p>Your stories stay yours, on this device.</p></div></div><div className="storage-meter"><div className="storage-meter-copy"><strong>Local library storage</strong><span>{formatBytes(storage?.archiveBytes ?? 0)} used <i>of</i> {formatBytes(storage?.availableBytes ?? 0)} available</span></div><div className="storage-meter-bar"><i style={{ width: storage && storage.archiveBytes + storage.cacheBytes > 0 ? `${Math.min(100, storage.archiveBytes / Math.max(storage.archiveBytes + storage.availableBytes, 1) * 100)}%` : "0%" }} /></div><div className="storage-types"><span><i className="storage-series" /> Archives <strong>{formatBytes(storage?.archiveBytes ?? 0)}</strong></span><span><i className="storage-cache" /> Page cache <strong>{formatBytes(storage?.cacheBytes ?? 0)}</strong></span></div></div><button className="settings-action" onClick={() => void clearCache()}><Trash2 size={15} /><span><strong>Clear page cache</strong><small>Cached pages can be regenerated; source archives are untouched.</small></span><ChevronRight size={15} /></button><div className="privacy-note"><Check size={15} /><span><strong>Private by nature.</strong> Veylora doesn&apos;t upload or share your reading data.</span></div></section>
      </div>
    </div>
    {message && <div className="toast-message settings-toast" role="status">{message}<button onClick={() => setMessage("")} aria-label="Dismiss message"><Check size={14} /></button></div>}
  </div>;
}
