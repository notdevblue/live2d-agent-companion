import { build as bundle } from 'esbuild';
import { build as viteBuild } from 'vite';
import { resolve } from 'node:path';
import { mkdir, cp } from 'node:fs/promises';

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
