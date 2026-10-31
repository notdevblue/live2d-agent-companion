import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.platform !== 'linux' || !process.env.DISPLAY) {
  console.error(
    'Linux X11 DISPLAY가 필요합니다. 이 검사는 자기 소유의 숨겨진 테스트 창만 만듭니다.',
  );
  process.exit(1);
}
const root = resolve(import.meta.dirname, '..');
mkdirSync(resolve(root, '.tmp'), { recursive: true });
for (const [source, target, libraries] of [
  ['scripts/native/x11-input.c', '.tmp/test-x11-helper', ['-lX11', '-lXext']],
  ['scripts/native/test-x11-input.c', '.tmp/test-x11-input', ['-lX11', '-lXext']],
]) {
  const built = spawnSync('cc', ['-O2', '-Wall', '-Wextra', source, '-o', target, ...libraries], {
    cwd: root,
    stdio: 'inherit',
  });
  if (built.error || built.status !== 0) process.exit(1);
}
const result = spawnSync(
  resolve(root, '.tmp/test-x11-input'),
  [resolve(root, '.tmp/test-x11-helper')],
  {
    cwd: root,
    stdio: 'inherit',
    timeout: 20000,
  },
);
process.exit(result.status ?? 1);
