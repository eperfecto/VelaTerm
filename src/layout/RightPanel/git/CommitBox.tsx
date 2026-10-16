//! Commit message box for the Git panel. It commits what is staged — never what is merely changed —
//! so the button says how many files are going in and stays disabled until both a message and
//! something staged exist. Amend is a separate toggle because it rewrites the previous commit
//! rather than adding one, which is a different act and should not be one stray click away.
//!
//! The message is a per-repository draft that survives leaving the tab. Amend names the commit it
//! will rewrite, fills in that commit's message when the box is empty, and sends the commit's
//! identity along, so the backend refuses if HEAD moved in the meantime.

import { useEffect, useRef, useState } from "react";
import Icons from "../../../components/Icons";
import { useT } from "../../../i18n";
import { gitLogPage, type CommitInfo } from "../../../ipc/commands";
import { readCommitDraft, writeCommitDraft } from "./commitDrafts";

export function CommitBox({
  cwd,
  head,
  stagedCount,
  busy,
  onCommit,
  agentLabel,
  onAskAgent,
}: {
  cwd: string;
  /** Full HEAD identity; null before the first commit, when there is nothing to amend. */
  head: string | null;
  stagedCount: number;
  busy: boolean;
  /** Resolves to true when the commit succeeded, which is when the message box clears. */
  onCommit: (message: string, amend: boolean, expectHead: string | null) => Promise<boolean>;
  /** Agent of the shown session that can be asked to write the message and commit; null when none. */
  agentLabel?: string | null;
  onAskAgent?: () => void;
}) {
  const t = useT();
  const [message, setMessageState] = useState(() => readCommitDraft(cwd));
  const [amend, setAmend] = useState(false);
  // The commit an amend would rewrite, loaded for the HEAD currently shown.
  const [target, setTarget] = useState<CommitInfo | null>(null);
  // Latest text, read by async callbacks that must not act on a stale render.
  const messageRef = useRef(message);
  // Message filled in from the amend target; cleared again when amend is turned off untouched.
  const prefilledRef = useRef<string | null>(null);

  const setMessage = (next: string) => {
    messageRef.current = next;
    setMessageState(next);
    writeCommitDraft(cwd, next);
  };

  // Nothing to amend before the first commit.
  useEffect(() => {
    if (!head) setAmend(false);
  }, [head]);

  useEffect(() => {
    if (!amend || !head) {
      setTarget(null);
      return;
    }
    let alive = true;
    setTarget(null);
    void gitLogPage(cwd, 1, 0, head)
      .then(([commit]) => {
        if (!alive || !commit) return;
        setTarget(commit);
        const current = messageRef.current;
        if (!current.trim() || current === prefilledRef.current) {
          const original = commit.message ?? commit.subject;
          prefilledRef.current = original;
          setMessage(original);
        }
      })
      .catch(() => {
        if (alive) setTarget(null);
      });
    return () => {
      alive = false;
    };
    // setMessage only writes refs, state, and storage for this repository.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amend, head, cwd]);

  const toggleAmend = (on: boolean) => {
    setAmend(on);
    if (!on && prefilledRef.current !== null && messageRef.current === prefilledRef.current) setMessage("");
    if (!on) prefilledRef.current = null;
  };

  // Amend needs no new staged file, but it does need its target loaded so the commit is bound to it.
  const canCommit = message.trim().length > 0 && (amend ? target !== null : stagedCount > 0) && !busy;

  const submit = async () => {
    if (!canCommit) return;
    const submitted = message;
    const ok = await onCommit(submitted.trim(), amend, amend ? target?.oid ?? null : null);
    if (!ok) return;
    // Text typed while a slow commit was running belongs to the next commit; keep it.
    if (messageRef.current === submitted) setMessage("");
    prefilledRef.current = null;
    setAmend(false);
  };

  return (
    <div className="git-commit">
      <textarea
        className="git-commit-msg"
        value={message}
        rows={2}
        placeholder={t("git.commitPlaceholder")}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          // Enter inserts a newline for a commit body; the platform's accelerator commits.
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      {amend && target && (
        <div className="git-amend-target" title={target.message}>
          {t("git.amendTarget", target.hash, target.subject)}
        </div>
      )}
      <div className="git-commit-bar">
        <label className="git-amend" title={head ? undefined : t("git.amendUnavailable")}>
          <input type="checkbox" checked={amend} disabled={!head} onChange={(e) => toggleAmend(e.target.checked)} />
          {t("git.amend")}
        </label>
        {agentLabel && onAskAgent && (
          <button
            type="button"
            className="git-commit-ask"
            disabled={busy || stagedCount === 0}
            title={t("git.ask.commit", agentLabel)}
            aria-label={t("git.ask.commit", agentLabel)}
            onClick={onAskAgent}
          >
            <Icons.aiCommitMessage size={13} />
          </button>
        )}
        <button type="button" className="git-commit-btn" disabled={!canCommit} onClick={() => void submit()}>
          {amend ? t("git.amendCommit") : t("git.commitCount", stagedCount)}
        </button>
      </div>
    </div>
  );
}
