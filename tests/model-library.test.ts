import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelLibrary } from '../src/main/model-library.js';
import {
  applyModelMappings,
  SURPRISED_EXPRESSION,
  THINKING_MOTION,
} from '../src/shared/model-mappings.js';

const directories: string[] = [];
async function fixture(references: Record<string, unknown> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'companion-model-'));
  directories.push(root);
  await writeFile(path.join(root, 'fixture.moc3'), 'fixture-core');
  await writeFile(path.join(root, 'texture.png'), 'fixture-png');
  const manifest = path.join(root, 'fixture.model3.json');
  await writeFile(
    manifest,
    JSON.stringify({
      Version: 3,
      FileReferences: { Moc: 'fixture.moc3', Textures: ['texture.png'], ...references },
    }),
  );
  return { root, manifest };
}
async function json(file: string, value: unknown = {}): Promise<void> {
  await writeFile(file, JSON.stringify(value));
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('ModelLibrary selected directory capability (FR-L2D-001/002)', () => {
  it('augments local model references, inventories parameters and uses conservative expression mappings', async () => {
    const { root, manifest } = await fixture({ DisplayInfo: 'fixture.cdi3.json' });
    await mkdir(path.join(root, 'Exp3'));
    await mkdir(path.join(root, 'Animation'));
    for (const name of ['＞＜', '流泪', '脸红', '流冷汗', '胸口衣服'])
      await json(path.join(root, 'Exp3', `${name}.exp3.json`), { Parameters: [] });
    for (const name of ['IDLE', '默认手切举手', '竖手指切出来动画', '脱捕'])
      await json(path.join(root, 'Animation', `${name}.motion3.json`), { Curves: [] });
    await json(path.join(root, 'fixture.cdi3.json'), {
      Parameters: [{ Id: 'ParamFace', Name: 'Face' }],
    });
    const library = new ModelLibrary();
    const inventory = await library.load(manifest);
    expect(inventory.expressionMap).toEqual({
      surprised: SURPRISED_EXPRESSION,
      happy: '＞＜',
      sad: '流泪',
      embarrassed: '脸红',
      concerned: '流冷汗',
    });
    expect(inventory.gestureMap).toEqual({
      wave: '默认手切举手',
      explain: '竖手指切出来动画',
      thinking: THINKING_MOTION,
    });
    expect(inventory.parameters).toEqual([{ id: 'ParamFace', name: 'Face' }]);
    expect(inventory.expressions).toContain('胸口衣服');
    expect(Object.values(inventory.expressionMap)).not.toContain('胸口衣服');
    const response = await library.handle(new URL(inventory.url));
    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('app://ui');
    const generated = await response.json();
    expect(generated.FileReferences.Expressions).toContainEqual({
      Name: '脸红',
      File: 'Exp3/脸红.exp3.json',
    });
    expect(generated.FileReferences.Motions.Idle).toEqual([
      { File: 'Animation/IDLE.motion3.json' },
    ]);
    expect(generated.FileReferences.Motions.Gestures).toHaveLength(3);
    const asset = await library.handle(new URL('Exp3/%E8%84%B8%E7%BA%A2.exp3.json', inventory.url));
    expect(asset.status).toBe(200);
    expect(await asset.json()).toEqual({ Parameters: [] });
  });

  it('supports models without expressions/motions and revokes old tokens on a new selection', async () => {
    const { manifest } = await fixture();
    const library = new ModelLibrary();
    const first = await library.load(manifest);
    expect(first.expressions).toEqual([]);
    expect(first.motions).toEqual([]);
    expect(first.expressionMap).toEqual({ surprised: SURPRISED_EXPRESSION });
    expect(first.gestureMap).toEqual({ thinking: THINKING_MOTION });
    const second = await library.load(manifest);
    expect(first.url).not.toEqual(second.url);
    expect((await library.handle(new URL(first.url))).status).toBe(404);
    expect((await library.handle(new URL('texture.png', second.url))).status).toBe(200);
    expect((await library.handle(new URL(second.url))).status).toBe(200);
  });

  it('restores local choices and custom assets without replacing deliberate empty mappings', async () => {
    const { root, manifest } = await fixture({
      Expressions: [{ Name: 'custom', File: 'custom.exp3.json' }],
      Motions: { Gesture: [{ File: 'custom.motion3.json' }] },
    });
    await json(path.join(root, 'custom.exp3.json'));
    await json(path.join(root, 'custom.motion3.json'));
    const model = await new ModelLibrary().load(manifest);
    applyModelMappings(model, {
      expressionMap: { surprised: 'custom' },
      gestureMap: { thinking: 'custom' },
    });
    expect(model.expressionMap.surprised).toBe('custom');
    expect(model.gestureMap.thinking).toBe('custom');
    const saved = JSON.parse(
      JSON.stringify({
        expressionMap: { surprised: SURPRISED_EXPRESSION },
        gestureMap: { thinking: THINKING_MOTION },
      }),
    );
    applyModelMappings(model, saved);
    expect(model.expressionMap.surprised).toBe(SURPRISED_EXPRESSION);
    expect(model.gestureMap.thinking).toBe(THINKING_MOTION);
    applyModelMappings(model, {
      expressionMap: { happy: THINKING_MOTION },
      gestureMap: { wave: SURPRISED_EXPRESSION, thinking: 'missing' },
    });
    expect(model.expressionMap.happy).toBeUndefined();
    expect(model.gestureMap.wave).toBeUndefined();
    expect(model.gestureMap.thinking).toBe(THINKING_MOTION);
    applyModelMappings(model, { expressionMap: { surprised: '' }, gestureMap: { thinking: '' } });
    expect(model.expressionMap.surprised).toBeUndefined();
    expect(model.gestureMap.thinking).toBeUndefined();
    expect(model.motions).toEqual(['custom']);
    expect(model.expressions).toEqual(['custom']);
  });

  it('does not expose unreferenced files, wrong tokens, query strings or arbitrary schemes', async () => {
    const { root, manifest } = await fixture();
    await writeFile(path.join(root, 'private.txt'), 'not exposed');
    const library = new ModelLibrary();
    const inventory = await library.load(manifest);
    for (const url of [
      new URL('private.txt', inventory.url),
      new URL('app://model/invalid/texture.png'),
      new URL(`${inventory.url}?path=/etc/passwd`),
      new URL('file:///etc/passwd'),
      new URL('../texture.png', inventory.url),
      new URL('%2e%2e%2fprivate.txt', inventory.url),
      new URL('%2Fetc%2Fpasswd', inventory.url),
    ]) {
      expect((await library.handle(url)).status).toBe(404);
    }
  });

  it.each([
    '../outside.moc3',
    '/etc/passwd',
    'C:\\secret.moc3',
    'https://example.com/model.moc3',
    'sub/../fixture.moc3',
    'sub\\fixture.moc3',
    '%2e%2e/secret.moc3',
  ])('rejects unsafe original reference %s', async (ref) => {
    const { manifest } = await fixture({ Moc: ref });
    await expect(new ModelLibrary().load(manifest)).rejects.toThrow();
  });

  it('rejects symlink escapes during load and rechecks a changed asset before serving', async () => {
    const { root, manifest } = await fixture();
    const outside = await mkdtemp(path.join(tmpdir(), 'companion-outside-'));
    directories.push(outside);
    await writeFile(path.join(outside, 'private.png'), 'private');
    await rm(path.join(root, 'texture.png'));
    await symlink(path.join(outside, 'private.png'), path.join(root, 'texture.png'));
    await expect(new ModelLibrary().load(manifest)).rejects.toThrow();
    await rm(path.join(root, 'texture.png'));
    await writeFile(path.join(root, 'texture.png'), 'local');
    const library = new ModelLibrary();
    const inventory = await library.load(manifest);
    await rm(path.join(root, 'texture.png'));
    await symlink(path.join(outside, 'private.png'), path.join(root, 'texture.png'));
    expect((await library.handle(new URL('texture.png', inventory.url))).status).toBe(404);
  });

  it('rejects discovered expression directory or file symlinks outside the selected directory', async () => {
    const { root, manifest } = await fixture();
    const outside = await mkdtemp(path.join(tmpdir(), 'companion-outside-'));
    directories.push(outside);
    await json(path.join(outside, 'secret.exp3.json'));
    await symlink(outside, path.join(root, 'Exp3'));
    await expect(new ModelLibrary().load(manifest)).rejects.toThrow();
    await rm(path.join(root, 'Exp3'));
    await mkdir(path.join(root, 'Exp3'));
    await symlink(path.join(outside, 'secret.exp3.json'), path.join(root, 'Exp3', 'bad.exp3.json'));
    await expect(new ModelLibrary().load(manifest)).rejects.toThrow();
  });

  it('preserves existing declared expression names/groups and validates nested motion audio references', async () => {
    const { root, manifest } = await fixture({
      Expressions: [{ Name: 'Custom', File: 'custom.exp3.json' }],
      Motions: { CustomGroup: [{ File: 'custom.motion3.json', Sound: '../private.wav' }] },
    });
    await json(path.join(root, 'custom.exp3.json'));
    await json(path.join(root, 'custom.motion3.json'));
    await expect(new ModelLibrary().load(manifest)).rejects.toThrow();
    await json(manifest, {
      Version: 3,
      FileReferences: {
        Moc: 'fixture.moc3',
        Textures: ['texture.png'],
        Expressions: [{ Name: 'Custom', File: 'custom.exp3.json' }],
        Motions: { CustomGroup: [{ File: 'custom.motion3.json' }] },
      },
    });
    const library = new ModelLibrary();
    const inventory = await library.load(manifest);
    expect(inventory.expressions).toEqual(['Custom']);
    expect(inventory.motions).toEqual(['custom']);
    const generated = await (await library.handle(new URL(inventory.url))).json();
    expect(generated.FileReferences.Motions.CustomGroup).toEqual([{ File: 'custom.motion3.json' }]);
  });
});
