//! Directory-tree sidebar for document tabs. It starts at the current file's directory and
//! lazily loads one level at a time using the same `list_dir` call as the Files panel. The root
//! can move up one directory at a time. Clicking a file calls `openDocTab` (deduplicating and
//! focusing an existing tab for the same path); clicking a directory toggles it. The tree is
//! mounted only while enabled, so reopening it reloads a fresh root and expansion state.

import { useEffect, useState } from "react";
import Icons from "../../../components/Icons";
import { useT } from "../../../i18n";
import { listDir, type DirEntry } from "../../../ipc/info";
import { useTermStore } from "../../../store/termStore";

interface TreeNode {
  name: string;
  /** Absolute path. */
  path: string;
  isDir: boolean;
  badge?: string | null;
  open?: boolean;
  /** Whether the children have already been loaded from the backend. */
  loaded?: boolean;
  children?: TreeNode[];
}

/** Convert a backend DirEntry into a tree node with an absolute path. */
function toNode(e: DirEntry, parentPath: string): TreeNode {
  const base = parentPath === "/" ? "" : parentPath;
  return {
    name: e.name,
    path: `${base}/${e.name}`,
    isDir: e.isDir,
    badge: e.gitBadge,
    open: false,
    loaded: false,
  };
}

/** Return the parent of an absolute path, stopping at "/". */
function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

function Row({
  node,
  depth,
  selPath,
  onFile,
  onDir,
}: {
  node: TreeNode;
  depth: number;
  selPath: string;
  onFile: (n: TreeNode) => void;
  onDir: (n: TreeNode) => void;
}) {
  const pad = 8 + depth * 13;
  if (node.isDir) {
    return (
      <div>
        <div className="file-row" style={{ paddingLeft: pad }} onClick={() => onDir(node)}>
          <span className="tw">{node.open ? <Icons.chevronDown size={13} /> : <Icons.chevronRight size={13} />}</span>
          <span className="ic" style={{ color: "var(--text-dim)" }}>
            {node.open ? <Icons.folderOpen size={14} /> : <Icons.folder size={14} />}
          </span>
          <span className="nm">{node.name}</span>
        </div>
        {node.open &&
          (node.children || []).map((c) => (
            <Row key={c.path} node={c} depth={depth + 1} selPath={selPath} onFile={onFile} onDir={onDir} />
          ))}
      </div>
    );
  }
  return (
    <div
      className={"file-row" + (selPath === node.path ? " sel" : "")}
      style={{ paddingLeft: pad }}
      onClick={() => onFile(node)}
    >
      <span className="tw leaf" />
      <span className="ic" style={{ color: "var(--text-faint)" }}>
        <Icons.file size={13} />
      </span>
      <span className="nm">{node.name}</span>
      {node.badge && <span className={"gb gb-" + node.badge}>{node.badge}</span>}
    </div>
  );
}

/** Directory-tree sidebar. `docPath` is the tab's absolute file path; its directory is the initial root. */
export function DocFileTree({ docPath }: { docPath: string }) {
  const t = useT();
  const [rootPath, setRootPath] = useState(() => parentOf(docPath));
  const [children, setChildren] = useState<TreeNode[] | null>(null); // null means loading
  const [error, setError] = useState(false);

  // Load the first level whenever the root changes (on mount or navigation upward).
  useEffect(() => {
    setChildren(null);
    setError(false);
    let cancelled = false;
    listDir(rootPath)
      .then((kids) => {
        if (cancelled) return;
        setChildren(kids.map((k) => toNode(k, rootPath)));
      })
      .catch(() => {
        if (cancelled) return;
        setChildren([]);
        setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [rootPath]);

  // Toggle a directory, loading its children first if necessary. Mutate the node in place and
  // replace the array reference to trigger rendering, matching the Files panel's approach.
  const onDir = async (node: TreeNode) => {
    if (node.loaded) {
      node.open = !node.open;
      setChildren((c) => (c ? [...c] : c));
      return;
    }
    node.open = true;
    setChildren((c) => (c ? [...c] : c));
    try {
      const kids = await listDir(node.path);
      node.children = kids.map((k) => toNode(k, node.path));
    } catch {
      node.children = [];
    }
    node.loaded = true;
    setChildren((c) => (c ? [...c] : c));
  };

  const onFile = (node: TreeNode) => {
    useTermStore.getState().openDocTab(node.path);
  };

  const rootName = rootPath.split("/").filter(Boolean).pop() || "/";

  return (
    <div className="docview-tree">
      <div className="docview-tree-root">
        <button
          title={t("doc.treeUp")}
          disabled={rootPath === "/"}
          onClick={() => setRootPath(parentOf(rootPath))}
        >
          <Icons.arrowLeft size={12} />
        </button>
        <span className="nm" title={rootPath}>
          {rootName}
        </span>
      </div>
      <div className="docview-tree-list">
        {children == null && (
          <div className="docview-tree-empty">{t("common.loading")}</div>
        )}
        {children != null && error && (
          <div className="docview-tree-empty">{t("panel.cantRead")}</div>
        )}
        {children != null &&
          !error &&
          children.map((c) => (
            <Row key={c.path} node={c} depth={0} selPath={docPath} onFile={onFile} onDir={onDir} />
          ))}
      </div>
    </div>
  );
}
