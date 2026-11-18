"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, FolderOpen, HardDrive, Library, Moon, ScanLine, Sun, TabletSmartphone, Trash2 } from "lucide-react";
import { usePreferencesStore } from "@/stores/preferences";
import { fetchJson } from "@/services/library";

type Directory = { path: string; status: string; last_scanned_at: string | null };
type StorageStats = { archiveCount: number; archiveBytes: number; cacheBytes: number; availableBytes: number; booksRoot: string };
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
  const { data: directories = [] } = useQuery({ queryKey: ["directories"], queryFn: () => fetchJson<Directory[]>("/api/library/directories") });
  const { data: storage } = useQuery({ queryKey: ["storage"], queryFn: () => fetchJson<StorageStats>("/api/storage") });
  const theme = usePreferencesStore((state) => state.theme);
  const setTheme = usePreferencesStore((state) => state.setTheme);
  const readerMode = usePreferencesStore((state) => state.readerMode);
  const setReaderMode = usePreferencesStore((state) => state.setReaderMode);
  const direction = usePreferencesStore((state) => state.direction);
  const setDirection = usePreferencesStore((state) => state.setDirection);
  const autoScan = usePreferencesStore((state) => state.autoScan);
  const setAutoScan = usePreferencesStore((state) => state.setAutoScan);

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
        <section className="settings-section" id="library-settings"><div className="settings-section-head"><div className="settings-section-icon"><FolderOpen size={17} /></div><div><h2>Library folders</h2><p>Local places where your stories live.</p></div></div>{directories.map((directory) => <div className="folder-row" key={directory.path}><span className="folder-icon"><FolderOpen size={17} /></span><span><strong>Books Library</strong><small>{directory.path} · {storage?.archiveCount ?? 0} archives</small></span><span className="folder-state"><i /> {directory.status === "not_scanned" ? "Ready" : directory.status}</span></div>)}<div className="settings-toggle-row"><div><strong>Automatic library scanning</strong><small>Index archives when they are added or updated. Shared across accounts.</small></div><button type="button" className={`toggle ${autoScan ? "on" : ""}`} role="switch" aria-checked={autoScan} aria-label="Automatic library scanning" onClick={() => setAutoScan(!autoScan)}><i /></button></div><button className="settings-action" onClick={() => void startScan()}><ScanLine size={15} /><span><strong>Scan library now</strong><small>{directories[0]?.last_scanned_at ? `Last scanned ${new Date(directories[0].last_scanned_at).toLocaleString()}` : "Index archives in the configured books folder"}</small></span><ChevronRight size={15} /></button><p className="upload-hint">Automatic scanning watches the configured folder. Use <strong>Import</strong> in the top bar to upload chapters and add series details.</p></section>
        <section className="settings-section" id="reader-settings"><div className="settings-section-head"><div className="settings-section-icon"><TabletSmartphone size={17} /></div><div><h2>Reader defaults</h2><p>Comfortable reading, chapter after chapter.</p></div></div><label className="settings-select-row"><span>Default reading direction</span><SettingsSelect value={direction} onChange={(value) => setDirection(value as "rtl" | "ltr")} options={[{ value: "rtl", label: "Right to left" }, { value: "ltr", label: "Left to right" }]} /></label><label className="settings-select-row"><span>Reading mode</span><SettingsSelect value={readerMode} onChange={(value) => setReaderMode(value as "vertical" | "single")} options={[{ value: "vertical", label: "Continuous scroll" }, { value: "single", label: "Single page" }]} /></label></section>
        <section className="settings-section" id="appearance-settings"><div className="settings-section-head"><div className="settings-section-icon"><Moon size={17} /></div><div><h2>Appearance</h2><p>Set the mood for your library.</p></div></div><div className="theme-choices">{["dark", "light", "system"].map((item) => <button key={item} className={`theme-choice ${theme === item ? "chosen" : ""}`} onClick={() => setTheme(item as "dark" | "light" | "system")}><span>{item === "dark" ? <Moon size={17} /> : item === "light" ? <Sun size={17} /> : <HardDrive size={17} />}</span>{item[0].toUpperCase() + item.slice(1)}{theme === item && <Check size={13} />}</button>)}</div></section>
        <section className="settings-section" id="storage-settings"><div className="settings-section-head"><div className="settings-section-icon"><HardDrive size={17} /></div><div><h2>Storage & privacy</h2><p>Your stories stay yours, on this device.</p></div></div><div className="storage-meter"><div className="storage-meter-copy"><strong>Local library storage</strong><span>{formatBytes(storage?.archiveBytes ?? 0)} used <i>of</i> {formatBytes(storage?.availableBytes ?? 0)} available</span></div><div className="storage-meter-bar"><i style={{ width: storage && storage.archiveBytes + storage.cacheBytes > 0 ? `${Math.min(100, storage.archiveBytes / Math.max(storage.archiveBytes + storage.availableBytes, 1) * 100)}%` : "0%" }} /></div><div className="storage-types"><span><i className="storage-series" /> Archives <strong>{formatBytes(storage?.archiveBytes ?? 0)}</strong></span><span><i className="storage-cache" /> Page cache <strong>{formatBytes(storage?.cacheBytes ?? 0)}</strong></span></div></div><button className="settings-action" onClick={() => void clearCache()}><Trash2 size={15} /><span><strong>Clear page cache</strong><small>Cached pages can be regenerated; source archives are untouched.</small></span><ChevronRight size={15} /></button><div className="privacy-note"><Check size={15} /><span><strong>Private by nature.</strong> Veylora doesn&apos;t upload or share your reading data.</span></div></section>
      </div>
    </div>
    {message && <div className="toast-message settings-toast" role="status">{message}<button onClick={() => setMessage("")} aria-label="Dismiss message"><Check size={14} /></button></div>}
  </div>;
}
