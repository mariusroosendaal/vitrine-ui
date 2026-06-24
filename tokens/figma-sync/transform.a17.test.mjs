/**
 * Offline proof of the A17 reshape transformer. No Figma, no network.
 *   node tokens/figma-sync/transform.a17.test.mjs
 *
 * Feeds a small but valid Figma export through transform.a17 (which runs the W3C
 * transform internally) and asserts the frontend.config.json shape: structure from
 * the responsive layout vars, flattened color tokens + semantic refs, font families,
 * and a responsive typeset (incl. bold-weight from a `-strong` text style).
 */
import { transform } from './transform.a17.mjs';
import assert from 'node:assert/strict';

const color = (r, g, b, a = 1) => ({ type: 'COLOR', r, g, b, a });
const alias = (id) => ({ type: 'ALIAS', id });
const float = (v) => ({ type: 'FLOAT', value: v });
const str = (v) => ({ type: 'STRING', value: v });
const lh = (v) => ({ unit: 'PERCENT', value: v });
const ls = (v) => ({ unit: 'PERCENT', value: v });
const ONE = [{ modeId: 'm', name: 'Mode 1' }];
const BPM = ['sm', 'md', 'lg', 'xl', '2xl'].map((n) => ({ modeId: n, name: n }));

const text = (name, weight, fontSize, sizeId) => ({
  name, fontName: { family: 'Suisse', style: weight }, fontSize, lineHeight: lh(150), letterSpacing: ls(0),
  textCase: 'ORIGINAL', boundVariables: { fontSize: sizeId, fontFamily: 'bodyFam' },
});

const fig = {
  collections: [
    { name: 'color primitives', defaultModeId: 'm', modes: ONE, variables: [
      { id: 'white', name: 'white/white', resolvedType: 'COLOR', valuesByMode: { m: color(1, 1, 1, 1) } },
      { id: 'gray950', name: 'gray/950', resolvedType: 'COLOR', valuesByMode: { m: color(0.04, 0.09, 0.16, 1) } },
      { id: 'blue500', name: 'blue/500', resolvedType: 'COLOR', valuesByMode: { m: color(0.1, 0.42, 0.9, 1) } },
    ] },
    { name: 'size primitives', defaultModeId: 'm', modes: ONE, variables: [
      { id: 's12', name: 'size/12', resolvedType: 'FLOAT', valuesByMode: { m: float(12) } },
      { id: 's16', name: 'size/16', resolvedType: 'FLOAT', valuesByMode: { m: float(16) } },
    ] },
    { name: 'typography primitives', defaultModeId: 'm', modes: ONE, variables: [
      { id: 'famSans', name: 'font family/sans', resolvedType: 'STRING', valuesByMode: { m: str('Suisse') } },
      { id: 'famSansStack', name: 'font family/sans-stack', resolvedType: 'STRING', valuesByMode: { m: str("'Suisse', system-ui, sans-serif") } },
      { id: 'fs16', name: 'font size/16', resolvedType: 'FLOAT', valuesByMode: { m: float(16) } },
      { id: 'fs18', name: 'font size/18', resolvedType: 'FLOAT', valuesByMode: { m: float(18) } },
      { id: 'fs20', name: 'font size/20', resolvedType: 'FLOAT', valuesByMode: { m: float(20) } },
    ] },
    { name: 'color', defaultModeId: 'light', modes: [{ modeId: 'light', name: 'light' }, { modeId: 'dark', name: 'dark' }], variables: [
      { id: 'bgDefault', name: 'background/default', resolvedType: 'COLOR', valuesByMode: { light: alias('white'), dark: alias('gray950') } },
      { id: 'txtPrimary', name: 'text/primary', resolvedType: 'COLOR', valuesByMode: { light: alias('gray950'), dark: alias('white') } },
      { id: 'borderInteractive', name: 'border/interactive', resolvedType: 'COLOR', valuesByMode: { light: alias('blue500'), dark: alias('blue500') } },
    ] },
    { name: 'responsive', defaultModeId: 'sm', modes: BPM, variables: [
      { id: 'bp', name: 'layout/breakpoint', resolvedType: 'FLOAT', valuesByMode: { sm: float(0), md: float(600), lg: float(900), xl: float(1200), '2xl': float(1500) } },
      { id: 'cols', name: 'layout/columns', resolvedType: 'FLOAT', valuesByMode: { sm: float(12), md: float(12), lg: float(12), xl: float(12), '2xl': float(12) } },
      { id: 'gutter', name: 'layout/gutter', resolvedType: 'FLOAT', valuesByMode: { sm: float(16), md: float(24), lg: float(24), xl: float(24), '2xl': float(32) } },
      { id: 'margin', name: 'layout/margin', resolvedType: 'FLOAT', valuesByMode: { sm: float(16), md: float(24), lg: float(24), xl: float(24), '2xl': float(32) } },
      { id: 'space4', name: 'space/4', resolvedType: 'FLOAT', valuesByMode: { sm: alias('s12'), md: alias('s12'), lg: alias('s16'), xl: alias('s16'), '2xl': alias('s16') } },
    ] },
    { name: 'typography', defaultModeId: 'm', modes: ONE, variables: [
      { id: 'bodyFam', name: 'body/family', resolvedType: 'STRING', valuesByMode: { m: alias('famSans') } },
    ] },
  ],
  textStyles: [
    text('body/1/sm-md', 'Regular', 16, 'fs16'),
    text('body/1/lg-xl', 'Regular', 18, 'fs18'),
    text('body/1/2xl', 'Regular', 20, 'fs20'),
    text('body/1/sm-md-strong', 'Bold', 16, 'fs16'),
  ],
  effectStyles: [],
};

const warnings = [];
const { files, report } = transform(fig, { onWarn: (m) => warnings.push(m) });
const c = files['frontend.config.json'];
assert.deepEqual(Object.keys(files), ['frontend.config.json'], 'single-file output');

// ── structure ──
assert.equal(c.structure.breakpoints.sm, '0', 'base breakpoint is "0" not "0px"');
assert.equal(c.structure.breakpoints.md, '600px');
assert.equal(c.structure.breakpoints.xxl, '1500px', '2xl aliased to a17-safe `xxl`');
assert.ok(!('2xl' in c.structure.breakpoints), 'no leading-digit `2xl` key (invalid CSS class)');
assert.equal(c.structure.columns.sm, '12', 'columns stringified per bp');
assert.equal(c.structure.columns.xxl, '12');
assert.equal(c.structure.container.lg, 'auto', 'container defaults to auto');
assert.deepEqual(c.structure.gutters.inner, { sm: '16px', md: '24px', lg: '24px', xl: '24px', xxl: '32px' }, 'inner gutter ← layout/gutter');
assert.deepEqual(c.structure.gutters.outer, { sm: '16px', md: '24px', lg: '24px', xl: '24px', xxl: '32px' }, 'outer gutter ← layout/margin');

// ── spacing (best-effort: numeric scale → groups, refs resolved to px numbers) ──
assert.deepEqual(c.spacing.tokens, { scaler: 4 });
assert.deepEqual(c.spacing.groups['space-4'], { sm: 12, md: 12, lg: 16, xl: 16, xxl: 16 }, 'space/4 resolved {size.*}→px numbers');

// ── color: flattened tokens (X/X collapses to X) + semantic refs to token names ──
assert.equal(c.color.tokens['white'], '#ffffff', 'white/white collapses to `white`');
assert.ok(!('white-white' in c.color.tokens), 'no redundant white-white');
assert.equal(c.color.tokens['gray-950'], '#0a1729');
assert.equal(c.color.tokens['blue-500'], '#1a6be6');
assert.equal(c.color.background.default, 'white', 'semantic ref → collapsed token name (light)');
assert.equal(c.color.text.primary, 'gray-950');
assert.equal(c.color.border.interactive, 'blue-500');
assert.ok(!/\{[a-zA-Z]/.test(JSON.stringify(c.color)), 'no unresolved {refs} in color');

// ── typography: families + a responsive typeset with bold-weight ──
assert.equal(c.typography.families.sans, "'Suisse', system-ui, sans-serif", 'family stack from -stack variable');
const body = c.typography.typesets['body-1'];
assert.deepEqual(Object.keys(body), ['sm', 'lg', 'xxl'], 'base bp full, then only changed bps (md==sm, xl==lg dropped; 2xl→xxl)');
assert.equal(body.sm['font-family'], 'var(--font-sans)', 'family → var(--font-sans)');
assert.equal(body.sm['font-weight'], '400');
assert.equal(body.sm['bold-weight'], '700', 'bold-weight from the -strong text style');
assert.equal(body.sm['font-size'], '16px', '{fontSize.16} resolved to literal px');
assert.equal(body.sm['line-height'], '1.5');
assert.deepEqual(body.lg, { 'font-size': '18px' }, 'higher bp carries only the changed prop');
assert.deepEqual(body.xxl, { 'font-size': '20px' });

// ── report ──
assert.equal(report.typesets, 1);
assert.ok(report.colorTokens >= 3);
assert.equal(warnings.length, 0, `no warnings; got ${JSON.stringify(warnings)}`);

// ── reconcile: un-owned fields carry forward from the existing config ──
// Figma owns structure.breakpoints/columns/gutters, spacing, color, typography;
// it has no source for structure.container, ratios, or app-added keys, so a sync
// must preserve those rather than zero them.
const existingCfg = {
  structure: { container: { sm: '100%', lg: '1280px' }, customSlot: { sm: 'x' } },
  ratios: { golden: 1.618 },
  appOnly: { keep: true },
  color: { tokens: { 'stale-should-be-overwritten': '#000000' } },
};
const r = transform(fig, { existing: { 'frontend.config.json': existingCfg } });
const c2 = r.files['frontend.config.json'];
assert.deepEqual(c2.structure.container, { sm: '100%', lg: '1280px' }, 'container carried over (no Figma source)');
assert.deepEqual(c2.structure.customSlot, { sm: 'x' }, 'app-added structure sub-key preserved');
assert.deepEqual(c2.ratios, { golden: 1.618 }, 'ratios preserved (no Figma source)');
assert.deepEqual(c2.appOnly, { keep: true }, 'app-added top-level key preserved');
assert.equal(c2.structure.breakpoints.md, '600px', 'Figma-owned structure still rebuilt');
assert.ok(!('stale-should-be-overwritten' in c2.color.tokens), 'Figma-owned color fully replaces existing');
assert.equal(c2.color.tokens['gray-950'], '#0a1729', 'Figma-owned color rebuilt from export');
assert.ok(r.report.preserved.includes('ratios') && r.report.preserved.includes('structure.container') && r.report.preserved.includes('appOnly'), 'report lists preserved fields');

// default (no existing): container falls back to "auto", ratios empty
assert.equal(c.structure.container.lg, 'auto', 'container defaults to auto when no existing');
assert.deepEqual(c.ratios, {}, 'ratios empty when no existing');

console.log('✓ transform.a17.test.mjs — all assertions passed');
console.log(`  ${report.colorTokens} color tokens · ${report.typesets} typeset · breakpoints ${report.breakpoints.join('/')}`);
