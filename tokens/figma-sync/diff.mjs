// Pure token-diff helpers — no Node imports, so this same module runs both in the
// CLI (sync.mjs imports it) and inside the Figma plugin UI (fetched from the repo
// and eval'd for the drift check). Keep it dependency-free.

// flatten a token tree to Map(path → JSON-encoded value). Handles two shapes:
//   • DTCG tokens — a node with `$value` (plus `ds.modes` mode overrides)
//   • plain config — primitives/arrays as direct leaf values (frontend.config.json)
export function flattenLeaves(node, path, out) {
  if (node == null) return;
  if (typeof node !== 'object') { out.set(path, JSON.stringify(node)); return; } // primitive leaf
  if (Array.isArray(node)) { out.set(path, JSON.stringify(node)); return; }       // array as one leaf
  if ('$value' in node) {
    out.set(path, JSON.stringify(node.$value));
    const modes = node.$extensions?.['ds.modes'];
    if (modes) for (const [m, v] of Object.entries(modes)) out.set(`${path}@${m}`, JSON.stringify(v));
    return; // DTCG leaf — don't descend into $-internals
  }
  const keys = Object.keys(node).filter((k) => !k.startsWith('$'));
  if (!keys.length) { out.set(path, JSON.stringify(node)); return; } // empty object ({}), e.g. ratios
  for (const k of keys) flattenLeaves(node[k], path ? `${path}.${k}` : k, out);
}

// Stable, `$`-insensitive view of a config for hashing/compare. Sorts keys (so
// object order never matters) and drops `$`-prefixed keys (so the `$figmaSync`
// stamp never hashes itself). Mirrors flattenLeaves' `$`-skip.
export function canonicalize(node) {
  if (node == null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(canonicalize);
  const out = {};
  for (const k of Object.keys(node).filter((k) => !k.startsWith('$')).sort()) out[k] = canonicalize(node[k]);
  return out;
}

// Deterministic content hash of a config (excludes `$` keys). cyrb53 — integer ops
// only, so Node and the plugin's UI iframe produce byte-identical results.
export function hashConfig(obj) {
  const s = JSON.stringify(canonicalize(obj));
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

// human-readable token-level changes between two parsed token files
export function diffTokens(prevObj, nextObj) {
  const a = new Map(), b = new Map();
  flattenLeaves(prevObj, '', a);
  flattenLeaves(nextObj, '', b);
  const out = [];
  for (const [k, v] of b) {
    if (!a.has(k)) out.push(`+ ${k} = ${v}`);
    else if (a.get(k) !== v) out.push(`~ ${k}: ${a.get(k)} → ${v}`);
  }
  for (const k of a.keys()) if (!b.has(k)) out.push(`- ${k}`);
  return out;
}
