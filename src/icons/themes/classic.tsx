//! Hand-drawn 16 px outline set, the fallback for every other theme. Names that were split out of one shared
//! icon reuse that drawing here, so Classic looks as it did before the split.

import React from "react";
import type { CompleteIconTheme, IconGlyph } from "../types";

const r = React.createElement;
const g = (node: React.ReactNode): IconGlyph => ({ node });

const projectMarker = r("rect", { key: 4, x: 10, y: 9, width: 5, height: 5, rx: 1, stroke: "var(--blue)" });
const fileOutline = [
  r("path", { key: 1, d: "M4 2.5h5L12 5.5V13a.5.5 0 01-.5.5h-7A.5.5 0 014 13z" }),
  r("path", { key: 2, d: "M8.8 2.6V5.5H11.7" }),
];
const folderOutline = r("path", { key: 1, d: "M2 5.5A1.5 1.5 0 013.5 4h2.8l1.2 1.4h5A1.5 1.5 0 0114 6.9V11A1.5 1.5 0 0112.5 12.5h-9A1.5 1.5 0 012 11z" });
const bellOutline = [
  r("path", { key: 1, d: "M12.5 11H3.5c1-1 1.3-2 1.3-3.5v-1A3.2 3.2 0 018 3.3a3.2 3.2 0 013.2 3.2v1c0 1.5.3 2.5 1.3 3.5z" }),
  r("path", { key: 2, d: "M6.8 13a1.3 1.3 0 002.4 0" }),
];
const eyeOutline = [
  r("path", { key: 1, d: "M1.7 8S4.2 3.8 8 3.8 14.3 8 14.3 8 11.8 12.2 8 12.2 1.7 8 1.7 8z" }),
  r("circle", { key: 2, cx: 8, cy: 8, r: 1.9 }),
];
const panelOutline = r("rect", { key: 1, x: 2.5, y: 3, width: 11, height: 10, rx: 1.5 });

const cross = g(r("path", { key: 1, d: "M4 4l8 8M12 4l-8 8" }));
const smallCross = g(r("path", { key: 1, d: "M4.5 4.5l7 7M11.5 4.5l-7 7" }));
const circularArrow = g([r("path", { key: 1, d: "M12.5 8a4.5 4.5 0 10-1.3 3.2" }), r("path", { key: 2, d: "M12.5 4.5V8H9" })]);
const trayBase = r("path", { key: 2, d: "M3 11.2v1.3a1 1 0 001 1h8a1 1 0 001-1v-1.3" });
const trayDown = g([r("path", { key: 1, d: "M8 2.5V10M4.8 7.2L8 10.4l3.2-3.2" }), trayBase]);
// Mirror of the download tray: same tray, arrow pointing up and out.
const trayUp = g([r("path", { key: 1, d: "M8 10.4V2.9M4.8 6.1L8 2.9l3.2 3.2" }), trayBase]);
const sparkle = g(r("path", { key: 1, d: "M8 2.6Q8.8 6.2 13.4 8Q8.8 9.8 8 13.4Q7.2 9.8 2.6 8Q7.2 6.2 8 2.6z" }));
const layers = g([r("path", { key: 1, d: "M8 2.5l5.5 2.9L8 8.3 2.5 5.4z" }), r("path", { key: 2, d: "M2.5 8.6L8 11.5l5.5-2.9" })]);
const globe = g([
  r("circle", { key: 1, cx: 8, cy: 8, r: 5.5 }),
  r("path", { key: 2, d: "M2.5 8h11M8 2.5c1.6 1.5 2.5 3.4 2.5 5.5S9.6 12.5 8 13.5C6.4 12 5.5 10.1 5.5 8S6.4 3.5 8 2.5z" }),
]);
const plug = g([r("path", { key: 1, d: "M2 8h5.5" }), r("path", { key: 2, d: "M5.5 5.5L8 8 5.5 10.5" }), r("rect", { key: 3, x: 10, y: 3, width: 4, height: 10, rx: 1 })]);
const box = g([
  r("rect", { key: 1, x: 2.5, y: 3, width: 11, height: 2.6, rx: 0.6 }),
  r("path", { key: 2, d: "M3.6 5.6h8.8V12a1 1 0 01-1 1H4.6a1 1 0 01-1-1z" }),
  r("path", { key: 3, d: "M6.5 8h3" }),
]);
const angleBrackets = g(r("path", { key: 1, d: "M6 4.5L2.5 8 6 11.5M10 4.5L13.5 8 10 11.5" }));
const gitNodes = g([
  r("circle", { key: 1, cx: 4.5, cy: 4, r: 1.6 }),
  r("circle", { key: 2, cx: 4.5, cy: 12, r: 1.6 }),
  r("circle", { key: 3, cx: 11.5, cy: 6.5, r: 1.6 }),
  r("path", { key: 4, d: "M4.5 5.6v4.8M4.5 8h3.4A2 2 0 009.9 6.1" }),
]);
const sliders = g([r("path", { key: 1, d: "M3 5h7M3 11h3" }), r("circle", { key: 2, cx: 12, cy: 5, r: 1.6 }), r("circle", { key: 3, cx: 8, cy: 11, r: 1.6 })]);
const docLines = g([...fileOutline, r("path", { key: 3, d: "M5.8 8.4h4.4M5.8 10.4h3" })]);
const arrowRight = g(r("path", { key: 1, d: "M3 8h9.5M8.5 4l4 4-4 4" }));
const monitor = g([r("rect", { key: 1, x: 2.5, y: 3, width: 11, height: 8, rx: 1.5 }), r("path", { key: 2, d: "M6 13.5h4M8 11v2.5" })]);

export const classicTheme: CompleteIconTheme = {
  id: "classic",
  label: "settings.iconThemeClassic",
  viewBox: "0 0 16 16",
  mode: "stroke",
  icons: {
    chevronRight: g(r("path", { key: 1, d: "M6 4l4 4-4 4" })),
    chevronDown: g(r("path", { key: 1, d: "M4 6l4 4 4-4" })),
    arrowLeft: g(r("path", { key: 1, d: "M13 8H3.5M7.5 4L3.5 8l4 4" })),
    arrowRight,
    arrowUp: g(r("path", { key: 1, d: "M8 13V3.5M4 7.5l4-4 4 4" })),
    home: g([r("path", { key: 1, d: "M2.5 7.6L8 3.2l5.5 4.4" }), r("path", { key: 2, d: "M4 7v5.3a.5.5 0 00.5.5h7a.5.5 0 00.5-.5V7" })]),
    menu: g(r("path", { key: 1, d: "M3 4h10M3 8h10M3 12h10" })),
    more: g([
      r("circle", { key: 1, cx: 3, cy: 8, r: 1, fill: "currentColor", stroke: "none" }),
      r("circle", { key: 2, cx: 8, cy: 8, r: 1, fill: "currentColor", stroke: "none" }),
      r("circle", { key: 3, cx: 13, cy: 8, r: 1, fill: "currentColor", stroke: "none" }),
    ]),
    collapse: g(r("path", { key: 1, d: "M5.5 3.5L8 6l2.5-2.5M5.5 12.5L8 10l2.5 2.5M3.5 8h9" })),
    expand: g(r("path", { key: 1, d: "M8 2.5L5.5 5h5zM8 13.5L5.5 11h5zM3.5 8h9" })),
    panelRightClosed: g([panelOutline, r("path", { key: 2, d: "M10 3v10" })]),
    panelRightOpen: g([panelOutline, r("path", { key: 2, d: "M10 3v10" }), r("rect", { key: 3, x: 10.5, y: 3.75, width: 2.25, height: 8.5, rx: 0.5, fill: "currentColor", stroke: "none" })]),
    panelLeftClosed: g([panelOutline, r("path", { key: 2, d: "M6 3v10" })]),
    panelLeftOpen: g([panelOutline, r("path", { key: 2, d: "M6 3v10" }), r("rect", { key: 3, x: 3.25, y: 3.75, width: 2.25, height: 8.5, rx: 0.5, fill: "currentColor", stroke: "none" })]),
    splitV: g([r("rect", { key: 1, x: 2.5, y: 2.5, width: 11, height: 11, rx: 1.5 }), r("path", { key: 2, d: "M8 2.5v11" })]),
    splitH: g([r("rect", { key: 1, x: 2.5, y: 2.5, width: 11, height: 11, rx: 1.5 }), r("path", { key: 2, d: "M2.5 8h11" })]),

    plus: g(r("path", { key: 1, d: "M8 3.5v9M3.5 8h9" })),
    minus: g(r("path", { key: 1, d: "M3.5 8h9" })),
    check: g(r("path", { key: 1, d: "M3.5 8.5l3 3 6-7" })),
    close: cross,
    clear: cross,
    cancel: cross,
    remove: smallCross,
    failed: cross,
    search: g([r("circle", { key: 1, cx: 7, cy: 7, r: 4 }), r("path", { key: 2, d: "M10 10l3 3" })]),
    filter: sliders,
    sliders,
    copy: g([r("rect", { key: 1, x: 5.5, y: 5.5, width: 7.5, height: 7.5, rx: 1.5 }), r("path", { key: 2, d: "M3 10.2V4.2A1.2 1.2 0 014.2 3H10" })]),
    rename: g([r("path", { key: 1, d: "M3 11.5l6.4-6.4 2 2L5 13.5H3z" }), r("path", { key: 2, d: "M9.4 5.1l1.5-1.5a1 1 0 011.4 0l.6.6a1 1 0 010 1.4l-1.5 1.5" })]),
    trash: g(r("path", { key: 1, d: "M3.5 4.5h9M6 4.5V3.2A.7.7 0 016.7 2.5h2.6a.7.7 0 01.7.7V4.5M5 4.5l.5 8h5l.5-8" })),
    undo: g(r("path", { key: 1, d: "M5.5 3.8L3 6.3l2.5 2.5M3 6.3h6.5a3.2 3.2 0 010 6.4H7" })),
    send: arrowRight,
    save: trayDown,
    share: g([
      r("circle", { key: 1, cx: 11.5, cy: 4, r: 1.9 }),
      r("circle", { key: 2, cx: 4.5, cy: 8, r: 1.9 }),
      r("circle", { key: 3, cx: 11.5, cy: 12, r: 1.9 }),
      r("path", { key: 4, d: "M6.15 7.05l3.7-2.1M6.15 8.95l3.7 2.1" }),
    ]),
    external: g([r("path", { key: 1, d: "M6.5 3.5H4A1.5 1.5 0 002.5 5v7A1.5 1.5 0 004 13.5h7A1.5 1.5 0 0012.5 12V9.5" }), r("path", { key: 2, d: "M9.5 2.5h4v4M13.2 2.8L8 8" })]),
    refresh: circularArrow,
    loading: circularArrow,
    retry: circularArrow,
    stop: g(r("rect", { key: 1, x: 4.5, y: 4.5, width: 7, height: 7, rx: 1 })),

    // The project window keeps a blue type marker independent of the interaction accent.
    project: g([
      r("path", { key: 1, d: "M8 13.5H4.5a2 2 0 01-2-2v-7a2 2 0 012-2h7a2 2 0 012 2v3" }),
      r("path", { key: 2, d: "M2.5 6h11" }),
      r("circle", { key: 3, cx: 4.6, cy: 4.3, r: 0.4, fill: "currentColor", stroke: "none" }),
      projectMarker,
    ]),
    projectPlus: g([r("path", { key: 1, d: "M8 13.5H3.5A1.5 1.5 0 012 12V4A1.5 1.5 0 013.5 2.5h2.8l1.2 1.8h5A1.5 1.5 0 0114 5.8V7" }), r("path", { key: 2, d: "M6.5 7v3M5 8.5h3" }), projectMarker]),
    projectOpen: g([r("path", { key: 1, d: "M2 4A1.5 1.5 0 013.5 2.5h2.8l1.2 1.8h5A1.5 1.5 0 0114 5.8" }), r("path", { key: 2, d: "M8 13.5H3.5a1 1 0 01-1-.74L2.2 6.3h11.3" }), projectMarker]),
    // Collection: three stacked layers distinguish containers from projects and groups.
    collection: g([r("path", { key: 1, d: "M8 2.1l5.5 2.9L8 7.9 2.5 5z" }), r("path", { key: 2, d: "M2.5 8.2L8 11.1l5.5-2.9" }), r("path", { key: 3, d: "M2.5 11.4L8 14.3l5.5-2.9" })]),
    newGroup: g([r("path", { key: 1, d: "M2 5.5A1.5 1.5 0 013.5 4h2.8l1.2 1.4h5A1.5 1.5 0 0114 6.9V8" }), r("path", { key: 2, d: "M11.5 10v4M9.5 12h4" })]),
    folder: g(folderOutline),
    folderOpen: g([r("path", { key: 1, d: "M2 5.5A1.5 1.5 0 013.5 4h2.8l1.2 1.4h5A1.5 1.5 0 0114 6.9" }), r("path", { key: 2, d: "M2.2 7h11.3l-1.2 4.6a1 1 0 01-1 .9H3.5a1 1 0 01-1-.74z" })]),
    folderPlus: g([folderOutline, r("path", { key: 2, d: "M8 7.3v3.4M6.3 9h3.4" })]),
    reveal: g(folderOutline),
    // Disk or file-system root in the folder picker.
    drive: g([
      r("rect", { key: 1, x: 2, y: 5, width: 12, height: 6.5, rx: 1.3 }),
      r("path", { key: 2, d: "M4.5 8.3h4" }),
      r("circle", { key: 3, cx: 11.5, cy: 8.3, r: 0.6, fill: "currentColor", stroke: "none" }),
    ]),
    file: g(fileOutline),
    filePlus: g([...fileOutline, r("path", { key: 3, d: "M8 8v3.4M6.3 9.7h3.4" })]),
    fileUpload: trayUp,
    fileDownload: trayDown,
    fileArchive: box,
    openInEditor: angleBrackets,
    terminal: g([r("rect", { key: 1, x: 2, y: 3, width: 12, height: 10, rx: 1.5 }), r("path", { key: 2, d: "M4.8 6.5L6.8 8l-2 1.5M8.5 9.7h2.7" })]),
    terminalRedraw: circularArrow,
    globalTerminal: globe,
    bot: g([r("rect", { key: 1, x: 3, y: 5.5, width: 10, height: 7, rx: 2 }), r("path", { key: 2, d: "M8 3v2.5M5.5 8.6h.01M10.5 8.6h.01" }), r("path", { key: 3, d: "M3 9.2H1.8M14.2 9.2H13" })]),
    gamepad: g([
      r("path", { key: 1, d: "M5 4.5h6a2.5 2.5 0 012.4 1.9l1 4.4a1.5 1.5 0 01-2.5 1.4L9.8 10H6.2l-2.1 2.2a1.5 1.5 0 01-2.5-1.4l1-4.4A2.5 2.5 0 015 4.5z" }),
      r("path", { key: 2, d: "M5 6v3M3.5 7.5h3M10 7h.01M12 8.5h.01" }),
    ]),
    // Planning and execution workflow: the plan is handed over to run, distinct from the worktree branch icon.
    planExecute: g([r("path", { key: 1, d: "M2.6 4.2h4.2M2.6 7.4h4.2M2.6 10.6h2.6" }), r("path", { key: 2, d: "M8.4 7.4h2.2" }), r("path", { key: 3, d: "M11.4 4.8l3 2.6-3 2.6z" })]),
    plan: docLines,
    tasks: layers,
    workflow: layers,
    backgroundStatus: layers,
    runInBackground: trayDown,

    sessionImport: circularArrow,
    sessionResume: circularArrow,
    chatRewind: circularArrow,
    autoContinue: circularArrow,
    aiAction: sparkle,
    aiSessionTitle: sparkle,
    aiCommitMessage: sparkle,
    elicitation: plug,
    mcp: plug,

    git: gitNodes,
    gitClone: gitNodes,
    gitPush: trayUp,
    gitPublish: trayUp,
    gitPull: trayDown,
    gitDiscard: circularArrow,
    branch: g([
      r("circle", { key: 1, cx: 4, cy: 4, r: 1.4 }),
      r("circle", { key: 2, cx: 4, cy: 12, r: 1.4 }),
      r("circle", { key: 3, cx: 12, cy: 4, r: 1.4 }),
      r("path", { key: 4, d: "M4 5.4v5.2M12 5.4v1.1A3.5 3.5 0 018.5 10H6" }),
    ]),

    // Generated knowledge entry: a sparkle, so distilled content is not mistaken for a stored file.
    memoryEntry: sparkle,
    memoryGlobal: layers,
    memoryCollections: box,
    notebookImport: trayUp,
    notebookTrash: box,
    archive: box,
    archiveRestore: circularArrow,
    archiveExport: trayDown,

    browserTab: globe,
    browserControl: globe,
    browserReload: circularArrow,
    browserStop: cross,
    openInBrowser: globe,
    compass: g([r("circle", { key: 1, cx: 8, cy: 8, r: 5.5 }), r("path", { key: 2, d: "M10.3 5.7L9 9 5.7 10.3 7 7z" })]),
    webServer: globe,
    ports: plug,
    remoteAccess: globe,
    remoteConnect: plug,
    publicShare: globe,
    // Account entry: a person bust, the standard account glyph, and distinct from the remote-connect arrow.
    account: g([r("circle", { key: 1, cx: 8, cy: 5.4, r: 2.5 }), r("path", { key: 2, d: "M3.6 13.3v-.4a4.4 4.4 0 0 1 4.4-4.4 4.4 4.4 0 0 1 4.4 4.4v.4" })]),

    updateDownload: trayDown,
    updateReady: circularArrow,
    appRestart: circularArrow,
    skillsUpdate: sparkle,
    devTools: angleBrackets,
    gear: g([
      r("circle", { key: 1, cx: 8, cy: 8, r: 4.3 }),
      r("circle", { key: 2, cx: 8, cy: 8, r: 1.7 }),
      r("path", { key: 3, d: "M8 1.6v2.1M8 12.3v2.1M1.6 8h2.1M12.3 8h2.1M3.47 3.47L5 5M11 11l1.53 1.53M12.53 3.47L11 5M5 11l-1.53 1.53" }),
    ]),
    info: g([r("circle", { key: 1, cx: 8, cy: 8, r: 5.5 }), r("path", { key: 2, d: "M8 7.3v3.4M8 5.4h.01" })]),
    warn: g([r("path", { key: 1, d: "M8 2.8l5.6 9.7H2.4z" }), r("path", { key: 2, d: "M8 6.6v2.8M8 11h.01" })]),
    // Feedback: a speech bubble with an exclamation mark, distinct from the plain information icon.
    feedback: g([
      r("path", { key: 1, d: "M4.2 2.5h7.6a1.7 1.7 0 0 1 1.7 1.7v4.6a1.7 1.7 0 0 1-1.7 1.7H7.6l-3 2.6v-2.6h-.4a1.7 1.7 0 0 1-1.7-1.7V4.2a1.7 1.7 0 0 1 1.7-1.7z" }),
      r("path", { key: 2, d: "M8 4.7v2.4" }),
      r("path", { key: 3, d: "M8 8.8h.01" }),
    ]),
    bell: g(bellOutline),
    bellOff: g([...bellOutline, r("path", { key: 3, d: "M3 2.5l10 11" })]),
    clock: g([r("circle", { key: 1, cx: 8, cy: 8, r: 5.2 }), r("path", { key: 2, d: "M8 4.9v3.3l2.3 1.3" })]),
    lock: g([r("rect", { key: 1, x: 3.5, y: 7, width: 9, height: 6, rx: 1.2 }), r("path", { key: 2, d: "M5.5 7V5.3a2.5 2.5 0 015 0V7" })]),
    eye: g(eyeOutline),
    eyeOff: g([...eyeOutline, r("path", { key: 3, d: "M3 3l10 10" })]),
    cpu: g([r("rect", { key: 1, x: 4, y: 4, width: 8, height: 8, rx: 1 }), r("path", { key: 2, d: "M6.5 2.5v1.5M9.5 2.5v1.5M6.5 12v1.5M9.5 12v1.5M2.5 6.5H4M2.5 9.5H4M12 6.5h1.5M12 9.5h1.5" })]),
    monitor,
    sun: g([
      r("circle", { key: 1, cx: 8, cy: 8, r: 3 }),
      r("path", { key: 2, d: "M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" }),
    ]),
    moon: g(r("path", { key: 1, d: "M13 9.5A5.5 5.5 0 016.5 3a5.5 5.5 0 100 11 5.5 5.5 0 006.5-4.5z" })),
    themeSystem: monitor,

    // File-type icons, colored by extension in the right-panel Files tab; see RightPanel/fileIcons.tsx.
    code: angleBrackets,
    braces: g([
      r("path", { key: 1, d: "M6.5 3C5.3 3 5 3.7 5 4.7c0 1.1 0 1.7-1 2.1 1 .4 1 1 1 2.1C5 12 5.3 13 6.5 13" }),
      r("path", { key: 2, d: "M9.5 3c1.2 0 1.5.7 1.5 1.7 0 1.1 0 1.7 1 2.1-1 .4-1 1-1 2.1 0 1-.3 2.1-1.5 2.1" }),
    ]),
    hash: g(r("path", { key: 1, d: "M6 3l-1.3 10M11 3l-1.3 10M3.4 6.3h9.2M2.9 9.7h9.2" })),
    database: g([
      r("ellipse", { key: 1, cx: 8, cy: 4, rx: 4.5, ry: 1.8 }),
      r("path", { key: 2, d: "M3.5 4v8c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8V4" }),
      r("path", { key: 3, d: "M3.5 8c0 1 2 1.8 4.5 1.8s4.5-.8 4.5-1.8" }),
    ]),
    font: g(r("path", { key: 1, d: "M4 12.5l4-9.5 4 9.5M5.4 9.2h5.2" })),
    docLines,
    image: g([r("rect", { key: 1, x: 2.5, y: 3, width: 11, height: 10, rx: 1.5 }), r("circle", { key: 2, cx: 5.8, cy: 6.2, r: 1.1 }), r("path", { key: 3, d: "M2.5 11l3.2-3 2.3 2.2 2.7-2.7 2.8 2.8" })]),
    music: g([r("path", { key: 1, d: "M6 11V3.5l7-1v7.5M6 6l7-1" }), r("ellipse", { key: 2, cx: 4, cy: 11.5, rx: 2, ry: 1.5 }), r("ellipse", { key: 3, cx: 11, cy: 10.5, rx: 2, ry: 1.5 })]),
    video: g([r("rect", { key: 1, x: 2, y: 3.5, width: 8, height: 9, rx: 1.5 }), r("path", { key: 2, d: "M10 6l4-2v8l-4-2" })]),
    spreadsheet: g([r("rect", { key: 1, x: 2.5, y: 2.5, width: 11, height: 11, rx: 1 }), r("path", { key: 2, d: "M2.5 6h11M2.5 9.5h11M6 6v7.5M9.5 6v7.5" })]),
    presentation: g([r("rect", { key: 1, x: 2.5, y: 2.5, width: 11, height: 8, rx: 1 }), r("path", { key: 2, d: "M8 10.5v3M5.5 14L8 12l2.5 2M5 7.5l2-2 2 1 2-2" })]),
    print: g([
      r("path", { key: 1, d: "M5 5V2.5h6V5" }),
      r("rect", { key: 2, x: 2, y: 5, width: 12, height: 5, rx: 1 }),
      r("path", { key: 3, d: "M5 10v3.5h6V10" }),
      r("circle", { key: 4, cx: 11.5, cy: 7.5, r: 0.7, fill: "currentColor", stroke: "none" }),
    ]),
    clipboard: g([r("rect", { key: 1, x: 3.5, y: 3.5, width: 9, height: 10, rx: 1 }), r("rect", { key: 2, x: 5.5, y: 2, width: 5, height: 3, rx: 1 })]),

    // Upright scissors keep the screenshot action distinct from the adjacent share nodes.
    scissors: g([r("circle", { key: 1, cx: 4, cy: 12, r: 2 }), r("circle", { key: 2, cx: 12, cy: 12, r: 2 }), r("path", { key: 3, d: "M5.5 10.5L13 3M10.5 10.5L3 3" })]),
    shotRect: g(r("rect", { key: 1, x: 2.5, y: 3.5, width: 11, height: 9, rx: 0.5 })),
    shotEllipse: g(r("ellipse", { key: 1, cx: 8, cy: 8, rx: 5.8, ry: 4.6 })),
    shotArrow: g(r("path", { key: 1, d: "M3.5 12.5L12 4M7 4h5v5" })),
    shotPen: g(r("path", { key: 1, d: "M10.6 3.2l2.2 2.2-6.9 6.9-3 .8.8-3z" })),
    shotMosaic: g([
      r("rect", { key: 1, x: 2.5, y: 2.5, width: 11, height: 11, rx: 1 }),
      r("path", {
        key: 2,
        d: "M2.5 2.5h3.7v3.7H2.5zM9.8 2.5h3.7v3.7H9.8zM6.2 6.2h3.6v3.6H6.2zM2.5 9.8h3.7v3.7H2.5zM9.8 9.8h3.7v3.7H9.8z",
        fill: "currentColor",
        stroke: "none",
      }),
    ]),
    shotText: g(r("path", { key: 1, d: "M3.5 4h9M8 4v8.5M6.2 12.5h3.6" })),
  },
};
