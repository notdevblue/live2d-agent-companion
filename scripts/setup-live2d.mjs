import { mkdir, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const commit = '198a3769c26ca3d7b600e932590433badd392edd'; // Official 5-r.5
const coreUrl = 'https://cubism.live2d.com/sdk-web/core/06/live2dcubismcore.min.js';
const coreSha = '8741f739779b5d5210872bd3d7d99f0f1e56e6c87409e7d26d6bb4b80aa1ef47';
console.log('로컬 개발용 Cubism 런타임 준비. SDK/Core는 저장소나 배포물에 포함하지 않습니다.');
console.log(
  '라이선스: https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html',
);
await mkdir(resolve(root, 'vendor/core'), { recursive: true });
const framework = resolve(root, 'vendor/framework');
try {
  await access(framework);
} catch {
  execFileSync(
    'git',
    ['clone', '--no-checkout', 'https://github.com/Live2D/CubismWebFramework.git', framework],
    { stdio: 'inherit' },
  );
  execFileSync('git', ['-C', framework, 'checkout', '--detach', commit], { stdio: 'inherit' });
}
if (
  execFileSync('git', ['-C', framework, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !==
  commit
)
  throw new Error('Framework 버전 불일치. vendor/framework를 별도로 보존한 후 다시 준비하세요.');
const response = await fetch(coreUrl, {
  headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.live2d.com/' },
  signal: AbortSignal.timeout(30000),
});
if (!response.ok)
  throw new Error(
    `공식 Core 다운로드 실패 (${response.status}). 공식 SDK에서 Core 파일을 준비하세요.`,
  );
const core = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(core).digest('hex') !== coreSha)
  throw new Error('공식 Core 해시가 바뀌었습니다. 버전·라이선스 재검토가 필요합니다.');
await writeFile(resolve(root, 'vendor/core/live2dcubismcore.min.js'), core);
console.log('공식 Framework/Core 버전과 해시 확인 완료.');
