#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'playwright-mcp-cloakbrowser-'));
const appRoot = pickRoot();

function pickRoot() {
  const roots = [
    process.env.OPENCODE_UI_ROOT,
    '/opt/opencode-ui',
    '/home/sgallat/pk-opencode-webui',
    fileURLToPath(new URL('..', import.meta.url)),
  ].filter(Boolean);

  for (const root of roots) {
    if (fs.existsSync(path.join(root, 'node_modules'))) return root;
    if (fs.existsSync(path.join(root, 'app-prefixable', 'node_modules'))) return root;
  }

  return process.cwd();
}

function resolveCloakbrowser() {
  const roots = [
    path.join(appRoot, 'node_modules', 'cloakbrowser', 'dist', 'index.js'),
    path.join(appRoot, 'app-prefixable', 'node_modules', 'cloakbrowser', 'dist', 'index.js'),
    '/opt/opencode-ui/node_modules/cloakbrowser/dist/index.js',
    '/home/sgallat/node_modules/cloakbrowser/dist/index.js',
  ];

  for (const file of roots) {
    if (fs.existsSync(file)) return file;
  }

  const packageJson = [
    path.join(appRoot, 'package.json'),
    path.join(appRoot, 'app-prefixable', 'package.json'),
    fileURLToPath(new URL('../package.json', import.meta.url)),
  ].find(file => fs.existsSync(file));

  if (!packageJson) {
    throw new Error('Unable to resolve cloakbrowser');
  }

  return createRequire(packageJson).resolve('cloakbrowser');
}

const cloak = await import(pathToFileURL(resolveCloakbrowser()).href);
await cloak.ensureBinary();

const sandboxArgs = process.getuid && process.getuid() !== 0 && !fs.existsSync('/.dockerenv')
  ? []
  : ['--no-sandbox', '--disable-gpu'];

const configPath = path.join(tmp, 'playwright-mcp.json');
fs.writeFileSync(configPath, JSON.stringify({
  browser: {
    browserName: 'chromium',
    launchOptions: {
      executablePath: cloak.binaryInfo().binaryPath,
      headless: true,
      chromiumSandbox: false,
      args: sandboxArgs,
    },
  },
}, null, 2));

const child = spawn('bunx', ['@playwright/mcp@latest', '--config', configPath, '--isolated'], {
  cwd: appRoot,
  stdio: 'inherit',
});

const stop = signal => {
  if (!child.killed) child.kill(signal);
};

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

child.on('error', err => {
  console.error(err);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
