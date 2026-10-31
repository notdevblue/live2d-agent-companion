import { ATTACHMENT_LIMITS, type AttachmentInput, type Capabilities } from './contracts.js';

/** Byte signatures, rather than a renderer-controlled MIME, select the image route. */
export function attachmentImageMime(data: Uint8Array): string | undefined {
  const starts = (...bytes: number[]) => bytes.every((byte, i) => data[i] === byte);
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return 'image/png';
  if (starts(255, 216, 255)) return 'image/jpeg';
  const ascii = (start: number, end: number) => String.fromCharCode(...data.subarray(start, end));
  if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return undefined;
}

/** Snapshot bytes before the first async boundary. No paths or persistent local copies. */
export function normalizeAttachments(input: unknown): AttachmentInput[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > ATTACHMENT_LIMITS.maxFiles)
    throw new Error('첨부는 한 번에 최대 10개까지 보낼 수 있습니다.');
  let total = 0;
  return Array.from(input).map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new Error('첨부 형식이 올바르지 않습니다.');
    const row = raw as Record<string, unknown>;
    if (
      Object.keys(row).some((key) => !['name', 'mime', 'data'].includes(key)) ||
      typeof row.name !== 'string' ||
      !row.name.trim() ||
      row.name.length > 255 ||
      /[\x00-\x1f\x7f/\\]/.test(row.name) ||
      typeof row.mime !== 'string' ||
      row.mime.length > 128 ||
      !(row.data instanceof Uint8Array)
    )
      throw new Error('첨부 이름 또는 형식이 올바르지 않습니다.');
    if (!row.data.byteLength || row.data.byteLength > ATTACHMENT_LIMITS.maxFileBytes)
      throw new Error('빈 파일은 보낼 수 없으며 파일당 최대 크기는 10 MiB입니다.');
    total += row.data.byteLength;
    if (total > ATTACHMENT_LIMITS.maxTotalBytes)
      throw new Error('첨부 전체 크기는 최대 25 MiB입니다.');
    const mime = attachmentImageMime(row.data);
    if (row.mime.startsWith('image/') && !mime)
      throw new Error('이미지는 PNG·JPEG·GIF·WebP 형식으로 첨부해 주세요.');
    return {
      name: row.name,
      mime: mime ?? 'application/octet-stream',
      data: new Uint8Array(row.data),
    };
  });
}

export function assertAttachmentSupport(
  attachments: readonly AttachmentInput[],
  capabilities: Capabilities,
): void {
  for (const attachment of attachments) {
    const capability = attachment.mime.startsWith('image/')
      ? 'attachments.image'
      : 'attachments.file';
    if (capabilities[capability] !== 'supported')
      throw new Error(
        capability === 'attachments.image'
          ? '이 연결은 이미지 첨부를 지원하지 않습니다.'
          : '이 연결은 파일 첨부를 지원하지 않습니다.',
      );
  }
}
