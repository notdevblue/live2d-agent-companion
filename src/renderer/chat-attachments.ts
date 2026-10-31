import { ATTACHMENT_LIMITS, type AttachmentInput, type Capabilities } from '../shared/contracts.js';
import { normalizeAttachments, assertAttachmentSupport } from '../shared/attachments.js';

const previewTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const imageExtensions: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};
interface DraftAttachment {
  id: number;
  file: File;
  mime: string;
  data?: Uint8Array;
  preview?: string;
}
export interface AttachmentSnapshot {
  ids: number[];
  inputs: AttachmentInput[];
  label: string;
}
export function attachmentSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.ceil(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
const mimeOf = (file: File): string =>
  imageExtensions[file.name.split('.').at(-1)?.toLowerCase() ?? ''] ??
  (previewTypes.has(file.type) ? file.type : 'application/octet-stream');

/** Owns only explicitly selected browser File bytes. Never asks main to read a path. */
export class ChatAttachments {
  private items: DraftAttachment[] = [];
  private serial = 0;
  private generation = 0;
  constructor(
    private readonly list: HTMLElement,
    private readonly options: {
      capabilities(): Capabilities;
      changed(): void;
      error(message: string): void;
    },
  ) {
    this.render();
  }
  get count(): number {
    return this.items.length;
  }
  get reading(): boolean {
    return this.items.some((item) => !item.data);
  }
  get supported(): boolean {
    const caps = this.options.capabilities();
    return caps['attachments.image'] === 'supported' || caps['attachments.file'] === 'supported';
  }
  async add(files: readonly File[]): Promise<void> {
    if (!files.length) return;
    const size = [...this.items.map((item) => item.file), ...files].reduce(
      (sum, file) => sum + file.size,
      0,
    );
    let failure = '';
    if (this.items.length + files.length > ATTACHMENT_LIMITS.maxFiles)
      failure = `파일은 한 번에 ${ATTACHMENT_LIMITS.maxFiles}개까지 첨부할 수 있습니다.`;
    else if (files.some((file) => file.size > ATTACHMENT_LIMITS.maxFileBytes))
      failure = '파일 하나는 10 MB 이하여야 합니다.';
    else if (size > ATTACHMENT_LIMITS.maxTotalBytes)
      failure = '첨부 파일 합계는 25 MB 이하여야 합니다.';
    else if (!this.supported) failure = '현재 연결은 파일 첨부를 지원하지 않습니다.';
    if (failure) {
      this.options.error(failure);
      return;
    }
    const generation = this.generation;
    const additions = files.map(
      (file) => ({ id: ++this.serial, file, mime: mimeOf(file) }) as DraftAttachment,
    );
    this.items.push(...additions);
    this.render();
    await Promise.all(
      additions.map(async (item) => {
        let validating = false;
        try {
          const data = new Uint8Array(await item.file.arrayBuffer());
          if (generation !== this.generation || !this.items.includes(item)) return;
          if (
            data.byteLength !== item.file.size ||
            data.byteLength > ATTACHMENT_LIMITS.maxFileBytes
          )
            throw new Error('size');
          validating = true;
          const normalized = normalizeAttachments([
            { name: item.file.name, mime: item.mime, data },
          ]);
          assertAttachmentSupport(normalized, this.options.capabilities());
          item.mime = normalized[0]!.mime;
          item.data = normalized[0]!.data;
          if (previewTypes.has(item.mime))
            item.preview = URL.createObjectURL(
              new Blob([data.buffer as ArrayBuffer], { type: item.mime }),
            );
        } catch (error) {
          if (generation !== this.generation || !this.items.includes(item)) return;
          this.remove(item.id);
          this.options.error(
            validating && error instanceof Error
              ? error.message
              : '파일을 읽지 못했습니다. 파일 접근 권한과 원본을 확인한 뒤 다시 첨부해 주세요.',
          );
        }
        this.render();
      }),
    );
  }
  snapshot(): AttachmentSnapshot {
    if (this.reading) throw new Error('첨부 파일을 읽는 중입니다.');
    return {
      ids: this.items.map((item) => item.id),
      inputs: this.items.map((item) => ({
        name: item.file.name,
        mime: item.mime,
        data: item.data!,
      })),
      label: this.items
        .map((item) => `첨부: ${item.file.name} (${attachmentSize(item.file.size)})`)
        .join('\n'),
    };
  }
  remove(id: number): void {
    const item = this.items.find((item) => item.id === id);
    if (item?.preview) URL.revokeObjectURL(item.preview);
    this.items = this.items.filter((item) => item.id !== id);
    this.render();
  }
  consume(ids: readonly number[]): void {
    for (const id of ids) this.remove(id);
  }
  reset(): void {
    this.generation++;
    for (const item of this.items) if (item.preview) URL.revokeObjectURL(item.preview);
    this.items = [];
    this.render();
  }
  private render(): void {
    this.list.replaceChildren();
    this.list.hidden = !this.items.length;
    for (const item of this.items) {
      const row = document.createElement('div');
      row.className = 'attachment';
      if (item.preview) {
        const image = document.createElement('img');
        image.src = item.preview;
        image.alt = '';
        row.append(image);
      }
      const label = document.createElement('span');
      label.textContent = `${item.file.name} · ${attachmentSize(item.file.size)}${item.data ? '' : ' · 읽는 중…'}`;
      row.append(label);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `${item.file.name} 첨부 제거`);
      remove.onclick = () => this.remove(item.id);
      row.append(remove);
      this.list.append(row);
    }
    this.options.changed();
  }
}
