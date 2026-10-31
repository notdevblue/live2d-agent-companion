import electron from 'electron';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
let key;
if (args.includes('--jev-stdin')) {
  const wasRaw = process.stdin.isRaw;
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  try {
    const reader = createInterface({ input: process.stdin, terminal: false });
    key = await new Promise((resolve, reject) => {
      const interrupt = (chunk) => {
        if (chunk.includes('\u0003')) {
          reader.close();
          reject(new Error('비밀 입력을 중단했습니다.'));
        }
      };
      process.stdin.on('data', interrupt);
      reader.once('line', (line) => {
        process.stdin.removeListener('data', interrupt);
        reader.close();
        resolve(line.trim());
      });
    });
  } finally {
    if (process.stdin.isTTY) process.stdin.setRawMode(Boolean(wasRaw));
  }
}
const child = spawn(
  electron,
  [
    '.',
    '--smoke',
    '--ozone-platform=headless',
    ...args.filter((arg) => arg !== '--jev-stdin'),
    ...(key ? ['--jev-key-fd=3'] : []),
  ],
  {
    cwd: root,
    stdio: key ? ['ignore', 'inherit', 'inherit', 'pipe'] : 'inherit',
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
  },
);
if (key) {
  child.stdio[3].end(key);
  key = undefined;
}
const timer = setTimeout(() => {
  child.kill('SIGTERM');
  process.exitCode = 1;
}, 45000);
child.on('exit', (code) => {
  clearTimeout(timer);
  process.exitCode = code ?? 1;
});
