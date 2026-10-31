import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalEndpoint } from '../shared/validation.js';

export class JsonFile {
  private queue: Promise<void> = Promise.resolve();
  constructor(
    private readonly directory: string,
    private readonly name: string,
  ) {}
  async read(): Promise<unknown> {
    try {
      return await this.readStrict();
    } catch {
      return undefined;
    }
  }
  async readStrict(): Promise<unknown> {
    try {
      const text = await readFile(join(this.directory, this.name), 'utf8');
      if (text.length > 2_000_000) throw new Error('저장 데이터 크기 제한을 초과했습니다.');
      return JSON.parse(text);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        return undefined;
      throw error;
    }
  }
  write(value: unknown): Promise<void> {
    const text = JSON.stringify(value);
    if (text.length > 2_000_000)
      return Promise.reject(new Error('저장 데이터 크기 제한을 초과했습니다.'));
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        const target = join(this.directory, this.name);
        await writeFile(`${target}.tmp`, text, { mode: 0o600 });
        await rename(`${target}.tmp`, target);
      });
    return this.queue;
  }
  async flush(): Promise<void> {
    await this.queue;
  }
}
export interface Encryption {
  available(): Promise<boolean>;
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<string>;
}
export function credentialScope(provider: string, endpoint = ''): string {
  return provider === 'jev'
    ? 'jev:https://api.typesafe.ai'
    : `${provider}:${createHash('sha256').update(canonicalEndpoint(endpoint)).digest('hex')}`;
}
export class CredentialVault {
  private encrypted: Record<string, string> = {};
  private memory = new Map<string, string>();
  secure = false;
  constructor(
    private readonly file: JsonFile,
    private readonly encryption: Encryption,
  ) {}
  async initialize(): Promise<void> {
    this.secure = await this.encryption.available();
    const raw = await this.file.read();
    if (raw && typeof raw === 'object' && !Array.isArray(raw))
      for (const [key, value] of Object.entries(raw))
        if (typeof value === 'string' && value.length < 30000) this.encrypted[key] = value;
  }
  async has(scope: string): Promise<boolean> {
    return Boolean(await this.get(scope));
  }
  async get(scope: string): Promise<string> {
    if (this.memory.has(scope)) return this.memory.get(scope)!;
    const value = this.encrypted[scope];
    if (!value || !this.secure) return '';
    try {
      return await this.encryption.decrypt(Buffer.from(value, 'base64'));
    } catch {
      return '';
    }
  }
  async set(scope: string, value: string): Promise<void> {
    if (value.length > 8000 || /[\r\n\x00]/.test(value))
      throw new Error('인증 정보 형식이 올바르지 않습니다.');
    if (!this.secure) {
      if (value) this.memory.set(scope, value);
      else this.memory.delete(scope);
      return;
    }
    if (value) this.encrypted[scope] = (await this.encryption.encrypt(value)).toString('base64');
    else delete this.encrypted[scope];
    await this.file.write(this.encrypted);
  }
}
