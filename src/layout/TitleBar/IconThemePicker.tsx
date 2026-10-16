import { Icon } from "../../components/Icons";
import { useT } from "../../i18n";
import type { IconName } from "../../icons/names";
import { ICON_THEMES, ICON_THEME_IDS, type IconThemeId } from "../../icons/registry";

const PREVIEW: IconName[] = ["refresh", "gitPush", "aiAction", "terminal", "folder"];

/** Icon theme choice; each option previews a few icons drawn in that theme regardless of the active one. */
export function IconThemePicker({ value, onChange }: { value: IconThemeId; onChange: (id: IconThemeId) => void }) {
  const t = useT();
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${ICON_THEME_IDS.length}, minmax(0, 1fr))`, gap: 6, maxWidth: 420 }}>
      {ICON_THEME_IDS.map((id) => {
        const on = value === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(id)}
            style={{
              display: "grid",
              gap: 4,
              justifyItems: "center",
              padding: "6px 10px",
              borderRadius: 5,
              border: on ? "2px solid var(--accent)" : "1px solid var(--border)",
              background: on ? "var(--bg-active)" : "transparent",
              color: "var(--text)",
              cursor: "pointer",
            }}
          >
            <span aria-hidden="true" style={{ display: "flex", gap: 6 }}>
              {PREVIEW.map((name) => <Icon key={name} name={name} theme={id} size={14} />)}
            </span>
            <span style={{ fontSize: 11 }}>{t(ICON_THEMES[id].label)}</span>
          </button>
        );
      })}
    </div>
  );
}
