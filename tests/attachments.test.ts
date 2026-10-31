import { describe, expect, it } from 'vitest';
import { ATTACHMENT_LIMITS, unsupportedCapabilities } from '../src/shared/contracts.js';
import { normalizeAttachments, assertAttachmentSupport } from '../src/shared/attachments.js';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const file = (extra = {}) => ({
  name: 'note.txt',
  mime: 'text/plain',
  data: new Uint8Array([65]),
  ...extra,
});
describe('attachment byte boundary — FR-CHAT-003', () => {
  it('snapshots only the selected bytes and sniffs image content rather than trusting extensions/MIME', () => {
    const source = new Uint8Array([0, ...png, 0]);
    const result = normalizeAttachments([
      file({ name: 'photo.bin', data: source.subarray(1, -1) }),
    ]);
    source.fill(0);
    expect(result[0]).toEqual({ name: 'photo.bin', mime: 'image/png', data: png });
    expect(
      normalizeAttachments([file({ name: 'script.svg', mime: 'application/octet-stream' })])[0]!
        .mime,
    ).toBe('application/octet-stream');
  });
  it('rejects path authority, forged image types, malformed bytes and bounded file/batch sizes', () => {
    for (const bad of [
      file({ name: '../secret' }),
      file({ name: 'C:\\secret' }),
      file({ path: '/secret' }),
      file({ mime: 'image/png' }),
      file({ data: [65] }),
      file({ data: new Uint8Array() }),
      file({ data: new Uint8Array(ATTACHMENT_LIMITS.maxFileBytes + 1) }),
    ])
      expect(() => normalizeAttachments([bad])).toThrow();
    expect(() => normalizeAttachments(new Array(1))).toThrow();
    expect(() => normalizeAttachments(Array.from({ length: 11 }, () => file()))).toThrow();
    const large = file({ data: new Uint8Array(ATTACHMENT_LIMITS.maxFileBytes) });
    expect(() => normalizeAttachments([large, large, large])).toThrow(/25 MiB/);
  });
  it('requires separate positive image/file capabilities', () => {
    const capabilities = unsupportedCapabilities();
    const image = normalizeAttachments([file({ data: png })]);
    const files = normalizeAttachments([file()]);
    expect(() => assertAttachmentSupport(image, capabilities)).toThrow(/이미지/);
    capabilities['attachments.image'] = 'supported';
    expect(() => assertAttachmentSupport(image, capabilities)).not.toThrow();
    expect(() => assertAttachmentSupport(files, capabilities)).toThrow(/파일/);
    capabilities['attachments.file'] = 'supported';
    expect(() => assertAttachmentSupport(files, capabilities)).not.toThrow();
  });
});
