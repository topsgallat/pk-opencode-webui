#!/usr/bin/env bun
import fs from 'node:fs';
import path from 'node:path';

const [configPath, wrapperPath] = process.argv.slice(2);

if (!configPath || !wrapperPath) {
  throw new Error('usage: merge-opencode-config.mjs <configPath> <wrapperPath>');
}

const config = fs.existsSync(configPath)
  ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
  : {};

config.mcp ??= {};
config.mcp.playwright = {
  ...config.mcp.playwright,
  type: 'local',
  command: ['bun', wrapperPath],
  enabled: true,
};

fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
