"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight, BookOpen, Bookmark, ChevronDown, CircleUserRound, KeyRound, Library, Clock3, Compass, FolderHeart, Home, ListFilter,
  Menu, Plus, Search, Settings2, Sparkles, UsersRound, X, ScanLine,
  PanelLeftClose, PanelLeftOpen, Heart, ShieldCheck, LogOut, UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ImportDialog } from "@/components/import-dialog";
import { ImportSeriesProvider, type ImportSeriesTarget } from "@/components/import-series-context";
import { usePreferencesStore } from "@/stores/preferences";
import { fetchJson, useSeriesList, useSession } from "@/services/library";
import type { BookUploadResult } from "@/services/import";

const primaryLinks = [
  { href: "/", label: "Home", icon: Home },
  { href: "/library", label: "My library", icon: Library },
  { href: "/recently-added", label: "Recently added", icon: Sparkles },
  { href: "/continue-reading", label: "Continue reading", icon: BookOpen },
  { href: "/history", label: "Reading history", icon: Clock3 },
];
const discoverLinks = [
  { href: "/collections", label: "Collections", icon: FolderHeart },
  { href: "/favorites", label: "Favorites", icon: Bookmark },
  { href: "/categories", label: "Categories", icon: Compass },
  { href: "/authors", label: "Authors", icon: UsersRound },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importSeries, setImportSeries] = useState<ImportSeriesTarget | null>(null);
  const [importNotice, setImportNotice] = useState("");
  const [scanJobId, setScanJobId] = useState("");
  const [scanProgress, setScanProgress] = useState<{ status: string; progress: number; total: number; cancel_requested: boolean } | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountUsername, setAccountUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountMessage, setAccountMessage] = useState("");
  const queryClient = useQueryClient();
  const { data: user } = useSession();
  const theme = usePreferencesStore((state) => state.theme);
  const setTheme = usePreferencesStore((state) => state.setTheme);
  const sidebarCollapsed = usePreferencesStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = usePreferencesStore((state) => state.setSidebarCollapsed);
  const { data: searchData } = useSeriesList({ query: search, limit: 5, enabled: Boolean(search.trim()) });
  const searchResults = searchData?.items ?? [];
  const routePath = pathname.replace(/^\/main(?=\/|$)/, "") || "/";
  const navigationLinks = [...primaryLinks, ...discoverLinks, { href: "/settings", label: "Settings", icon: Settings2 }];
  const currentPage = navigationLinks.find(({ href }) =>
    routePath === href || (href !== "/" && routePath.startsWith(`${href}/`)),
  )?.label ?? (routePath.startsWith("/reader/") ? "Reader" : "Series details");

  const signOut = async () => {
    try {
      await fetchJson("/api/auth/logout", { method: "POST", body: "{}" });
      queryClient.clear();
      window.location.replace("/login");
    } catch (error) {
      setImportNotice(error instanceof Error ? error.message : "Could not sign out.");
    }
  };

  const openAccount = () => {
    setAccountUsername(user?.username ?? "");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setAccountMessage("");
    setAccountOpen(true);
  };

  const saveAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setAccountMessage("The new passwords do not match.");
      return;
    }
    setAccountBusy(true);
    setAccountMessage("");
    try {
      const updatedUser = await fetchJson<{ id: string; username: string }>("/api/auth/account", {
        method: "PUT",
        body: JSON.stringify({
          currentPassword,
          username: accountUsername,
          newPassword,
        }),
      });
      queryClient.setQueryData(["auth", "session"], updatedUser);
      setAccountUsername(updatedUser.username);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setAccountMessage("Account settings saved.");
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : "Could not update account settings.");
    } finally {
      setAccountBusy(false);
    }
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!scanJobId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const job = await fetchJson<{ status: string; progress: number; total: number; error: string | null; cancel_requested: boolean }>(`/api/jobs/${scanJobId}`);
        if (!active) return;
        setScanProgress(job);
        if (["completed", "completed_with_errors", "failed", "cancelled"].includes(job.status)) {
          setImportNotice(job.status === "cancelled"
            ? `Library scan cancelled after ${job.progress} archive(s).`
            : job.error || `Library scan finished: ${job.progress} archive(s) checked.`);
          setScanJobId("");
          setScanProgress(null);
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["directories"] }),
            queryClient.invalidateQueries({ queryKey: ["storage"] }),
            queryClient.invalidateQueries({ queryKey: ["series"] }),
            queryClient.invalidateQueries({ queryKey: ["chapters"] }),
          ]);
          return;
        }
        timer = setTimeout(() => void poll(), 1200);
      } catch (error) {
        if (!active) return;
        setImportNotice(error instanceof Error ? error.message : "Could not check scan progress.");
        setScanJobId("");
        setScanProgress(null);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [scanJobId, queryClient]);

  useEffect(() => {
    if (scanJobId) return;
    let active = true;
    const discoverScan = async () => {
      try {
        const job = await fetchJson<{ id: string; status: string; progress: number; total: number; cancel_requested: boolean } | null>("/api/library/scan");
        if (!active) return;
        if (job) {
          setScanJobId(job.id);
          setScanProgress(job);
          return;
        }
      } catch {
        return;
      }
    };
    void discoverScan();
    const discoverWhenVisible = () => {
      if (document.visibilityState === "visible") void discoverScan();
    };
    document.addEventListener("visibilitychange", discoverWhenVisible);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", discoverWhenVisible);
    };
  }, [scanJobId]);

  const startLibraryScan = async () => {
    try {
      const job = await fetchJson<{ id: string }>("/api/library/scan", { method: "POST", body: "{}" });
      setScanJobId(job.id);
      setImportNotice("Scan queued.");
      setImportOpen(false);
      setImportSeries(null);
    } catch (error) {
      setImportNotice(error instanceof Error ? error.message : "Could not queue library scan.");
    }
  };

  const finishBookUpload = async (result: BookUploadResult) => {
    setImportOpen(false);
    setImportSeries(null);
    setImportNotice(`${result.seriesTitle}: ${result.uploaded.length} chapter archive(s) uploaded.`);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["series"] }),
      queryClient.invalidateQueries({ queryKey: ["storage"] }),
    ]);
    try {
      const job = await fetchJson<{ id: string }>("/api/library/scan", { method: "POST", body: "{}" });
      setScanJobId(job.id);
      setImportNotice(`${result.seriesTitle} uploaded. Library scan queued.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The library scan could not be started.";
      setImportNotice(`${result.seriesTitle} uploaded, but indexing could not start: ${message}`);
    }
  };

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSearchOpen(false);
        setAccountOpen(false);
        setImportOpen(false);
        setImportSeries(null);
        setMobileOpen(false);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const openImportForSeries = (series?: ImportSeriesTarget) => {
    setImportSeries(series ?? null);
    setImportOpen(true);
  };

  const cancelLibraryScan = async () => {
    if (!scanJobId) return;
    try {
      await fetchJson(`/api/jobs/${scanJobId}/cancel`, { method: "POST", body: "{}" });
      setScanProgress((current) => current ? { ...current, cancel_requested: true } : current);
    } catch (error) {
      setImportNotice(error instanceof Error ? error.message : "Could not cancel the library scan.");
    }
  };

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-is-collapsed" : ""}`}>
      <ImportSeriesProvider onOpen={openImportForSeries}>
      <aside id="main-sidebar" className={`app-sidebar ${mobileOpen ? "mobile-open" : ""}`} aria-label="Main navigation">
        <Link href="/" className="brand-lockup" aria-label="Veylora home" onClick={() => setMobileOpen(false)}>
          <span className="brand-mark">V</span>
          <span className="brand-name">veylora<span>.</span></span>
        </Link>
        <nav className="app-sidebar-nav">
          <div className="app-sidebar-group">
            <span className="sidebar-label">YOUR LIBRARY</span>
            <div className="app-sidebar-links">
              {primaryLinks.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={`nav-link ${routePath === href || (href !== "/" && routePath.startsWith(`${href}/`)) ? "active" : ""}`}
                  onClick={() => setMobileOpen(false)}
                  aria-current={routePath === href ? "page" : undefined}
                  aria-label={label}
                  title={label}
                >
                  <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
                </Link>
              ))}
            </div>
          </div>
          <div className="app-sidebar-group">
            <span className="sidebar-label">EXPLORE</span>
            <div className="app-sidebar-links">
              {discoverLinks.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={`nav-link ${routePath === href || routePath.startsWith(`${href}/`) ? "active" : ""}`}
                  onClick={() => setMobileOpen(false)}
                  aria-current={routePath === href ? "page" : undefined}
                  aria-label={label}
                  title={label}
                >
                  <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
                </Link>
              ))}
            </div>
          </div>
        </nav>
        <div className="app-sidebar-bottom">
          <div className="app-sidebar-local-card">
            <span className="app-sidebar-local-icon"><ShieldCheck size={16} /></span>
            <span><strong>Your private library</strong><small>Files stay on this device</small></span>
          </div>
          <Link
            href="/settings"
            className={`nav-link ${routePath === "/settings" ? "active" : ""}`}
            onClick={() => setMobileOpen(false)}
            aria-current={routePath === "/settings" ? "page" : undefined}
            aria-label="Settings"
            title="Settings"
          >
            <Settings2 size={18} strokeWidth={1.8} /><span>Settings</span>
          </Link>
        </div>
      </aside>
      <button
        type="button"
        className={`sidebar-scrim ${mobileOpen ? "visible" : ""}`}
        aria-label="Close navigation"
        tabIndex={mobileOpen ? 0 : -1}
        onClick={() => setMobileOpen(false)}
      />

      <div className="app-workspace">
        <header className="workspace-topbar">
          <div className="workspace-topbar-start">
            <button className="mobile-menu icon-button" onClick={() => setMobileOpen((value) => !value)} aria-label="Toggle navigation" aria-expanded={mobileOpen}>
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <button
              type="button"
              className="sidebar-collapse-toggle icon-button"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-controls="main-sidebar"
              aria-expanded={!sidebarCollapsed}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
            <Link href="/" className="brand-lockup mobile-brand" aria-label="Veylora home">
              <span className="brand-mark">V</span>
              <span className="brand-name">veylora<span>.</span></span>
            </Link>
            <div className="workspace-page-context">
              <span>YOUR SPACE</span>
              <strong>{currentPage}</strong>
            </div>
          </div>
          <div className="workspace-topbar-actions">
            <button className="search-trigger" onClick={() => setSearchOpen(true)} aria-label="Search your library">
              <Search size={16} /><span>Search your library</span><kbd>⌘ K</kbd>
            </button>
            <button className="theme-toggle" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
              <span className={`theme-toggle-dot ${theme === "light" ? "light" : ""}`} />
              <span>{theme[0].toUpperCase() + theme.slice(1)}</span>
              <ChevronDown size={13} />
            </button>
            <button className="import-button" onClick={() => { setImportSeries(null); setImportOpen(true); }}>
              <Plus size={16} /><span>Import books</span>
            </button>
            <button
              type="button"
              className="account-control"
              onClick={openAccount}
              title="Account settings"
              aria-label={`Account settings for ${user?.username ?? "user"}`}
            >
              <CircleUserRound size={21} strokeWidth={1.7} />
            </button>
          </div>
        </header>

        {scanJobId && <div className="scan-activity" role="region" aria-label="Library scan progress">
          <ScanLine size={17} aria-hidden="true" />
          <div className="scan-activity-details">
            <div className="scan-activity-copy"><strong>{scanProgress?.cancel_requested ? "Cancelling library scan…" : scanProgress?.status === "queued" ? "Library scan queued" : "Scanning your library"}</strong><span>{scanProgress?.status === "queued" ? "The worker will begin shortly." : `${scanProgress?.progress ?? 0} of ${scanProgress?.total ?? 0} archives checked`}</span></div>
            <progress aria-label="Library scan progress" max={Math.max(scanProgress?.total ?? 0, 1)} value={Math.min(scanProgress?.progress ?? 0, Math.max(scanProgress?.total ?? 0, 1))} />
          </div>
          {!scanProgress?.cancel_requested && <button type="button" className="scan-activity-cancel" onClick={() => void cancelLibraryScan()} aria-label="Cancel library scan">Cancel</button>}
        </div>}

        <main className="main-area">
          <div className="content-area">{children}</div>
          <footer className="app-footer">
            <span><span className="status-indicator" /> All files stay on your device</span>
            <button aria-label="Help and about Veylora" className="footer-help"><Heart size={15} /> Made for the love of stories</button>
          </footer>
        </main>
      </div>

      {searchOpen && (
        <div className="overlay-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSearchOpen(false)}>
          <div className="search-dialog" role="dialog" aria-modal="true" aria-label="Search your library">
            <div className="search-dialog-field"><Search size={19} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search titles, authors, genres..." /><button className="dialog-close" onClick={() => setSearchOpen(false)}><X size={17} /></button></div>
            <div className="search-dialog-bottom"><span>Search your collection</span><span><kbd>ESC</kbd> to close</span></div>
            {search && <div className="search-dialog-results">
              {searchResults.length ? searchResults.map((series) => (
                <Link href={`/series/${series.id}`} key={series.id} className="search-result" onClick={() => setSearchOpen(false)}>
                  <span className={`search-result-swatch art-${series.art}`} />
                  <span><strong>{series.title}</strong><small>{series.author} · {series.genres.join(", ")}</small></span>
                  <ArrowUpRight size={14} />
                </Link>
              )) : <div className="search-hint"><ListFilter size={15} /> No matching stories in your library.</div>}
            </div>}
          </div>
        </div>
      )}
      {accountOpen && (
        <div className="overlay-backdrop account-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setAccountOpen(false)}>
          <section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title">
            <header className="account-dialog-header">
              <span className="account-dialog-avatar"><CircleUserRound size={23} /></span>
              <div><p className="eyebrow">YOUR VEYLORA ACCOUNT</p><h2 id="account-dialog-title">Account settings</h2></div>
              <button type="button" className="dialog-close" onClick={() => setAccountOpen(false)} aria-label="Close account settings"><X size={17} /></button>
            </header>
            <p className="account-dialog-description">Update your profile and password. Changing your password signs out other sessions.</p>
            <form className="account-form" onSubmit={(event) => void saveAccount(event)}>
              <label htmlFor="account-username">Username</label>
              <div className="account-input-wrap"><UserRound size={16} /><input id="account-username" autoComplete="username" minLength={3} maxLength={32} required value={accountUsername} onChange={(event) => setAccountUsername(event.target.value)} /></div>
              <div className="account-form-divider"><span>Password</span><small>Leave new password empty to keep it unchanged</small></div>
              <label htmlFor="account-current-password">Current password</label>
              <div className="account-input-wrap"><KeyRound size={16} /><input id="account-current-password" type="password" autoComplete="current-password" maxLength={128} required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div>
              <label htmlFor="account-new-password">New password</label>
              <div className="account-input-wrap"><KeyRound size={16} /><input id="account-new-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="At least 8 characters" /></div>
              <label htmlFor="account-confirm-password">Confirm new password</label>
              <div className="account-input-wrap"><KeyRound size={16} /><input id="account-confirm-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></div>
              {accountMessage && <p className={`account-form-message ${accountMessage === "Account settings saved." ? "success" : ""}`} role="status">{accountMessage}</p>}
              <div className="account-dialog-actions">
                <button type="button" className="account-signout" onClick={() => void signOut()}><LogOut size={15} />Sign out</button>
                <button type="submit" className="button button-primary" disabled={accountBusy}>{accountBusy ? "Saving…" : "Save changes"}</button>
              </div>
            </form>
          </section>
        </div>
      )}
      {importOpen && <ImportDialog
        scanning={Boolean(scanJobId)}
        initialSeries={importSeries ?? undefined}
        onClose={() => { setImportOpen(false); setImportSeries(null); }}
        onScanLibrary={() => void startLibraryScan()}
        onImportComplete={finishBookUpload}
      />}
      {importNotice && <div className="toast-message" role="status">{importNotice}<button onClick={() => setImportNotice("")}><X size={13} /></button></div>}
      </ImportSeriesProvider>
    </div>
  );
}
