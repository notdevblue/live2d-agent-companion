import { build as bundle } from 'esbuild';
import { build as viteBuild } from 'vite';
import { resolve } from 'node:path';
import { mkdir, cp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = resolve(import.meta.dirname, '..');
await bundle({
  entryPoints: ['src/main/index.ts'],
  outdir: 'dist/main',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  target: 'node22',
  sourcemap: true,
});
await bundle({
  entryPoints: ['src/preload/index.ts'],
  outfile: 'dist/preload/index.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
  target: 'node22',
});
await viteBuild({
  root: resolve(root, 'src/renderer'),
  base: './',
  resolve: { alias: { '@cubism': resolve(root, 'vendor/framework/src') } },
  build: { outDir: resolve(root, 'dist/renderer'), emptyOutDir: true, target: 'es2022' },
});
await mkdir(resolve(root, 'dist/runtime'), { recursive: true });
await cp(
  resolve(root, 'vendor/core/live2dcubismcore.min.js'),
  resolve(root, 'dist/runtime/live2dcubismcore.min.js'),
);
await cp(resolve(root, 'vendor/framework/Shaders/WebGL'), resolve(root, 'dist/runtime/shaders'), {
  recursive: true,
});

if (process.platform === 'linux') {
  const binary = resolve(root, 'dist/native/x11-input');
  await mkdir(resolve(root, 'dist/native'), { recursive: true });
  try {
    await promisify(execFile)('cc', [
      '-std=c11',
      '-O2',
      '-Wall',
      '-Wextra',
      resolve(root, 'scripts/native/x11-input.c'),
      '-o',
      binary,
      '-lX11',
      '-lXext',
    ]);
  } catch {
    await rm(binary, { force: true });
    console.warn(
      'X11 input shape helper unavailable: install cc and X11/Xext development libraries. Linux click-through will be unavailable.',
    );
  }
}
