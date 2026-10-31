import { constants } from 'node:fs';
import { access, lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

if (process.platform !== 'linux') throw new Error('Linux 데스크톱에서만 설치할 수 있습니다.');

const project = resolve(import.meta.dirname, '..');
const electron = join(project, 'node_modules/electron/dist/electron');
const home = homedir();
if (!isAbsolute(home)) throw new Error('HOME은 절대 경로여야 합니다.');
const data = isAbsolute(process.env.XDG_DATA_HOME ?? '')
  ? process.env.XDG_DATA_HOME
  : join(home, '.local/share');
const launcher = join(home, '.local/bin/live2d-companion');
const desktop = join(data, 'applications/live2d-agent-companion.desktop');
const icon = join(data, 'icons/hicolor/scalable/apps/live2d-agent-companion.svg');
const marker = 'Managed by live2d-agent-companion install-desktop';

if (!(await lstat(join(project, 'dist/main/index.js'))).isFile()) {
  throw new Error('npm run build로 앱을 먼저 빌드하세요.');
}
await access(electron, constants.X_OK);

// Shell quoting and Desktop Entry string/Exec escaping are distinct layers.
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const desktopString = (value) =>
  value
    .replaceAll('\\', '\\\\')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t');
const desktopExec = (value) =>
  desktopString(`"${value.replace(/[\\"`$]/g, '\\$&').replaceAll('%', '%%')}"`);

const files = [
  {
    path: launcher,
    mode: 0o755,
    content: `#!/bin/sh
# ${marker}
# This launcher follows this development checkout; reinstall after moving it.
umask 077
companion_state="\${XDG_STATE_HOME:-$HOME/.local/state}/live2d-agent-companion"
case "$companion_state" in /*) ;; *) companion_state="$HOME/.local/state/live2d-agent-companion" ;; esac
mkdir -p "$companion_state" || exit 1
exec >>"$companion_state/launcher.log" 2>&1
cd ${shellQuote(project)} || exit 1
unset ELECTRON_RUN_AS_NODE
exec ${shellQuote(electron)} ${shellQuote(project)} --class=live2d-agent-companion "$@"
`,
  },
  {
    path: desktop,
    mode: 0o644,
    content: `[Desktop Entry]
# ${marker}
Type=Application
Name=Live2D Companion
GenericName=Live2D Desktop Companion
Comment=Live2D 캐릭터와 대화
Exec=${desktopExec(launcher)}
Path=${desktopString(project)}
TryExec=${desktopString(launcher)}
Icon=live2d-agent-companion
Terminal=false
Categories=Utility;
Keywords=Live2D;Hermes;Companion;캐릭터;
StartupNotify=false
StartupWMClass=live2d-agent-companion
`,
  },
  {
    path: icon,
    mode: 0o644,
    content: await readFile(join(project, 'assets/companion.svg'), 'utf8'),
  },
];

// Validate every destination before replacing any file, including symlinks.
for (const file of files) {
  let existing;
  try {
    existing = await lstat(file.path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (existing && (!existing.isFile() || !(await readFile(file.path, 'utf8')).includes(marker))) {
    throw new Error(`앱이 관리하지 않는 경로를 덮어쓰지 않습니다: ${file.path}`);
  }
}

for (const file of files) {
  await mkdir(dirname(file.path), { recursive: true });
  const temporary = `${file.path}.${process.pid}.tmp`;
  const handle = await open(temporary, 'wx', file.mode);
  try {
    await handle.writeFile(file.content);
    await rename(temporary, file.path);
  } finally {
    await handle.close();
    await rm(temporary, { force: true });
  }
  console.log(file.path);
}
console.log('설치 완료: rofi의 drun에서 Live2D Companion을 실행하세요.');
