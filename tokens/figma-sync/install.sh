#!/usr/bin/env bash
# Install the Figma token-sync toolkit into a consuming app (e.g. a copy of
# vitrine-ui) in one step. Idempotent and non-destructive: it never overwrites
# the app's frontend.config.json, only appends missing .gitignore lines, and only
# adds package.json scripts that aren't already there.
#
#   tokens/figma-sync/install.sh /path/to/consuming-app
#
# After it runs, see the "Next steps" it prints to finish wiring the GitHub flow.
set -euo pipefail

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "usage: install.sh /path/to/consuming-app" >&2
  exit 2
fi
if [ ! -d "$TARGET" ]; then
  echo "✗ target not found: $TARGET" >&2
  exit 2
fi

# This script lives in the toolkit dir; the toolkit repo root is two levels up.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_ROOT="$(cd "$HERE/../.." && pwd)"
TARGET="$(cd "$TARGET" && pwd)"

if [ "$SRC_ROOT" = "$TARGET" ]; then
  echo "✗ refusing to install the toolkit into itself" >&2
  exit 2
fi
if [ ! -d "$TARGET/.git" ]; then
  echo "⚠ $TARGET is not a git repo — continuing anyway"
fi

echo "Installing toolkit from $SRC_ROOT"
echo "                  into $TARGET"
echo

# 1. the toolkit itself (transform, sync CLI/server, plugin, template, tests)
mkdir -p "$TARGET/tokens/figma-sync"
cp -R "$HERE/." "$TARGET/tokens/figma-sync/"
find "$TARGET/tokens/figma-sync" -name .DS_Store -delete
echo "✓ tokens/figma-sync/  (toolkit copied)"

# 2. project wiring at the consuming app's root
cp "$SRC_ROOT/figma-sync.config.mjs" "$TARGET/figma-sync.config.mjs"
echo "✓ figma-sync.config.mjs  (review tokensDir/transform if the app's layout differs)"

# 3. the CI Action, copied from the template into the live workflows dir
mkdir -p "$TARGET/.github/workflows"
cp "$HERE/github-workflow.template.yml" "$TARGET/.github/workflows/figma-token-sync.yml"
echo "✓ .github/workflows/figma-token-sync.yml"

# 4. .gitignore — append only the lines that aren't already present
GI="$TARGET/.gitignore"
touch "$GI"
added_gi=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  if ! grep -qxF "$line" "$GI"; then
    [ "$added_gi" -eq 0 ] && printf '\n# Figma token-sync: on-demand exports, never tracked\n' >> "$GI"
    printf '%s\n' "$line" >> "$GI"
    added_gi=1
  fi
done <<'EOF'
tokens/figma-sync/figma-export.json
*.figma-export.json
EOF
[ "$added_gi" -eq 1 ] && echo "✓ .gitignore  (export ignore rules appended)" || echo "= .gitignore  (rules already present)"

# 5. package.json scripts — add the three sync scripts if missing (optional, for the
#    local/CLI path; the GitHub Action calls sync.mjs by path and needs none of these)
if [ -f "$TARGET/package.json" ]; then
  node - "$TARGET/package.json" <<'EOF'
const fs = require('fs');
const p = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
pkg.scripts ||= {};
const want = {
  sync: 'node tokens/figma-sync/sync.mjs',
  'sync:serve': 'node tokens/figma-sync/sync-server.mjs',
  'sync:test': 'node tokens/figma-sync/transform.a17.test.mjs',
};
let added = [];
for (const [k, v] of Object.entries(want)) if (!(k in pkg.scripts)) { pkg.scripts[k] = v; added.push(k); }
if (added.length) {
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
  console.log('✓ package.json  (added scripts: ' + added.join(', ') + ')');
} else {
  console.log('= package.json  (sync scripts already present)');
}
EOF
else
  echo "⚠ no package.json at target root — skipped script wiring"
fi

# frontend.config.json: never touched. The app owns it; the transform writes it.
if [ -f "$TARGET/frontend.config.json" ]; then
  echo "= frontend.config.json  (left as-is — this is the transform's merge target)"
else
  echo "⚠ no frontend.config.json at target root — the app should own this; the first"
  echo "  sync will create it, but confirm tokensDir in figma-sync.config.mjs is right"
fi

cat <<'EOF'

Next steps (in the consuming app):
  1. Commit and push these files to the repo's default branch (main, 3.x, …).
     The Action keys off the repo's default branch automatically — no edits needed.
  2. GitHub → Settings → Actions → General → Workflow permissions →
     enable "Allow GitHub Actions to create and approve pull requests."
  3. Sanity-check the transform against your Figma names BEFORE the round-trip:
       node tokens/figma-sync/sync.mjs <a-real-export>.json --report
  4. In the Figma plugin, set the repo to THIS app (owner/name) + a fine-grained
     PAT with Contents: Read/Write on it, then Sync to GitHub & open PR.
EOF
