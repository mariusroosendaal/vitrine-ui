#!/usr/bin/env node
/**
 * Companion server for the token-sync Figma plugin.
 *
 *   node tokens/figma-sync/sync-server.mjs   (or: npm run sync:serve)
 *
 * Runs on http://localhost:41789. The plugin POSTs its variable/style export
 * here; the server runs the deterministic transformer, writes frontend.config.json,
 * and replies with what changed. One click in Figma → your working tree updated,
 * ready to `git diff`.
 *
 * Zero dependencies (node:http only). No LLM. Localhost only — nothing leaves
 * your machine. Stop with Ctrl-C.
 */
import { createServer } from 'node:http';
import { runSync } from './sync.mjs';

const PORT = Number(process.env.FIGMA_SYNC_PORT) || 41789;

// Figma plugin UI iframes post from a null origin; allow it + localhost tools.
const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

const server = createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'figma-token-sync' }));
    return;
  }
  if (req.method !== 'POST') { res.writeHead(405).end('POST the Figma export to /'); return; }

  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 50e6) req.destroy(); });
  req.on('end', () => {
    let exportData;
    try { exportData = JSON.parse(body); }
    catch { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'invalid JSON' })); return; }

    const dryRun = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('dryRun') === '1';
    const lines = [];
    try {
      const { written, warnings, changed, changes } = runSync({ exportData, dryRun, log: (m) => lines.push(m) });
      console.log(`[sync] ${dryRun ? 'dry-run' : 'wrote'} ${(dryRun ? changed : written).length} file(s); ${warnings.length} warning(s)`);
      lines.forEach((l) => console.log(l));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, dryRun, written, changed, changes, warnings }));
    } catch (err) {
      console.error('[sync] failed:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
    }
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`✗ Port ${PORT} is already in use. Stop the other process, or set FIGMA_SYNC_PORT (and update plugin/manifest.json).`);
  else if (err.code === 'EACCES' || err.code === 'EPERM') console.error(`✗ Not allowed to listen on ${PORT}. Try a different FIGMA_SYNC_PORT, or check local firewall/sandbox settings.`);
  else console.error('✗ Server error:', err.message);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`token-sync server → http://localhost:${PORT}`);
  console.log('Open the "Figma Token Sync" plugin in Figma and click Sync. Ctrl-C to stop.');
});
