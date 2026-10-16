//! Server folder browser for windows without a native file dialog (plain browser and remote windows). It lists
//! folders on the server through backend `list_dir` and is shared by FolderPickerModal, SaveAsModal, and the
//! notebook vault dialogs.
//!
//! The layout follows Finder, Explorer, and GTK file choosers (design: folder-picker.css header):
//! 1. Places on the left: Home, the file-system root or Windows drives, project roots, and recent folders.
//! 2. The current folder's contents on the right as a flat list. A click selects a folder, a double click or
//!    Enter opens it; with nothing selected, the current folder is the result (`target`).
//! 3. An always-editable path bar with folder completion. Enter or Go opens the typed path; an unapplied or
//!    invalid path blocks confirmation rather than submitting the previous folder.
//! 4. A separate filter that narrows only the current folder.
//! Paths use the server's own syntax (POSIX or Windows), see serverPath.ts.

import "./folder-picker.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import Icons from "../components/Icons";
import { ContextMenu, type MenuItem } from "../components/ContextMenu";
import { useT } from "../i18n";
import { createDir, listDir, previewDestination, type DirEntry } from "../ipc/info";
import { useTermStore } from "../store/termStore";
import {
  baseName,
  expandHome,
  isAbsolutePath,
  joinPath,
  normalizePath,
  parentPath,
  rootLabel,
  samePath,
  sepOf,
  serverFs,
  type ServerFs,
} from "./serverPath";
import { writeDialogDraft } from "./dialogNavigation";

export { joinPath } from "./serverPath";

/** Recent folders in localStorage, newest first, falling back quietly to empty when unavailable. */
const RECENTS_KEY = "vlxterm.pickerRecents";
function loadRecents(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Record a folder as recently used, deduplicated and moved to the front with a limit of six. */
export function pushRecentFolder(path: string): string[] {
  const next = [path, ...loadRecents().filter((x) => x !== path)].slice(0, 6);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* Without localStorage the list simply is not remembered. */
  }
  return next;
}

/**
 * Browser state: current folder and its entries, selection, history, filter, hidden toggle, and places data.
 * Each activation starts at `initialPath` (with `~` expanded) or Home, and falls back to Home when the initial
 * path cannot be listed.
 */
export function useServerBrowser(active: boolean, options: { initialPath?: string; route?: boolean } = {}) {
  const t = useT();
  const projects = useTermStore((s) => s.projects);
  const [fs, setFs] = useState<ServerFs | null>(null);
  const [cwd, setCwd] = useState("");
  const [pathDraft, setPathDraftState] = useState("");
  const [pendingAction, setPendingAction] = useState(false);
  const [entries, setEntries] = useState<DirEntry[] | null>(null); // null means loading.
  const [listError, setListError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [back, setBack] = useState<string[]>([]);
  const [forward, setForward] = useState<string[]>([]);
  const [showHidden, setShowHidden] = useState(false);
  const [filter, setFilter] = useState("");
  const [recents, setRecents] = useState<string[]>(loadRecents);
  const [error, setError] = useState(""); // Action error written by the owning dialog.
  const seq = useRef(0);
  const cwdRef = useRef("");
  const flavor = fs?.flavor ?? "posix";
  const route = options.route ?? false;
  const setPathDraft = useCallback((next: string) => {
    setPathDraftState(next);
    if (route) writeDialogDraft("pickerDraft", next);
  }, [route]);
  const setFilterValue = useCallback((next: string) => {
    setFilter(next);
    setSelected(null);
    if (route) { writeDialogDraft("pickerFilter", next); writeDialogDraft("pickerSelected", ""); }
  }, [route]);
  const setSelection = useCallback((next: string | null) => {
    setSelected(next);
    if (route) writeDialogDraft("pickerSelected", next ?? "");
  }, [route]);

  /** List `path` and make it the current folder; resolves false when it cannot be listed. */
  const load = useCallback(async (path: string): Promise<boolean> => {
    const id = ++seq.current;
    cwdRef.current = path;
    setCwd(path);
    setPathDraftState(path);
    setEntries(null);
    setListError("");
    setSelected(null);
    setFilter("");
    try {
      const kids = await listDir(path);
      if (id !== seq.current) return false;
      setEntries(kids);
      return true;
    } catch (e) {
      if (id === seq.current) {
        setEntries([]);
        setListError(String(e));
      }
      return false;
    }
  }, []);

  /** Open a folder, recording the previous one for Back. */
  const open = useCallback(
    (path: string) => {
      const target = normalizePath(path, flavor);
      const prev = cwdRef.current;
      if (prev && prev !== target) {
        setBack((b) => [...b, prev].slice(-50));
        setForward([]);
      }
      const result = load(target);
      if (route) {
        const url = new URL(window.location.href);
        url.searchParams.set("pickerPath", target);
        ["pickerDraft", "pickerFilter", "pickerSelected"].forEach(key => url.searchParams.delete(key));
        if (url.href !== window.location.href) {
          window.history.pushState(null, "", url);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
      }
      return result;
    },
    [flavor, load, route],
  );

  const initialPath = options.initialPath;
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    seq.current++;
    cwdRef.current = "";
    setCwd("");
    setEntries(null);
    setListError("");
    setError("");
    setBack([]);
    setForward([]);
    setShowHidden(false);
    setRecents(loadRecents());
    void serverFs().then(async (info) => {
      if (cancelled) return;
      setFs(info);
      const params = new URLSearchParams(window.location.search);
      const requested = (route ? params.get("pickerPath") : null) || initialPath || info.home;
      const wanted = normalizePath(expandHome(requested, info.home, info.flavor), info.flavor);
      if (!isAbsolutePath(wanted, info.flavor)) {
        setPathDraftState(requested); setEntries([]); setListError(t("location.notAbsolute"));
        return;
      }
      await load(wanted);
      if (cancelled) return;
      if (route) {
        writeDialogDraft("pickerPath", wanted);
        setPathDraftState(params.get("pickerDraft") || wanted);
        setFilter(params.get("pickerFilter") || "");
        setSelected(params.get("pickerSelected"));
        setShowHidden(params.get("pickerHidden") === "1");
      }
    }).catch(() => {
      if (!cancelled) { setEntries([]); setListError(t("location.hostUnavailable")); }
    });
    return () => {
      cancelled = true;
    };
  }, [active, initialPath, load, route, t]);

  useEffect(() => {
    if (!active || !route || !fs) return;
    const update = () => {
      const params = new URLSearchParams(window.location.search);
      const path = params.get("pickerPath") || fs.home;
      const restore = () => {
        setPathDraftState(params.get("pickerDraft") || path);
        setFilter(params.get("pickerFilter") || ""); setSelected(params.get("pickerSelected"));
        setShowHidden(params.get("pickerHidden") === "1");
      };
      if (path !== cwdRef.current) void load(path).then(restore); else restore();
    };
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, [active, route, fs, load]);

  const goBack = useCallback(() => {
    const prev = back[back.length - 1];
    if (prev === undefined) return;
    setBack((b) => b.slice(0, -1));
    setForward((f) => [cwdRef.current, ...f]);
    void load(prev);
    if (route) { writeDialogDraft("pickerPath", prev); writeDialogDraft("pickerDraft", ""); }
  }, [back, load, route]);

  const goForward = useCallback(() => {
    const next = forward[0];
    if (next === undefined) return;
    setForward((f) => f.slice(1));
    setBack((b) => [...b, cwdRef.current]);
    void load(next);
    if (route) { writeDialogDraft("pickerPath", next); writeDialogDraft("pickerDraft", ""); }
  }, [forward, load, route]);

  const canUp = !!cwd && parentPath(cwd, flavor) !== cwd;
  const goUp = useCallback(() => {
    if (canUp) void open(parentPath(cwdRef.current, flavor));
  }, [canUp, open, flavor]);

  /** Create a folder in the current folder and select it; failures propagate to the caller. */
  const createFolder = useCallback(
    async (name: string) => {
      const dir = cwdRef.current;
      if (!dir) return;
      const preview = await previewDestination(dir, name);
      if (preview.problem || preview.existingKind) throw new Error(preview.existingKind ? t("location.exists") : t("location.invalidName"));
      await createDir(preview.path);
      await load(dir);
      setSelected(name);
    },
    [load, t],
  );

  const pushRecent = useCallback((p: string) => setRecents(pushRecentFolder(p)), []);

  const visible = useMemo(() => {
    if (!entries) return null;
    const q = filter.trim().toLowerCase();
    return entries.filter((e) => (showHidden || !e.isHidden) && (!q || e.name.toLowerCase().includes(q)));
  }, [entries, filter, showHidden]);

  const selectedEntry = selected == null ? undefined : entries?.find((e) => e.name === selected);
  /** Folder the dialog would use now: the selected subfolder, else the current folder, else nothing. */
  const target =
    !cwd || listError || entries === null || pathDraft !== cwd || pendingAction ? ""
      : selectedEntry?.isDir ? joinPath(cwd, selectedEntry.name, flavor) : cwd;

  const projectRoots = useMemo(
    () =>
      projects
        .filter((p) => p.rootPath)
        .map((p) => ({ label: p.name || baseName(p.rootPath!, flavor), path: p.rootPath! })),
    [projects, flavor],
  );

  return {
    fs,
    flavor,
    cwd,
    pathDraft,
    setPathDraft,
    pathPending: pathDraft !== cwd,
    pendingAction,
    setPendingAction,
    entries,
    visible,
    listError,
    selected,
    setSelected: setSelection,
    target,
    /** Alias of `target`, kept for callers written against the previous tree browser. */
    selectedDir: target,
    open,
    goBack,
    goForward,
    canBack: back.length > 0,
    canForward: forward.length > 0,
    backTarget: back[back.length - 1] ?? "",
    goUp,
    canUp,
    refresh: async () => {
      const info = await serverFs(true);
      setFs(info);
      return open(cwdRef.current || info.home);
    },
    createFolder,
    showHidden,
    setShowHidden: (update: boolean | ((previous: boolean) => boolean)) => {
      const next = typeof update === "function" ? update(showHidden) : update;
      setShowHidden(next);
      if (route) writeDialogDraft("pickerHidden", next ? "1" : "");
    },
    filter,
    setFilter: setFilterValue,
    projectRoots,
    recents,
    pushRecent,
    error,
    setError,
  };
}

export type ServerBrowser = ReturnType<typeof useServerBrowser>;

interface Place {
  key: string;
  label: string;
  path: string;
  icon: "home" | "drive" | "project" | "clock";
  caption?: string;
}

/** Places grouped by section, deduplicated by path so a folder appears only in its first section. */
function usePlaces(browser: ServerBrowser): { title: string; items: Place[] }[] {
  const t = useT();
  const { fs, flavor, projectRoots, recents } = browser;
  return useMemo(() => {
    if (!fs) return [];
    const seen = new Set<string>();
    const take = (items: Place[]) =>
      items.filter((p) => {
        const k = normalizePath(p.path, flavor).toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    const win = flavor === "win";
    const locations: Place[] = [{ key: "home", label: t("dir.placeHome"), path: fs.home, icon: "home" }];
    if (!win) {
      locations.push({
        key: "root",
        label: fs.os === "macos" ? t("dir.placeComputer") : t("dir.placeFileSystem"),
        path: "/",
        icon: "drive",
        caption: "/",
      });
    }
    const sections = [
      { title: t("dir.sectionLocations"), items: take(locations) },
      {
        title: t("dir.sectionDrives"),
        items: win ? take(fs.roots.map((r) => ({ key: r, label: rootLabel(r), path: r, icon: "drive" as const }))) : [],
      },
      {
        title: t("dir.sectionProjects"),
        items: take(projectRoots.map((p) => ({ key: p.path, label: p.label, path: p.path, icon: "project" as const }))),
      },
      {
        title: t("dir.sectionRecent"),
        items: take(recents.map((r) => ({ key: r, label: baseName(r, flavor), path: r, icon: "clock" as const }))),
      },
    ];
    return sections.filter((s) => s.items.length > 0);
  }, [fs, flavor, projectRoots, recents, t]);
}

const PLACE_ICON = { home: Icons.home, drive: Icons.drive, project: Icons.project, clock: Icons.clock } as const;

interface Suggestion {
  path: string;
  dir: string;
  name: string;
  matched: number;
}

/** Always-visible path input. A pending draft survives blur and blocks use of the previous directory. */
function PathBar({ browser, inputRef, onDone }: {
  browser: ServerBrowser;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onDone: () => void;
}) {
  const t = useT();
  const { fs, flavor, pathDraft: text } = browser;
  const [bad, setBad] = useState(false);
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const cache = useRef(new Map<string, Promise<DirEntry[]>>());

  useEffect(() => {
    setBad(false); setHighlight(-1);
  }, [text]);

  useEffect(() => {
    if (!focused || !fs) { setSuggestions([]); return; }
    const typed = expandHome(text, fs.home, flavor);
    const cut = Math.max(typed.lastIndexOf("/"), flavor === "win" ? typed.lastIndexOf("\\") : -1);
    if (cut < 0 || !isAbsolutePath(typed, flavor)) { setSuggestions([]); return; }
    const dir = normalizePath(typed.slice(0, cut + 1), flavor);
    const prefix = typed.slice(cut + 1).toLowerCase();
    let cancelled = false;
    const timer = window.setTimeout(() => {
      let listing = cache.current.get(dir);
      if (!listing) {
        listing = listDir(dir); cache.current.set(dir, listing);
        listing.catch(() => cache.current.delete(dir));
      }
      listing.then(kids => {
        if (cancelled) return;
        const next = kids.filter(k => k.isDir && k.name.toLowerCase().startsWith(prefix)
          && (browser.showHidden || !k.isHidden || prefix.startsWith("."))).slice(0, 8)
          .map(k => ({ path: joinPath(dir, k.name, flavor), dir, name: k.name, matched: prefix.length }));
        setSuggestions(next); setHighlight(h => Math.min(h, next.length - 1));
      }).catch(() => { if (!cancelled) setSuggestions([]); });
    }, 120);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [focused, text, fs, flavor, browser.showHidden]);

  const commit = async (raw: string) => {
    if (!fs || browser.pendingAction) return;
    const path = expandHome(raw, fs.home, flavor);
    if (!isAbsolutePath(path, flavor)) {
      setBad(true); browser.setError(t("location.notAbsolute")); inputRef.current?.focus(); return;
    }
    browser.setError("");
    const ok = await browser.open(path);
    cache.current.clear();
    if (ok) { setFocused(false); onDone(); }
    else { setBad(true); inputRef.current?.focus(); }
  };

  return (
    <div className="fp-path-field">
      <label className="fp-label" htmlFor="server-folder-path">{t("dir.pathLabel")}</label>
      <div className="fp-path-controls">
        <div className="fp-pathwrap">
          <input ref={inputRef} id="server-folder-path" className={"fp-path-input" + (bad ? " bad" : "")}
            value={text} aria-label={t("dir.pathLabel")} aria-invalid={bad} disabled={browser.pendingAction}
            aria-describedby={browser.pathPending ? "server-folder-path-pending" : undefined}
            spellCheck={false} autoCapitalize="off" autoCorrect="off"
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            onChange={e => { browser.setPathDraft(e.target.value); browser.setError(""); setHighlight(-1); }}
            onKeyDown={e => {
              if (e.key === "ArrowDown" && suggestions.length) {
                e.preventDefault(); setHighlight(h => (h + 1) % suggestions.length);
              } else if (e.key === "ArrowUp" && suggestions.length) {
                e.preventDefault(); setHighlight(h => h <= 0 ? suggestions.length - 1 : h - 1);
              } else if (e.key === "Tab" && suggestions.length && !e.shiftKey) {
                e.preventDefault(); browser.setPathDraft(suggestions[Math.max(highlight, 0)].path + sepOf(flavor)); setHighlight(-1);
              } else if (e.key === "Enter") {
                e.preventDefault(); e.stopPropagation(); void commit(highlight >= 0 ? suggestions[highlight].path : text);
              } else if (e.key === "Escape" && (browser.pathPending || suggestions.length)) {
                e.preventDefault(); e.stopPropagation(); browser.setPathDraft(browser.cwd); browser.setError("");
                setBad(false); setFocused(false); onDone();
              }
            }} />
          {focused && suggestions.length > 0 && <div className="fp-suggest" role="listbox" aria-label={t("dir.pathLabel")}>
            {suggestions.map((s, i) => <div key={s.path} role="option" aria-selected={i === highlight}
              className={"fp-suggest-item" + (i === highlight ? " on" : "")}
              onMouseDown={e => e.preventDefault()} onClick={() => void commit(s.path)}>
              <Icons.folder size={15} fill /><span>{s.dir.endsWith(sepOf(flavor)) ? s.dir : s.dir + sepOf(flavor)}<b>{s.name.slice(0, s.matched)}</b>{s.name.slice(s.matched)}</span>
              {i === Math.max(highlight, 0) && <span className="fp-key">Tab</span>}
            </div>)}
          </div>}
        </div>
        <button type="button" className="vlx-btn fp-path-go" onClick={() => void commit(text)} disabled={!fs || browser.pendingAction}>{t("dir.go")}</button>
      </div>
      {browser.pathPending && <span id="server-folder-path-pending" className="fp-path-pending" role="status">{t("dir.pathPending")}</span>}
    </div>
  );
}

/**
 * Toolbar, places, and folder list. Dialogs supply their own title and footer (see TargetPath).
 * - `onSubmit`: Enter in the list with no folder selected, usually the dialog's confirm action.
 * - `onFileClick` / `onFileActivate`: make files selectable (Save As fills its name; a double click saves).
 * - `selectedName`: highlight the file matching the Save As name.
 */
export function ServerBrowserView({
  browser,
  onSubmit,
  onFileClick,
  onFileActivate,
  selectedName,
}: {
  browser: ServerBrowser;
  onSubmit?: () => void;
  onFileClick?: (name: string) => void;
  onFileActivate?: (name: string) => void;
  selectedName?: string;
}) {
  const t = useT();
  const places = usePlaces(browser);
  const pathRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [placesMenu, setPlacesMenu] = useState<{ x: number; y: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const { cwd, flavor, visible, selected } = browser;

  // Focus the list once per dialog so arrow keys and Enter work without a click.
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current && browser.entries) {
      focused.current = true;
      listRef.current?.focus({ preventScroll: true });
    }
  }, [browser.entries]);

  useEffect(() => {
    if (!selected) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-name="${CSS.escape(selected)}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const selectable = (e: DirEntry) => e.isDir || !!onFileClick;

  const startCreate = () => {
    browser.setError("");
    setNewName("");
    setCreating(true);
    browser.setPendingAction(true);
  };

  // Close the input before creating so the blur that follows does not submit the same name twice.
  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await browser.createFolder(name);
      setCreating(false); browser.setPendingAction(false);
    } catch (e) { browser.setError(String(e)); }
  };

  const activate = (e: DirEntry) => {
    if (e.isDir) void browser.open(joinPath(cwd, e.name, flavor));
    else onFileActivate?.(e.name);
  };

  const onRootKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "l") {
      e.preventDefault();
      e.stopPropagation();
      pathRef.current?.focus(); pathRef.current?.select();
    } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      e.stopPropagation();
      filterRef.current?.focus();
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    const rows = (visible || []).filter(selectable);
    const index = rows.findIndex((r) => r.name === selected);
    const current = index >= 0 ? rows[index] : undefined;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (e.altKey || e.metaKey) {
        e.preventDefault();
        if (e.key === "ArrowUp") browser.goUp();
        else if (current) activate(current);
        return;
      }
      if (!rows.length) return;
      e.preventDefault();
      const next = e.key === "ArrowDown" ? Math.min(index + 1, rows.length - 1) : Math.max(index - 1, 0);
      browser.setSelected(rows[next].name);
      if (!rows[next].isDir) onFileClick?.(rows[next].name);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (current?.isDir) activate(current);
      else if (current && onFileActivate) activate(current);
      else onSubmit?.();
    } else if (e.key === "Backspace") {
      e.preventDefault();
      browser.goUp();
    } else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      if (e.key === "ArrowLeft") browser.goBack();
      else browser.goForward();
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && e.key !== " ") {
      // Typing in the list starts filtering the current folder.
      e.preventDefault();
      browser.setFilter(browser.filter + e.key);
      filterRef.current?.focus();
    }
  };

  const placeMenuItems: MenuItem[] = places.flatMap((section, i) => [
    ...(i > 0 ? [{ label: "", separator: true }] : []),
    ...section.items.map((p) => {
      const Icon = PLACE_ICON[p.icon];
      return {
        label: p.label,
        icon: <Icon size={13} />,
        checked: !!cwd && samePath(p.path, cwd, flavor),
        onClick: () => void browser.open(p.path),
      };
    }),
  ]);

  const emptyText = browser.filter.trim() ? t("dir.noMatch") : t("dir.empty");

  return (
    <div className="fp-browser" onKeyDown={onRootKeyDown}>
      <div className="fp-bar">
        <div className="fp-nav">
          <button
            type="button"
            className="fp-tool fp-places"
            aria-label={t("dir.places")}
            title={t("dir.places")}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setPlacesMenu({ x: r.left, y: r.bottom + 4 });
            }}
          >
            <Icons.home size={14} />
            <Icons.chevronDown size={11} />
          </button>
          <button type="button" className="fp-tool fp-hist" disabled={!browser.canBack || browser.pendingAction} onClick={browser.goBack} title={t("dir.back")} aria-label={t("dir.back")}>
            <Icons.arrowLeft size={14} />
          </button>
          <button type="button" className="fp-tool fp-hist" disabled={!browser.canForward || browser.pendingAction} onClick={browser.goForward} title={t("dir.forward")} aria-label={t("dir.forward")}>
            <Icons.arrowRight size={14} />
          </button>
          <button type="button" className="fp-tool" disabled={!browser.canUp || browser.pendingAction} onClick={browser.goUp} title={t("dir.up")} aria-label={t("dir.up")}>
            <Icons.arrowUp size={14} />
          </button>
        </div>
        <PathBar
          browser={browser}
          inputRef={pathRef}
          onDone={() => requestAnimationFrame(() => listRef.current?.focus({ preventScroll: true }))}
        />
      </div>

      <div className="fp-body">
        <nav className="fp-side" aria-label={t("dir.places")}>
          {places.map((section) => (
            <div key={section.title} style={{ display: "contents" }}>
              <div className="fp-side-head">{section.title}</div>
              {section.items.map((p) => {
                const Icon = PLACE_ICON[p.icon];
                const on = !!cwd && samePath(p.path, cwd, flavor);
                return (
                  <button
                    type="button"
                    key={section.title + p.key}
                    className={"fp-place" + (on ? " on" : "")}
                    title={p.path}
                    aria-current={on ? "location" : undefined}
                    onClick={() => void browser.open(p.path)}
                  >
                    <Icon size={14} />
                    <span className="fp-nm">{p.label}</span>
                    {p.caption && <span className="fp-cap">{p.caption}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="fp-content">
          <div className="fp-content-tools">
            <label className="fp-filter">
              <Icons.search size={16} />
              <input ref={filterRef} value={browser.filter} placeholder={t("dir.filter")} aria-label={t("dir.filter")}
                spellCheck={false} onChange={e => browser.setFilter(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Escape" && browser.filter) {
                    e.stopPropagation(); browser.setFilter(""); listRef.current?.focus();
                  } else if (e.key === "ArrowDown" || e.key === "Enter") {
                    e.preventDefault(); e.stopPropagation();
                    const first = (visible || []).find(selectable);
                    if (first) browser.setSelected(first.name);
                    listRef.current?.focus();
                  }
                }} />
            </label>
            <button type="button" className="fp-tool" onClick={startCreate} disabled={!cwd || !!browser.listError || browser.pathPending || browser.pendingAction}
              title={t("dir.newFolder")} aria-label={t("dir.newFolder")}><Icons.folderPlus size={17} /></button>
            <button type="button" className={"fp-tool" + (browser.showHidden ? " on" : "")}
              onClick={() => browser.setShowHidden(v => !v)} title={t("dir.showHidden")} aria-label={t("dir.showHidden")}
              aria-pressed={browser.showHidden}>{browser.showHidden ? <Icons.eye size={17} /> : <Icons.eyeOff size={17} />}</button>
          </div>
        <div
          ref={listRef}
          className="fp-list"
          tabIndex={0}
          role="listbox"
          aria-label={cwd}
          onKeyDown={onListKeyDown}
          onClick={(e) => {
            if (e.target === e.currentTarget) browser.setSelected(null);
          }}
        >
          {creating && (
            <div className="fp-row fp-new">
              <Icons.folder size={14} fill />
              <input
                autoFocus
                value={newName}
                placeholder={t("dir.newFolderPlaceholder")}
                spellCheck={false}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation(); // Keep list shortcuts such as Backspace out of the name field.
                  if (e.key === "Enter") { e.preventDefault(); void submitCreate(); }
                  if (e.key === "Escape") { setCreating(false); browser.setPendingAction(false); }
                }}
              />
              <button type="button" className="vlx-btn" onClick={() => void submitCreate()}>{t("dir.newFolder")}</button>
              <button type="button" className="icon-btn" aria-label={t("common.cancel")}
                onClick={() => { setCreating(false); browser.setPendingAction(false); }}><Icons.cancel size={15} /></button>
            </div>
          )}
          {browser.listError ? (
            <div className="fp-empty">
              <Icons.warn size={20} />
              <div className="fp-empty-title">{t("dir.cantOpen")}</div>
              <div className="fp-empty-path">{cwd}</div>
              {!browser.fs ? <button type="button" className="vlx-btn" onClick={() => void browser.refresh().catch(e => browser.setError(String(e)))}>{t("common.retry")}</button> : browser.canBack ? (
                <button type="button" className="vlx-btn" onClick={browser.goBack}>
                  {t("dir.backTo", browser.backTarget)}
                </button>
              ) : (
                browser.fs && (
                  <button type="button" className="vlx-btn" onClick={() => void browser.open(browser.fs!.home)}>
                    {t("dir.goHome")}
                  </button>
                )
              )}
            </div>
          ) : visible == null ? (
            <div className="fp-empty">{t("common.loading")}</div>
          ) : visible.length === 0 && !creating ? (
            <div className="fp-empty">{emptyText}</div>
          ) : (
            visible.map((e) => {
              const pickFile = !e.isDir && !!onFileClick;
              const sel = e.isDir || pickFile ? selected === e.name || (!e.isDir && selectedName === e.name) : false;
              return (
                <div
                  key={e.name}
                  data-name={e.name}
                  role="option"
                  aria-selected={sel}
                  className={
                    "fp-row" +
                    (e.isDir ? " dir" : " file") +
                    (pickFile ? " pick" : "") +
                    (sel ? " sel" : "") +
                    (e.isHidden ? " hidden-entry" : "")
                  }
                  onClick={() => {
                    if (e.isDir) browser.setSelected(e.name);
                    else if (pickFile) {
                      browser.setSelected(e.name);
                      onFileClick!(e.name);
                    }
                  }}
                  onDoubleClick={() => (e.isDir || pickFile) && activate(e)}
                >
                  {e.isDir ? <Icons.folder size={14} fill /> : <Icons.file size={13} />}
                  <span className="fp-nm">{e.name}</span>
                  {e.isDir && (
                    <span className="fp-go">
                      {sel ? <Icons.check size={17} /> : <Icons.chevronRight size={15} />}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
        </div>
      </div>

      {placesMenu && (
        <ContextMenu x={placesMenu.x} y={placesMenu.y} items={placeMenuItems} onClose={() => setPlacesMenu(null)} />
      )}
    </div>
  );
}

/** The complete target is visible and wraps; the final parent never disappears behind an ellipsis. */
export function TargetPath({ label, path }: { label: string; path: string }) {
  return (
    <div className="fp-target">
      <span className="fp-target-label">{label}</span>
      <span className={"fp-target-value" + (path ? "" : " none")} title={path}>
        <bdi>{path}</bdi>
      </span>
    </div>
  );
}

/** Card style for the notebook vault dialogs, which host the browser inside their own card. */
export const cardStyle: React.CSSProperties = {
  width: "min(460px, calc(100vw - 24px))",
  maxHeight: "min(80vh, 620px)",
  display: "flex",
  flexDirection: "column",
  background: "var(--bg-2)",
  border: "1px solid var(--border-strong)",
  borderRadius: 12,
  boxShadow: "var(--shadow)",
  overflow: "hidden",
};
