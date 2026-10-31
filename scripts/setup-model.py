"""Prepare user-owned runtime files only; preserve source archive and never copy PSD."""
from pathlib import Path, PurePosixPath
from zipfile import ZipFile
import sys

root = Path(__file__).resolve().parent.parent
archive = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else next(iter((Path.home() / 'Downloads').glob('DeepSeek-chan*.zip')), None)
if not archive:
    raise SystemExit('DeepSeek-chan ZIP을 찾을 수 없습니다. npm run setup:model -- /path/to/model.zip')
target = root / 'local-assets' / 'DeepSeek'
target.mkdir(parents=True, exist_ok=True)
with ZipFile(archive) as source:
    entries = source.infolist()
    runtime = []
    for entry in entries:
        parts = PurePosixPath(entry.filename).parts
        if '..' in parts or entry.filename.startswith('/') or any(char in entry.filename for char in ('\\', ':', '\x00')):
            raise SystemExit('안전하지 않은 ZIP 경로')
        if 'DeepSeek' in parts and not entry.is_dir():
            relative = PurePosixPath(*parts[parts.index('DeepSeek') + 1:])
            if relative.suffix.lower() in ('.json', '.moc3', '.png'):
                runtime.append((entry, relative))
    if len(runtime) > 300 or sum(entry.file_size for entry, _ in runtime) > 300 * 1024 * 1024:
        raise SystemExit('모델 자산 크기 제한 초과')
    for entry, relative in runtime:
        destination = target / str(relative)
        if not target.resolve().is_relative_to((root / 'local-assets').resolve()) or not destination.resolve().is_relative_to(target.resolve()):
            raise SystemExit('선택 디렉터리 바깥으로 연결된 자산 경로')
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(source.read(entry))
    terms = next((e for e in entries if 'Terms of Use' in e.filename and e.file_size < 100000), None)
    if terms:
        (target / 'TERMS.txt').write_bytes(source.read(terms))
print(f'로컬 전용 모델 준비: {len(runtime)}개 파일 → {target}')
print('모델과 SDK를 Git/배포물에 포함하지 마세요. 공개 시 원 저작자 출처를 표기하세요.')
