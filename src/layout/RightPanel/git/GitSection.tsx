//! Collapsible group header for the Git panel: a disclosure arrow, a title, its count, and the
//! actions that apply to the whole group. The actions only appear when the group has rows, so an
//! empty group stays a quiet single line.

import Icons from "../../../components/Icons";

/** One right-aligned group action, such as Stage all or Discard all. */
export interface SectionAction {
  key: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  danger?: boolean;
}

export function GitSection({
  title,
  count,
  open,
  onToggle,
  actions = [],
  children,
  view,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  actions?: SectionAction[];
  children?: React.ReactNode;
  view?: { label: string; onClick: () => void };
}) {
  return (
    <div className="git-sec">
      <div className="git-sec-head">
        <button
          type="button"
          className="git-sec-toggle"
          title={title}
          onClick={onToggle}
          aria-expanded={open}
        >
          <span className="tw">{open ? <Icons.chevronDown size={12} /> : <Icons.chevronRight size={12} />}</span>
          <span className="ttl">{title}</span>
          <span className="cnt">{count}</span>
        </button>
        {view && count > 0 && <button type="button" className="git-sec-act git-view-all" onClick={view.onClick}>{view.label}</button>}
        {count > 0 && actions.map((action) => (
          <button
            key={action.key}
            type="button"
            className={"git-sec-act" + (action.danger ? " danger" : "")}
            title={action.label}
            aria-label={action.label}
            onClick={action.onClick}
            disabled={action.disabled}
          >
            {action.icon ?? action.label}
          </button>
        ))}
      </div>
      {open && children}
    </div>
  );
}

/** Inline confirmation for an action that destroys work: what will happen, and two buttons. */
export function GitConfirm({
  text,
  confirmLabel,
  cancelLabel,
  disabled,
  onConfirm,
  onCancel,
}: {
  text: string;
  confirmLabel: string;
  cancelLabel: string;
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="git-confirm" role="alertdialog" aria-label={confirmLabel}>
      <span>{text}</span>
      <div className="git-confirm-acts">
        <button type="button" className="vlx-btn git-danger-btn" disabled={disabled} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className="vlx-btn" onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
