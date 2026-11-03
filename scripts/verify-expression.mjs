import { build } from 'esbuild';
import electron from 'electron';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const model = args[args.indexOf('--model') + 1];
if (!args.includes('--model') || !model || model.startsWith('--')) {
  console.error('사용법: node scripts/verify-expression.mjs --model <모델.model3.json>');
  process.exit(1);
}
const output = join(root, 'artifacts/expression-afterglow');
const generated = join(output, 'build');
await mkdir(generated, { recursive: true });
await writeFile(join(output, 'results.json'), JSON.stringify({ passed: false, status: 'running' }));
const shared = { bundle: true, logLevel: 'warning', absWorkingDir: root };
for (const mode of ['before', 'after', 'owned-lean']) {
  await build({
    ...shared,
    entryPoints: ['scripts/fixtures/expression-renderer.ts'],
    outfile: join(generated, `${mode}.js`),
    platform: 'browser',
    alias: { '@cubism': join(root, 'vendor/framework/src') },
    plugins:
      mode === 'before'
        ? [
            {
              name: 'previous-lean-coefficient',
              setup(builder) {
                builder.onLoad({ filter: /src\/renderer\/avatar\.ts$/ }, async ({ path }) => {
                  const source = await readFile(path, 'utf8');
                  if (!source.includes('-acting.lean * 0.7'))
                    throw new Error('비교할 lean 0.7 계수를 찾지 못했습니다.');
                  return {
                    contents: source.replace('-acting.lean * 0.7', '-acting.lean * 0.35'),
                    loader: 'ts',
                  };
                });
              },
            },
          ]
        : [],
  });
  await writeFile(
    join(generated, `${mode}.html`),
    `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src app:; style-src 'unsafe-inline'; connect-src app:; img-src app: data:"><style>html,body{margin:0;background:transparent}canvas{width:360px;height:560px}</style><script src="app://runtime/core.js"></script></head><body><canvas></canvas><script src="app://ui/${mode}.js"></script></body></html>`,
  );
}
await build({
  ...shared,
  entryPoints: ['scripts/fixtures/expression-main.ts'],
  outfile: join(generated, 'main.cjs'),
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
});
const env = {
  PATH: process.env.PATH,
  LANG: process.env.LANG ?? 'C.UTF-8',
  XDG_CONFIG_HOME: join(output, 'config'),
  XDG_CACHE_HOME: join(output, 'cache'),
  ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
};
const child = spawn(
  electron,
  [
    join(generated, 'main.cjs'),
    '--ozone-platform=headless',
    '--model',
    resolve(model),
    '--root',
    root,
    '--output',
    output,
  ],
  {
    cwd: root,
    env,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  },
);
// Hundreds of software-rendered captures need a workload deadline, while a
// stalled scene must fail independently of how many earlier scenes completed.
const started = Date.now();
let lastProgress = { stage: 'startup' };
let timedOut = false;
let stallTimer;
const failTimeout = async (reason) => {
  if (timedOut) return;
  timedOut = true;
  clearTimeout(stallTimer);
  clearTimeout(totalTimer);
  console.error(`표현 렌더 검증 시간 초과: ${reason} (${JSON.stringify(lastProgress)})`);
  process.exitCode = 1;
  try {
    await writeFile(
      join(output, 'results.json'),
      JSON.stringify({
        passed: false,
        error: reason,
        elapsedMs: Date.now() - started,
        lastProgress,
      }),
    );
  } catch (error) {
    console.error(`검사 실패 결과를 저장하지 못했습니다: ${error.message}`);
  } finally {
    child.kill('SIGKILL');
  }
};
const armStallTimer = () => {
  clearTimeout(stallTimer);
  stallTimer = setTimeout(() => void failTimeout('90 second progress timeout'), 90000);
};
const totalTimer = setTimeout(() => void failTimeout('300 second process timeout'), 300000);
armStallTimer();
child.on('message', (message) => {
  if (timedOut || !message || typeof message !== 'object') return;
  const progress = message;
  if (progress.kind !== 'expression-progress' || typeof progress.stage !== 'string') return;
  lastProgress = {
    stage: progress.stage,
    ...(typeof progress.mode === 'string' ? { mode: progress.mode } : {}),
    ...(typeof progress.scene === 'string' ? { scene: progress.scene } : {}),
  };
  armStallTimer();
});
const clearTimers = () => {
  clearTimeout(stallTimer);
  clearTimeout(totalTimer);
};
child.on('error', (error) => {
  clearTimers();
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  clearTimers();
  process.exitCode = timedOut ? 1 : (code ?? 1);
});
