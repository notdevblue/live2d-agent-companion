import { randomBytes } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Emotion, Gesture, ModelInventory } from '../shared/contracts.js';
import { SURPRISED_EXPRESSION, THINKING_MOTION } from '../shared/model-mappings.js';

type JsonObject = Record<string, unknown>;
interface LibraryModel {
  root: string;
  token: string;
  manifest: string;
  assets: Map<string, string>;
}
const MAX_JSON = 8 * 1024 * 1024;
const MAX_ASSET = 128 * 1024 * 1024;
const MAX_TOTAL = 512 * 1024 * 1024;
const MAX_FILES = 512;
const object = (input: unknown): input is JsonObject =>
  !!input && typeof input === 'object' && !Array.isArray(input);
const contained = (root: string, file: string): boolean => {
  const rel = path.relative(root, file);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
};
const basename = (file: string): string =>
  path.posix.basename(file).replace(/\.(?:exp3|motion3)\.json$/i, '');
const headers = (type: string): Record<string, string> => ({
  'Content-Type': type,
  'Access-Control-Allow-Origin': 'app://ui',
  'Cross-Origin-Resource-Policy': 'same-site',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'",
});

/** Exposes only validated model dependencies behind a revocable random token. */
export class ModelLibrary {
  private selected?: LibraryModel;

  async load(modelPath: string): Promise<ModelInventory> {
    if (
      typeof modelPath !== 'string' ||
      !modelPath.endsWith('.model3.json') ||
      modelPath.length > 4096
    )
      throw new Error('.model3.json 파일을 선택하세요.');
    const source = await realpath(modelPath);
    const root = path.dirname(source);
    const data = await this.readJson(source);
    if (!object(data) || data.Version !== 3 || !object(data.FileReferences))
      throw new Error('지원하는 Cubism 3 모델 manifest가 아닙니다.');
    const refs = data.FileReferences;
    if (
      typeof refs.Moc !== 'string' ||
      !Array.isArray(refs.Textures) ||
      refs.Textures.length === 0 ||
      !refs.Textures.every((item) => typeof item === 'string')
    )
      throw new Error('모델 Core 또는 texture 참조가 없습니다.');
    const allowedKeys = new Set([
      'Moc',
      'Textures',
      'Physics',
      'Pose',
      'UserData',
      'DisplayInfo',
      'Expressions',
      'Motions',
    ]);
    for (const key of Object.keys(refs))
      if (!allowedKeys.has(key)) throw new Error('알 수 없는 모델 파일 참조입니다.');
    if (
      refs.Expressions === undefined ||
      (Array.isArray(refs.Expressions) && refs.Expressions.length === 0)
    ) {
      refs.Expressions = (await this.discover(root, 'Exp3', '.exp3.json')).map((file) => ({
        Name: basename(file),
        File: file,
      }));
    }
    if (
      refs.Motions === undefined ||
      (object(refs.Motions) && Object.keys(refs.Motions).length === 0)
    ) {
      const discovered = await this.discover(root, 'Animation', '.motion3.json');
      const idle = discovered.filter((file) => /(?:^|\/)IDLE\.motion3\.json$/i.test(file));
      const others = discovered.filter((file) => !idle.includes(file));
      refs.Motions = {
        ...(idle.length ? { Idle: idle.map((File) => ({ File })) } : {}),
        ...(others.length ? { Gestures: others.map((File) => ({ File })) } : {}),
      };
    }
    if (!Array.isArray(refs.Expressions) || !object(refs.Motions))
      throw new Error('표정 또는 모션 목록이 올바르지 않습니다.');
    const names = new Set<string>();
    const expressions: string[] = [];
    const motions: string[] = [];
    const references: string[] = [refs.Moc, ...(refs.Textures as string[])];
    for (const key of ['Physics', 'Pose', 'UserData', 'DisplayInfo']) {
      if (refs[key] !== undefined) {
        if (typeof refs[key] !== 'string') throw new Error('모델 파일 참조가 올바르지 않습니다.');
        references.push(refs[key]);
      }
    }
    for (const entry of refs.Expressions) {
      if (
        !object(entry) ||
        typeof entry.Name !== 'string' ||
        !entry.Name ||
        entry.Name.length > 200 ||
        typeof entry.File !== 'string' ||
        names.has(entry.Name)
      )
        throw new Error('표정 참조가 올바르지 않습니다.');
      names.add(entry.Name);
      expressions.push(entry.Name);
      references.push(entry.File);
    }
    names.clear();
    for (const entries of Object.values(refs.Motions)) {
      if (!Array.isArray(entries)) throw new Error('모션 그룹이 올바르지 않습니다.');
      for (const entry of entries) {
        if (!object(entry) || typeof entry.File !== 'string')
          throw new Error('모션 참조가 올바르지 않습니다.');
        const name = basename(entry.File);
        if (!names.has(name)) {
          names.add(name);
          motions.push(name);
        }
        references.push(entry.File);
        if (entry.Sound !== undefined) {
          if (typeof entry.Sound !== 'string')
            throw new Error('모션 오디오 참조가 올바르지 않습니다.');
          references.push(entry.Sound);
        }
      }
    }
    const assets = new Map<string, string>();
    let total = 0;
    if (references.length > MAX_FILES) throw new Error('모델 파일 개수 제한을 초과했습니다.');
    for (const ref of references) {
      if (assets.has(ref)) continue;
      const file = await this.resolveAsset(root, ref);
      const info = await stat(file);
      total += info.size;
      if (total > MAX_TOTAL) throw new Error('모델 전체 크기 제한을 초과했습니다.');
      if (file.endsWith('.json')) await this.readJson(file);
      assets.set(ref, file);
    }
    const parameters: ModelInventory['parameters'] = [];
    if (typeof refs.DisplayInfo === 'string') {
      const display = await this.readJson(assets.get(refs.DisplayInfo)!);
      if (object(display) && Array.isArray(display.Parameters)) {
        if (display.Parameters.length > 10_000)
          throw new Error('모델 파라미터 개수 제한을 초과했습니다.');
        for (const parameter of display.Parameters) {
          if (
            object(parameter) &&
            typeof parameter.Id === 'string' &&
            typeof parameter.Name === 'string' &&
            parameter.Id.length <= 512 &&
            parameter.Name.length <= 512
          )
            parameters.push({ id: parameter.Id, name: parameter.Name });
        }
      }
    }
    const expressionMap: Partial<Record<Emotion, string>> = {
      surprised: SURPRISED_EXPRESSION,
    };
    for (const [emotion, name] of Object.entries({
      happy: '＞＜',
      sad: '流泪',
      embarrassed: '脸红',
      concerned: '流冷汗',
    })) {
      if (expressions.includes(name)) expressionMap[emotion as Emotion] = name;
    }
    const gestureMap: Partial<Record<Gesture, string>> = { thinking: THINKING_MOTION };
    for (const [gesture, name] of Object.entries({
      wave: '默认手切举手',
      explain: '竖手指切出来动画',
    })) {
      if (motions.includes(name)) gestureMap[gesture as Gesture] = name;
    }
    const token = randomBytes(24).toString('base64url');
    this.selected = { root, token, manifest: JSON.stringify(data), assets };
    return {
      url: `app://model/${token}/model.model3.json`,
      name: path.basename(source, '.model3.json'),
      expressions,
      motions,
      parameters,
      expressionMap,
      gestureMap,
    };
  }

  async handle(url: URL): Promise<Response> {
    try {
      const selected = this.selected;
      if (
        !selected ||
        url.protocol !== 'app:' ||
        url.hostname !== 'model' ||
        url.port ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        return this.denied();
      const raw = url.pathname.split('/');
      if (raw.length < 3 || raw[0] !== '' || raw[1] !== selected.token) return this.denied();
      const ref = raw
        .slice(2)
        .map((part) => decodeURIComponent(part))
        .join('/');
      if (ref === 'model.model3.json')
        return new Response(selected.manifest, {
          headers: headers('application/json; charset=utf-8'),
        });
      if (!selected.assets.has(ref)) return this.denied();
      const file = await this.resolveAsset(selected.root, ref);
      if (file !== selected.assets.get(ref)) return this.denied();
      const content = await readFile(file);
      if (content.byteLength > MAX_ASSET) return this.denied();
      const type =
        (
          {
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.webp': 'image/webp',
            '.wav': 'audio/wav',
            '.mp3': 'audio/mpeg',
          } as Record<string, string>
        )[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      return new Response(new Uint8Array(content), { headers: headers(type) });
    } catch {
      return this.denied();
    }
  }

  private async resolveAsset(root: string, ref: string): Promise<string> {
    if (
      !ref ||
      ref.length > 4096 ||
      /[\\:%?#\u0000]/.test(ref) ||
      path.isAbsolute(ref) ||
      path.win32.isAbsolute(ref) ||
      ref.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new Error('안전하지 않은 모델 파일 경로입니다.');
    const file = await realpath(path.join(root, ref));
    if (!contained(root, file)) throw new Error('모델 디렉터리 바깥 파일은 읽을 수 없습니다.');
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_ASSET)
      throw new Error('모델 파일 형식 또는 크기가 올바르지 않습니다.');
    return file;
  }
  private async discover(root: string, directory: string, suffix: string): Promise<string[]> {
    const candidate = path.join(root, directory);
    try {
      const dir = await realpath(candidate);
      if (!contained(root, dir)) throw new Error('모델 디렉터리 바깥의 자산 폴더입니다.');
      const entries = await readdir(dir, { withFileTypes: true });
      if (entries.length > MAX_FILES) throw new Error('모델 파일 개수 제한을 초과했습니다.');
      return entries
        .filter(
          (entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(suffix),
        )
        .map((entry) => `${directory}/${entry.name}`)
        .sort();
    } catch (error) {
      if (object(error) && error.code === 'ENOENT') return [];
      throw error;
    }
  }
  private async readJson(file: string): Promise<unknown> {
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_JSON)
      throw new Error('모델 JSON 파일 크기 제한을 초과했습니다.');
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  }
  private denied(): Response {
    return new Response('모델 자산을 찾을 수 없습니다.', {
      status: 404,
      headers: headers('text/plain; charset=utf-8'),
    });
  }
}
