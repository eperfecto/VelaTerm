# Icon themes

UI icons are rendered by semantic name through `src/components/Icons.tsx`:
`<Icons.refresh size={14} />` for a fixed icon, `<Icon name={name} />` when the name is data.
The active theme (Settings → Appearance → Icons) picks the drawing; any name a theme omits falls back to Classic.

## Add an icon

1. Append the name to `ICON_NAMES` in `names.ts`. Name the meaning (`gitPush`), not the shape (`upload`).
2. Draw it in `themes/classic.tsx`. TypeScript rejects Classic until every name has a drawing.
3. Optionally map it in other themes: import the SVG with `?raw` and add `name: svgGlyph(raw)`.
   Only imported files are bundled. The parser keeps monochrome `<path>` geometry only; any other markup is
   reported and fails the tests.

## Add a theme

1. Create `themes/<id>.ts` exporting an `IconTheme` with its `viewBox`, `mode` (`stroke` honours `sw`,
   `fill` paints with currentColor) and a partial `icons` map.
2. Register it in `ICON_THEMES` in `registry.ts`. The `iconTheme` setting, its normalization and the
   Settings picker derive from that object.
3. Add the `label` i18n key to `src/i18n/locales/en.ts` and every other locale.
4. Pin the icon package to an exact version and add its licence to `THIRD-PARTY-NOTICES.md`.
