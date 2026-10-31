// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatAttachments } from '../src/renderer/chat-attachments.js';
import { ATTACHMENT_LIMITS, unsupportedCapabilities } from '../src/shared/contracts.js';

function file(name: string, bytes: number[], type = ''): File {
  const data = Uint8Array.from(bytes);
  const result = new File([data], name, { type });
  Object.defineProperty(result, 'arrayBuffer', {
    value: vi.fn(async () => data.buffer),
    configurable: true,
  });
  return result;
}
function setup(image = true, general = true) {
  const list = document.createElement('div');
  const capabilities = {
    ...unsupportedCapabilities(),
    'attachments.image': image ? 'supported' : 'unsupported',
    'attachments.file': general ? 'supported' : 'unsupported',
  } as const;
  const error = vi.fn(),
    changed = vi.fn();
  return {
    draft: new ChatAttachments(list, { capabilities: () => capabilities, error, changed }),
    list,
    error,
  };
}
beforeEach(() => {
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:local-preview'),
      revokeObjectURL: vi.fn(),
    }),
  );
});

describe('FR-CHAT-003 explicit local file drafts', () => {
  it('recognizes image bytes without an image extension and revokes the local preview on removal', async () => {
    const { draft, list } = setup(true, false);
    await draft.add([file('clipboard', [137, 80, 78, 71, 13, 10, 26, 10])]);
    expect(draft.snapshot().inputs[0]).toMatchObject({ name: 'clipboard', mime: 'image/png' });
    expect(list.querySelector('img')?.getAttribute('src')).toBe('blob:local-preview');
    list.querySelector('button')!.click();
    expect(draft.count).toBe(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-preview');
    expect(list.hidden).toBe(true);
  });
  it('uses literal names and does not preview SVG or create an external resource', async () => {
    const { draft, list } = setup();
    await draft.add([file('<img onerror=evil>.svg', [60, 115, 118, 103, 62], 'image/svg+xml')]);
    expect(draft.snapshot().inputs[0]?.mime).toBe('application/octet-stream');
    expect(list.textContent).toContain('<img onerror=evil>.svg');
    expect(list.querySelector('img')).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it('refuses unsupported kinds, invalid image bytes and too-large files with an actionable error', async () => {
    const { draft, error } = setup(true, false);
    await draft.add([file('notes.txt', [65])]);
    expect(error.mock.lastCall?.[0]).toContain('파일 첨부를 지원하지');
    await draft.add([file('not-image.png', [65])]);
    expect(error.mock.lastCall?.[0]).toContain('PNG');
    const large = file('large', [65]);
    Object.defineProperty(large, 'size', { value: ATTACHMENT_LIMITS.maxFileBytes + 1 });
    await draft.add([large]);
    expect(error.mock.lastCall?.[0]).toContain('10 MB');
    expect(large.arrayBuffer).not.toHaveBeenCalled();
    expect(draft.count).toBe(0);
  });
  it('blocks sending while reading and ignores a read resolved after changing selection', async () => {
    const { draft } = setup();
    let resolve!: (buffer: ArrayBuffer) => void;
    const pending = file('pending', [65]);
    Object.defineProperty(pending, 'arrayBuffer', {
      value: () =>
        new Promise<ArrayBuffer>((done) => {
          resolve = done;
        }),
      configurable: true,
    });
    const adding = draft.add([pending]);
    expect(draft.reading).toBe(true);
    expect(() => draft.snapshot()).toThrow('읽는 중');
    draft.reset();
    resolve(Uint8Array.from([65]).buffer);
    await adding;
    expect(draft.count).toBe(0);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it('consumes only the files in a sent snapshot, retaining the next draft', async () => {
    const { draft } = setup();
    await draft.add([file('first.txt', [65])]);
    const sent = draft.snapshot();
    await draft.add([file('second.txt', [66])]);
    draft.consume(sent.ids);
    expect(draft.snapshot().inputs.map((item) => item.name)).toEqual(['second.txt']);
  });
});
