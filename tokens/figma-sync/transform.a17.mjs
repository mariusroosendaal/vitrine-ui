/**
 * Figma → `frontend.config.json` transformer (deterministic, no LLM).
 *
 * The whole brain: a pure transform(export, opts) => { files, report } that reads a
 * Figma export and emits the single config `@area17/a17-tailwind-plugins` (v3.x)
 * consumes — structure / spacing / color / typography. The consuming app builds CSS
 * from it; this repo only produces the config.
 *
 * Conventions it reads from the Figma file:
 *   • a variable's NAME is its path (`color/gray/950`, `layout/columns`)
 *   • `_`/`.`-prefixed names are private — never emitted (design-time aids)
 *   • `font family/<x>-stack` holds the CSS fallback stack for `<x>`
 *   • text styles are named `<role>/<bp>` (+ `-strong`) → responsive typesets
 *
 * Mapping notes: breakpoint keys are kept as the file defines them, except `2xl`
 * (invalid as a CSS class prefix) → `xxl`. Color tokens keep their Figma names,
 * flattened, collapsing `X/X` → `X` (`color/gray/950` → `gray-950`, `white/white`
 * → `white`).
 *
 * REVIEW on first run (see report.notes): spacing (numeric scale → a17 groups),
 * container (defaults to "auto"), dark theme (a17 color is single-value).
 */

// ── CONFIG ──────────────────────────────────────────────────────────────────
const CONFIG = {
  collections: { colorPrimitives: 'color primitives', color: 'color', responsive: 'responsive', typographyPrimitives: 'typography primitives' },
  defaultTheme: 'light',
  breakpoints: ['sm', 'md', 'lg', 'xl', '2xl'],
  // a17 builds CSS class names from breakpoint keys (`.2xl\:grid-line-x`), so a key
  // can't start with a digit — `2xl` is invalid. Alias it to a17's own `xxl`.
  breakpointAlias: { '2xl': 'xxl' },
  // responsive variable LEAF name (last `/` segment) → a17 structure slot. Matched
  // regardless of group nesting, so `breakpoint` or `layout/breakpoint` both work.
  structure: { breakpoint: 'breakpoints', columns: 'columns', gutter: 'gutters.inner', margin: 'gutters.outer' },
  spacingPrefix: 'space',       // `space/N` → spacing.groups['space-N']
  spacingScaler: 4,             // a17 spacing scaler — review per project
  fontFamilyStacks: {},         // last-resort fallback if no `-stack` sibling
  fontWeights: { thin: 100, extralight: 200, light: 300, regular: 400, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 },
};

// ── pure helpers (intentionally local; see header) ────────────────────────────
const lc = (s) => (s || '').toLowerCase();
const isPrivate = (n) => /^[._]/.test(n || '');
const bpKey = (n) => CONFIG.breakpointAlias[n] || n; // Figma mode name → a17-safe breakpoint key
// flatten a color variable name to its a17 token key, collapsing `X/X` → `X`
// (`white/white` → `white`, `black/black` → `black`; `gray/950` → `gray-950`)
const flatColorName = (name) => {
  const segs = name.split('/').map((s) => s.trim());
  if (segs.length === 2 && lc(segs[0]) === lc(segs[1])) return segs[0];
  return segs.join('-');
};
const hex = (n) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, '0');
const colorToHex = ({ r, g, b, a = 1 }) => `#${hex(r)}${hex(g)}${hex(b)}${a >= 1 ? '' : hex(a)}`;
const weightNum = (style) => { const s = lc(style); for (const [k, n] of Object.entries(CONFIG.fontWeights)) if (s.includes(k)) return n; return 400; };

function letterSpacingEm(ls) {
  if (!ls) return '0';
  if (ls.unit === 'PIXELS') return `${ls.value}px`;
  const em = ls.unit === 'PERCENT' ? ls.value / 100 : ls.value;
  return Math.abs(em) < 1e-9 ? '0' : `${parseFloat(em.toFixed(4))}em`;
}
function lineHeightRatio(lh, fontSizePx) {
  if (!lh || lh.unit === 'AUTO') return 1;
  if (lh.unit === 'PERCENT') return parseFloat((lh.value / 100).toFixed(4));
  if (lh.unit === 'PIXELS' && fontSizePx) return parseFloat((lh.value / fontSizePx).toFixed(4));
  return parseFloat(Number(lh.value).toFixed(4));
}
// one CSS font name → safe value (double-quote names with an apostrophe)
function cssFontFamily(face) {
  if (typeof face !== 'string' || !(face = face.trim())) return face;
  if (/^-?[A-Za-z][\w-]*$/.test(face)) return face;
  return face.includes("'") ? `"${face.replace(/"/g, '\\"')}"` : `'${face}'`;
}
// a full stack → valid CSS, fixing only mis-quoted (apostrophe-in-single-quotes) names
function normalizeFontStack(value) {
  if (typeof value !== 'string') return value;
  return value.split(',').map((part) => {
    const seg = part.trim(); const q = seg[0];
    if ((q === "'" || q === '"') && seg.length >= 2 && seg[seg.length - 1] === q) {
      const inner = seg.slice(1, -1);
      return inner.includes(q) ? cssFontFamily(inner) : seg;
    }
    return cssFontFamily(seg);
  }).join(', ');
}

const setDeep = (obj, dotted, value) => {
  const parts = dotted.split('.'); let node = obj;
  for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]] ||= {};
  node[parts.at(-1)] = value;
};

// ── main ──────────────────────────────────────────────────────────────────────
export function transform(fig, opts = {}) {
  const warnings = [];
  const warn = (m) => { warnings.push(m); opts.onWarn?.(m); };
  const collections = fig.collections || [];
  const byId = new Map();   // varId → { v, col }
  const byName = (name) => collections.find((c) => lc(c.name) === lc(name));
  for (const col of collections) for (const v of col.variables || []) byId.set(v.id, { v, col });

  const BPS = CONFIG.breakpoints;

  // resolve a raw value to a literal, following aliases to their terminal value
  const resolveLiteral = (raw, guard = 0) => {
    if (!raw || guard > 12) return undefined;
    if (raw.type === 'ALIAS') { const e = byId.get(raw.id); return e ? resolveLiteral(e.v.valuesByMode?.[e.col.defaultModeId], guard + 1) : undefined; }
    if (raw.type === 'FLOAT') return raw.value;
    if (raw.type === 'COLOR') return colorToHex(raw);
    if (raw.type === 'STRING') return raw.value;
    return undefined;
  };
  // a color-primitive variable's flattened a17 token name: `gray/950` → `gray-950`
  const colorTokenName = (id) => { const e = byId.get(id); return e ? flatColorName(e.v.name) : null; };
  // follow a text style's bound family var to its `font family/<x>` primitive → `<x>`
  const familyName = (id, guard = 0) => {
    const e = byId.get(id); if (!e || guard > 12) return null;
    const m = e.v.name.match(/^font family\/(.+)$/i);
    if (m && lc(e.col.name) === CONFIG.collections.typographyPrimitives) return m[1].trim();
    const x = e.v.valuesByMode?.[e.col.defaultModeId];
    return e.col.modes.length === 1 && x?.type === 'ALIAS' ? familyName(x.id, guard + 1) : null;
  };
  // { modeName: fmt(value) } across a collection's modes, skipping private modes
  const perMode = (col, v, fmt) => {
    const out = {};
    for (const m of col.modes || []) {
      if (isPrivate(lc(m.name))) continue;
      const val = resolveLiteral(v.valuesByMode?.[m.modeId]);
      if (val !== undefined) out[bpKey(lc(m.name))] = fmt(val);
    }
    return out;
  };

  // ── structure + spacing (from the responsive collection) ───────────────────
  const structure = { breakpoints: {}, columns: {}, container: Object.fromEntries(BPS.map((bp) => [bpKey(bp), 'auto'])), gutters: { inner: {}, outer: {} } };
  const spacing = { tokens: { scaler: CONFIG.spacingScaler }, groups: {} };
  const resp = byName(CONFIG.collections.responsive);
  for (const v of resp?.variables || []) {
    const segs = v.name.split('/').map((s) => s.trim());
    if (segs.some((s) => isPrivate(lc(s)))) continue; // private at any level
    const slot = CONFIG.structure[lc(segs.at(-1))]; // match by leaf name, any group
    const si = segs.findIndex((s) => lc(s) === CONFIG.spacingPrefix);
    if (slot === 'breakpoints') setDeep(structure, 'breakpoints', perMode(resp, v, (n) => (n === 0 ? '0' : `${n}px`)));
    else if (slot === 'columns') setDeep(structure, 'columns', perMode(resp, v, String));
    else if (slot) setDeep(structure, slot, perMode(resp, v, (n) => `${n}px`)); // gutters.inner/outer
    else if (si >= 0 && segs.length > si + 1) {
      spacing.groups[`${CONFIG.spacingPrefix}-${segs.slice(si + 1).join('-')}`] = perMode(resp, v, (n) => n);
    }
  }
  if (!Object.keys(structure.breakpoints).length) warn('a17: no `breakpoint` variable found in the responsive collection');

  // ── color ───────────────────────────────────────────────────────────────────
  const color = { tokens: {}, border: {}, text: {}, background: {} };
  const cp = byName(CONFIG.collections.colorPrimitives);
  for (const v of cp?.variables || []) {
    if (isPrivate(v.name.split('/')[0])) continue;
    const val = resolveLiteral(v.valuesByMode?.[cp.defaultModeId]);
    if (val !== undefined) color.tokens[flatColorName(v.name)] = val;
  }
  const sem = byName(CONFIG.collections.color);
  const themeMode = (sem?.modes || []).find((m) => lc(m.name) === CONFIG.defaultTheme) || sem?.modes?.[0];
  for (const v of sem?.variables || []) {
    const [group, ...rest] = v.name.split('/').map((s) => s.trim());
    if (isPrivate(group) || !color[group]) continue; // only border/text/background
    const raw = v.valuesByMode?.[themeMode?.modeId];
    const name = raw?.type === 'ALIAS' ? colorTokenName(raw.id) : raw?.type === 'COLOR' ? colorToHex(raw) : undefined;
    if (name) color[group][rest.join('-')] = name; // dark overrides not represented (see header)
  }

  // ── typography: families + typesets ─────────────────────────────────────────
  const families = {};
  const tp = byName(CONFIG.collections.typographyPrimitives);
  const stacks = {};
  for (const v of tp?.variables || []) { const m = v.name.match(/^font family\/(.+)-stack$/i); if (m) { const raw = v.valuesByMode?.[tp.defaultModeId]; if (raw?.type === 'STRING') stacks[m[1].trim()] = raw.value; } }
  for (const v of tp?.variables || []) {
    const m = v.name.match(/^font family\/(.+)$/i);
    if (!m || /-stack$/i.test(m[1])) continue;
    const name = m[1].trim();
    const own = v.valuesByMode?.[tp.defaultModeId];
    const stack = stacks[name] || CONFIG.fontFamilyStacks[own?.value] || (own?.type === 'STRING' ? own.value : undefined);
    if (stack) families[name] = normalizeFontStack(stack);
  }

  const bpAlt = BPS.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const rangeRe = new RegExp(`^(${bpAlt})(-(${bpAlt}))?$`);
  const bpsOfRange = (key) => { const k = key.replace(/-strong$/i, '').replace(/[–—]/g, '-'); const [a, b] = k.split('-'); const i = BPS.indexOf(a); const j = b ? BPS.indexOf(b) : i; return i < 0 || j < 0 ? [] : BPS.slice(i, j + 1); };

  const typesets = {};
  const unparsed = [];
  for (const style of fig.textStyles || []) {
    const segs = style.name.split('/').map((s) => s.trim());
    let tail = segs.at(-1);
    const strong = /[-–—]strong$/i.test(tail);
    if (strong) tail = tail.replace(/[-–—]strong$/i, '');
    if (!rangeRe.test(tail.replace(/[–—]/g, '-'))) { warn(`a17: text style "${style.name}" trailing segment "${tail}" is not a breakpoint/range; skipped`); unparsed.push(style.name); continue; }
    const role = segs.slice(0, -1).join('-');
    if (!role) { unparsed.push(style.name); continue; }
    const fam = familyName(style.boundVariables?.fontFamily);
    const comp = {
      'font-family': fam ? `var(--font-${fam})` : style.fontName?.family,
      'font-weight': String(weightNum(style.fontName?.style)),
      'font-size': `${style.fontSize}px`,
      'line-height': String(lineHeightRatio(style.lineHeight, style.fontSize)),
      'letter-spacing': letterSpacingEm(style.letterSpacing),
    };
    const node = (typesets[role] ||= { _base: {}, _bold: {} });
    for (const bp of bpsOfRange(tail)) (strong ? (node._bold[bp] = comp['font-weight']) : (node._base[bp] = comp));
  }
  // collapse each role to a17's "base bp full + only-changed at higher bps"
  for (const [role, node] of Object.entries(typesets)) {
    const present = BPS.filter((bp) => node._base[bp]);
    if (!present.length) { delete typesets[role]; continue; }
    const ts = {}; let prev = {};
    for (const bp of present) {
      const comp = { ...node._base[bp] };
      if (bp === present[0] && node._bold[bp]) comp['bold-weight'] = node._bold[bp];
      const diff = Object.fromEntries(Object.entries(comp).filter(([p, val]) => val !== prev[p]));
      if (Object.keys(diff).length) ts[bpKey(bp)] = diff;
      prev = { ...prev, ...comp };
    }
    typesets[role] = ts;
  }

  // ── reconcile with the existing config ──────────────────────────────────────
  // Figma is authoritative ONLY for what it actually defines: structure
  // breakpoints/columns/gutters, spacing, color, and typography. It has no source
  // for `structure.container`, `ratios`, or any app-added keys — so carry those
  // forward from the current config instead of zeroing them on every sync. Only
  // Figma-owned values are ever rewritten; un-owned fields are a no-op.
  const prev = opts.existing?.['frontend.config.json'] || {};
  const preserved = [];
  if (prev.structure?.container) { structure.container = prev.structure.container; preserved.push('structure.container'); }
  for (const [k, v] of Object.entries(prev.structure || {})) if (!(k in structure)) { structure[k] = v; preserved.push(`structure.${k}`); }
  if (prev.ratios && Object.keys(prev.ratios).length) preserved.push('ratios');
  const ownedTop = new Set(['structure', 'ratios', 'spacing', 'color', 'typography']);
  for (const k of Object.keys(prev)) if (!ownedTop.has(k)) preserved.push(k);

  const config = {
    ...prev,                            // carry forward any app-added top-level keys
    structure,
    ratios: prev.ratios ?? {},          // no Figma source — preserve
    spacing,
    color,
    typography: { families, typesets },
  };
  const report = {
    breakpoints: Object.keys(structure.breakpoints),
    colorTokens: Object.keys(color.tokens).length,
    typesets: Object.keys(typesets).length,
    unparsed,
    preserved,                          // un-owned fields carried over from the existing config
    notes: [
      'spacing groups derived from the numeric space.* scale — confirm against the app',
      prev.structure?.container ? 'structure.container carried over from the existing config (no Figma source)' : 'structure.container defaults to "auto" — wire to a real token if defined',
      'dark-theme color overrides are not represented in frontend.config.json',
    ],
    warnings,
  };
  return { files: { 'frontend.config.json': config }, report };
}

export const TOKEN_FILES = ['frontend.config.json'];
