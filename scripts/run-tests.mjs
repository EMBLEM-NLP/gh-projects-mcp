#!/usr/bin/env node
// Cross-platform test runner: enumerates test/*.test.mjs via fs (no shell glob),
// then runs them under `node --test`. Node's --test only gained glob support in
// 20.14 (this project's floor is Node 18/20), and cmd.exe/npm on Windows does not
// expand `test/*.test.mjs`, so a bare glob finds zero files there. This fs
// enumerator behaves identically on every platform.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const files = readdirSync('test')
  .filter((f) => f.endsWith('.test.mjs'))
  .map((f) => `test/${f}`);

if (files.length === 0) {
  process.stderr.write('run-tests: no test/*.test.mjs files found\n');
  process.exit(1);
}

const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
