// Figma Token Sync — plugin main thread.
//
// Reads every LOCAL variable collection, text style, and effect style and
// normalizes them into the export shape that ../transform.a17.mjs consumes. The
// UI (ui.html) posts that export to the localhost companion server, or saves
// it to disk. Pure read — this plugin never writes to the Figma file.

figma.showUI(__html__, { width: 340, height: 600, themeColors: true });

// normalize one variable value (per mode) to the transformer's tagged union
function normValue(v) {
  if (v && typeof v === 'object' && v.type === 'VARIABLE_ALIAS') return { type: 'ALIAS', id: v.id };
  if (v && typeof v === 'object' && 'r' in v) return { type: 'COLOR', r: v.r, g: v.g, b: v.b, a: v.a == null ? 1 : v.a };
  if (typeof v === 'number') return { type: 'FLOAT', value: v };
  if (typeof v === 'string') return { type: 'STRING', value: v };
  if (typeof v === 'boolean') return { type: 'BOOLEAN', value: v };
  return { type: 'UNKNOWN' };
}

// pull bound-variable ids off a boundVariables map → { field: id }
function boundIds(boundVariables) {
  const out = {};
  if (!boundVariables) return out;
  for (const field of Object.keys(boundVariables)) {
    const b = boundVariables[field];
    if (b && b.id) out[field] = b.id;
    else if (Array.isArray(b) && b[0] && b[0].id) out[field] = b[0].id;
  }
  return out;
}

async function buildExport() {
  const collections = [];
  const localCollections = await figma.variables.getLocalVariableCollectionsAsync();
  for (const c of localCollections) {
    // fetch every variable in the collection in parallel (was sequential)
    const fetched = await Promise.all(c.variableIds.map((id) => figma.variables.getVariableByIdAsync(id)));
    const variables = [];
    for (const v of fetched) {
      if (!v) continue;
      const valuesByMode = {};
      for (const modeId of Object.keys(v.valuesByMode)) valuesByMode[modeId] = normValue(v.valuesByMode[modeId]);
      variables.push({
        id: v.id,
        name: v.name,
        resolvedType: v.resolvedType,
        description: v.description || undefined,
        valuesByMode,
      });
    }
    collections.push({
      id: c.id,
      name: c.name,
      modes: c.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
      defaultModeId: c.defaultModeId,
      variables,
    });
  }

  const textStyles = (await figma.getLocalTextStylesAsync()).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description || undefined,
    fontName: s.fontName, // { family, style }
    fontSize: s.fontSize,
    fontWeight: typeof s.fontWeight === 'number' ? s.fontWeight : undefined,
    lineHeight: s.lineHeight, // { unit, value } | { unit: 'AUTO' }
    letterSpacing: s.letterSpacing, // { unit, value }
    textCase: s.textCase,
    textDecoration: s.textDecoration,
    boundVariables: boundIds(s.boundVariables),
  }));

  const effectStyles = (await figma.getLocalEffectStylesAsync()).map((s) => ({
    id: s.id,
    name: s.name,
    effects: s.effects.map((e) => ({
      type: e.type,
      color: e.color, // { r, g, b, a }
      offset: e.offset, // { x, y }
      radius: e.radius,
      spread: e.spread,
      boundVariables: boundIds(e.boundVariables),
    })),
  }));

  return {
    version: 1,
    fileName: figma.root.name,
    collections,
    textStyles,
    effectStyles,
  };
}

// GitHub flow settings (repo + token) live in clientStorage — local to this
// Figma client, never committed to the repo. Only the main thread can reach
// clientStorage, so the UI gets/sets them through these messages.
const SETTINGS_KEY = 'figma-token-sync.github';

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'get-settings') {
    const settings = (await figma.clientStorage.getAsync(SETTINGS_KEY)) || {};
    figma.ui.postMessage({ type: 'settings', settings });
    return;
  }
  if (msg.type === 'save-settings') {
    await figma.clientStorage.setAsync(SETTINGS_KEY, msg.settings || {});
    return;
  }
  if (msg.type === 'export') {
    try {
      const data = await buildExport();
      const counts = {
        collections: data.collections.length,
        variables: data.collections.reduce((n, c) => n + c.variables.length, 0),
        textStyles: data.textStyles.length,
        effectStyles: data.effectStyles.length,
      };
      figma.ui.postMessage({ type: 'export-data', data, counts });
    } catch (err) {
      figma.ui.postMessage({ type: 'error', message: String((err && err.message) || err) });
    }
  } else if (msg.type === 'close') {
    figma.closePlugin();
  } else if (msg.type === 'notify' && typeof msg.message === 'string') {
    figma.notify(msg.message);
  }
};
