// Offline proof of the shared diff helpers. Run: node tokens/figma-sync/diff.test.mjs
import assert from 'node:assert/strict';
import { diffTokens, flattenLeaves } from './diff.mjs';

// ── plain config values (frontend.config.json shape: no $value wrapper) ──
const a = { color: { tokens: { black: '#000000', white: '#ffffff' } }, structure: { columns: { sm: '12' } }, ratios: {} };
const b = { color: { tokens: { black: '#111111', gray: '#888888' } }, structure: { columns: { sm: '12' } }, ratios: { golden: 1.618 } };
const changes = diffTokens(a, b);
assert.ok(changes.includes('~ color.tokens.black: "#000000" → "#111111"'), 'detects changed primitive value');
assert.ok(changes.includes('+ color.tokens.gray = "#888888"'), 'detects added value');
assert.ok(changes.includes('- color.tokens.white'), 'detects removed value');
assert.ok(changes.includes('+ ratios.golden = 1.618'), 'added value under a previously-empty object');
assert.ok(changes.includes('- ratios'), 'previously-empty object ({}) was a leaf, gone once populated');
assert.ok(!changes.some((c) => c.includes('structure.columns')), 'unchanged values produce no diff');

// an empty object on its own is a stable leaf (no spurious diff)
assert.deepEqual(diffTokens({ ratios: {} }, { ratios: {} }), [], 'empty object is a stable leaf');

// identical → no changes
assert.deepEqual(diffTokens(a, a), [], 'self-diff is empty');

// ── DTCG-style tokens ($value + ds.modes) still work ──
const d1 = { c: { $value: '#000', $extensions: { 'ds.modes': { dark: '#fff' } } } };
const d2 = { c: { $value: '#111', $extensions: { 'ds.modes': { dark: '#eee' } } } };
const dctg = diffTokens(d1, d2);
assert.ok(dctg.includes('~ c: "#000" → "#111"'), 'DTCG $value diffed');
assert.ok(dctg.includes('~ c@dark: "#fff" → "#eee"'), 'DTCG mode override diffed');

// ── flattenLeaves: plain values become leaves (the bug that hid all config drift) ──
const m = new Map();
flattenLeaves({ a: { b: 'x' }, n: 5, arr: [1, 2] }, '', m);
assert.equal(m.get('a.b'), '"x"', 'nested string leaf');
assert.equal(m.get('n'), '5', 'number leaf');
assert.equal(m.get('arr'), '[1,2]', 'array as single leaf');

console.log('✓ diff.test.mjs — all assertions passed');
