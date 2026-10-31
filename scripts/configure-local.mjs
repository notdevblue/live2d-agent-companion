import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const endpoint = value('--endpoint');
const agentId = value('--profile') ?? 'default';
const sessionId = value('--session');
if (
  !endpoint ||
  !sessionId ||
  !/^[a-zA-Z0-9_.-]{1,64}$/.test(agentId) ||
  !/^[a-zA-Z0-9_.-]{1,256}$/.test(sessionId)
)
  throw new Error(
    '--endpoint, --profile, --session을 지정하세요. 키·비밀번호는 인자로 받지 않습니다.',
  );
const url = new URL(endpoint);
if (
  url.protocol !== 'ssh:' ||
  !url.username ||
  url.password ||
  url.search ||
  url.hash ||
  url.port ||
  !/^[a-zA-Z0-9_.-]+$/.test(url.hostname) ||
  !/^[a-zA-Z0-9_-]+$/.test(url.username) ||
  !['', '/'].includes(url.pathname)
)
  throw new Error('SSH 주소 형식이 올바르지 않습니다.');
const directory = resolve(import.meta.dirname, '../local-assets');
await mkdir(directory, { recursive: true, mode: 0o700 });
await writeFile(
  resolve(directory, 'connection.json'),
  JSON.stringify(
    { provider: 'hermes', endpoint: url.toString().replace(/\/+$/, ''), agentId, sessionId },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log('로컬 전용 연결 설정을 준비했습니다. 인증키는 앱의 보호 저장소 입력을 사용하세요.');
