import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { parseEnv } from 'node:util';

export class EnvKeyError extends Error {}

/** Explicit user-owned local file only; never exports values into process.env. */
export async function readJevEnv(path: string): Promise<string | undefined> {
  let file;
  try {
    file = await open(
      path,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    );
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return undefined;
    throw new EnvKeyError('Jev .env 파일을 읽을 수 없습니다. 파일 경로와 소유권을 확인하세요.');
  }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 64 * 1024)
      throw new EnvKeyError('Jev .env 파일 형식 또는 크기가 올바르지 않습니다.');
    if (
      process.platform !== 'win32' &&
      ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.())
    )
      throw new EnvKeyError('Jev .env 파일은 현재 사용자 소유와 권한 600이 필요합니다.');
    const text = (await file.readFile('utf8')).replace(/^\uFEFF/, '').trim();
    if (Buffer.byteLength(text) > 64 * 1024)
      throw new EnvKeyError('Jev .env 파일 크기 제한을 초과했습니다.');
    let key: string | undefined;
    let hasAssignments = false;
    if (/^apikey_[A-Za-z0-9_]+$/.test(text)) key = text;
    else {
      const values = parseEnv(text);
      hasAssignments = Object.keys(values).length > 0;
      const primary = values.JEV_API_KEY?.trim();
      const alias = values.TYPESAFE_API_KEY?.trim();
      if (primary && alias && primary !== alias)
        throw new EnvKeyError('Jev .env 파일에 서로 다른 키가 중복 지정됐습니다.');
      key = primary || alias;
    }
    if (!key) {
      if (
        hasAssignments ||
        !text ||
        text.split('\n').every((line) => !line.trim() || line.trim().startsWith('#'))
      )
        return undefined;
      throw new EnvKeyError(
        'Jev .env에는 JEV_API_KEY, TYPESAFE_API_KEY 또는 키 한 줄을 지정하세요.',
      );
    }
    if (key.length > 8000 || !/^[\x21-\x7e]+$/.test(key))
      throw new EnvKeyError('Jev .env 키 형식이 올바르지 않습니다.');
    return key;
  } catch (error) {
    if (error instanceof EnvKeyError) throw error;
    throw new EnvKeyError('Jev .env 파일을 읽을 수 없습니다. 형식과 권한을 확인하세요.');
  } finally {
    await file.close();
  }
}
