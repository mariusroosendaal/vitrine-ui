// Project wiring for the token-sync toolkit. Fork this file (not the toolkit) to
// fit your design system. All paths are relative to this file's directory.
//
// THIS BRANCH (vitrine-ui-variant) targets the A17 stack: the transformer emits a
// single `frontend.config.json` at the repo root, consumed by @area17/a17-tailwind-
// plugins. This repo only PRODUCES the config — the consuming app (e.g. vitrine-ui)
// owns its Tailwind build — so the toolkit stays dependency-free.
export default {
  // frontend.config.json lives at the repo root (matches vitrine-ui's layout).
  tokensDir: '.',

  // The A17-dedicated transformer (single frontend.config.json, self-contained).
  transform: 'tokens/figma-sync/transform.a17.mjs',

  // Emit JSON only — the consuming app builds CSS from frontend.config.json.
  build: null,
};
