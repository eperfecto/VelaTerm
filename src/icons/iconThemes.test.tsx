import { act, render } from "@testing-library/react";
import { isValidElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Icons, { Icon } from "../components/Icons";
import { fileIcon } from "../layout/RightPanel/fileIcons";
import { SETTINGS_KEY, loadSettings } from "../store/settings";
import { useTermStore } from "../store/termStore";
import { setActiveIconTheme, useActiveIconTheme } from "./activeTheme";
import { ICON_NAMES, type IconName } from "./names";
import { ICON_THEMES, ICON_THEME_IDS, normalizeIconTheme, resolveGlyph, resolveIcon } from "./registry";
import { parseSvg, svgGlyph } from "./svgGlyph";
import { classicTheme } from "./themes/classic";
import type { IconTheme } from "./types";

const SPLIT_NAMES: IconName[] = [
  "refresh", "gitDiscard", "chatRewind", "updateReady", "terminalRedraw", "sessionResume", "sessionImport",
  "archiveRestore", "gitPush", "fileUpload", "notebookImport", "browserTab", "webServer", "publicShare", "ports",
  "remoteConnect", "elicitation",
];

describe("icon theme registry", () => {
  it("draws every icon name in Classic and nothing else", () => {
    expect(Object.keys(classicTheme.icons).sort()).toEqual([...ICON_NAMES].sort());
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });

  it.each(ICON_THEME_IDS)("only overrides known names in %s", (id) => {
    for (const name of Object.keys(ICON_THEMES[id].icons)) expect(ICON_NAMES).toContain(name);
  });

  it.each(ICON_THEME_IDS.filter((id) => ICON_THEMES[id].mode === "fill"))(
    "parses every %s glyph into drawable paths without dropping markup",
    (id) => {
      for (const [name, glyph] of Object.entries(ICON_THEMES[id].icons)) {
        expect(glyph.issues, `${id}.${name}`).toBeUndefined();
        for (const node of [glyph.node, glyph.filledNode].filter((n) => n !== undefined)) {
          expect(Array.isArray(node) && node.length > 0, `${id}.${name}`).toBe(true);
          for (const el of node as unknown[]) {
            expect(isValidElement(el) && el.type === "path", `${id}.${name}`).toBe(true);
            expect(String((el as { props: { d?: string } }).props.d ?? "").trim(), `${id}.${name}`).not.toBe("");
          }
        }
      }
    },
  );

  it("falls back to Classic, with Classic's viewBox and stroke, for names a theme omits", () => {
    const partial: IconTheme = {
      id: "partial",
      label: "settings.iconThemeMaterial",
      viewBox: "0 0 24 24",
      mode: "fill",
      icons: { search: svgGlyph('<svg><path d="M0 0h24v24H0z"/></svg>') },
    };
    expect(resolveGlyph(partial, "search").theme).toBe(partial);
    const fallback = resolveGlyph(partial, "refresh");
    expect(fallback.theme).toBe(classicTheme);
    expect(fallback.glyph).toBe(classicTheme.icons.refresh);
  });

  it.each(ICON_THEME_IDS)("resolves every name in %s", (id) => {
    for (const name of ICON_NAMES) expect(resolveIcon(id, name).glyph).toBeDefined();
  });

  it("keeps the split names visually identical in Classic", () => {
    expect(classicTheme.icons.gitPush).toBe(classicTheme.icons.fileUpload);
    expect(classicTheme.icons.chatRewind).toBe(classicTheme.icons.refresh);
  });

  it.each(["material", "fluent"] as const)("gives the split names distinct drawings in %s", (id) => {
    const glyphs = SPLIT_NAMES.map((name) => ICON_THEMES[id].icons[name]);
    expect(new Set(glyphs).size).toBe(SPLIT_NAMES.length);
  });
});

describe("parseSvg", () => {
  it("reads attributes in either quote style and any case", () => {
    const parsed = parseSvg(`<SVG viewBox='0 0 20 20'><Path D='M1 1h2' FILL-RULE="evenodd" clip-rule='evenodd'/></SVG>`);
    expect(parsed).toEqual({ paths: [{ d: "M1 1h2", fillRule: "evenodd", clipRule: "evenodd" }], unsupported: [] });
  });

  it("reports markup it cannot draw instead of silently dropping it", () => {
    expect(parseSvg(`<svg><circle cx="1" cy="1" r="1"/></svg>`).unsupported).toEqual(["circle", "no paths"]);
    expect(parseSvg(`<svg><path transform="scale(2)" d="M0 0"/></svg>`).unsupported).toEqual(["path[transform]", "no paths"]);
    expect(parseSvg(`<svg><path fill="url(#a)" d="M0 0"/></svg>`).unsupported).toContain("path[fill]");
    expect(parseSvg(`<svg><path d=" "/><path d="M0 0"/></svg>`).unsupported).toEqual(["path[empty d]"]);
    expect(svgGlyph(`<svg><defs></defs><rect/></svg>`).issues).toEqual(["defs", "rect", "no paths"]);
  });
});

describe("iconTheme setting", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => setActiveIconTheme("classic"));

  it.each([undefined, null, 3, "", "unknown", "fluentColor", "toString", "__proto__"])("normalizes %s to classic", (value) => {
    expect(normalizeIconTheme(value)).toBe("classic");
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ iconTheme: value }));
    expect(loadSettings().iconTheme).toBe("classic");
  });

  it.each(ICON_THEME_IDS)("keeps the saved %s theme", (id) => {
    expect(normalizeIconTheme(id)).toBe(id);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ iconTheme: id }));
    expect(loadSettings().iconTheme).toBe(id);
  });

  it("starts with the saved theme so the first paint does not flash Classic", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ iconTheme: "fluent" }));
    vi.resetModules();
    const fresh = await import("./activeTheme");
    expect(fresh.useActiveIconTheme.getState().id).toBe("fluent");
  });

  it("follows a theme saved by another window", async () => {
    vi.resetModules();
    const fresh = await import("./activeTheme");
    const stop = fresh.followStoredIconTheme();
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ iconTheme: "material" }));
      window.dispatchEvent(new StorageEvent("storage", { key: SETTINGS_KEY }));
      expect(fresh.useActiveIconTheme.getState().id).toBe("material");
    } finally {
      stop();
    }
  });

  it("persists the choice and re-renders mounted icons", () => {
    // applyVisual otherwise asks matchMedia, which jsdom lacks, for the system scheme.
    document.documentElement.dataset.theme = "dark";
    const { container } = render(<Icons.refresh size={14} />);
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 16 16");
    act(() => useTermStore.getState().setIconTheme("material"));
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).iconTheme).toBe("material");
    expect(useActiveIconTheme.getState().id).toBe("material");
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 -960 960 960");
    expect(svg.getAttribute("fill")).toBe("currentColor");
    expect(svg.hasAttribute("stroke-width")).toBe(false);
    act(() => useTermStore.getState().setIconTheme("fluent"));
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 20 20");
    act(() => useTermStore.getState().setIconTheme("classic"));
    expect(container.querySelector("svg")?.getAttribute("stroke")).toBe("currentColor");
  });

  it("renders a name looked up from data, such as a file type, in the active theme", () => {
    const { icon } = fileIcon("bundle.zip", false);
    expect(icon).toBe("fileArchive");
    const { container } = render(<Icon name={icon} size={13} />);
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("13");
    act(() => setActiveIconTheme("fluent"));
    expect(container.querySelector("svg path")).not.toBeNull();
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 20 20");
  });

  it("uses the solid variant when a fill theme receives fill", () => {
    setActiveIconTheme("material");
    const outline = render(<Icons.folder />).container.innerHTML;
    const solid = render(<Icons.folder fill />).container.innerHTML;
    expect(solid).not.toBe(outline);
  });
});
