#!/data/data/com.termux/files/usr/bin/bash
set -eu
python - <<'PY'
from pathlib import Path
import os
import urllib.request
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None
root = Path.home() / '.power-editor-setup'
root.mkdir(mode=0o700, exist_ok=True)
os.chmod(root, 0o700)
base = 'https://power-editor-design-1031.ycshinbass.chatgpt.site/collector/'
opener = urllib.request.build_opener(NoRedirect)
for name in ['collector.py', 'install.sh', 'start.sh', 'stop.sh', 'README.md']:
    request = urllib.request.Request(base + name, headers={'User-Agent': 'PowerEditorAndroidCollector/1.0'})
    with opener.open(request, timeout=30) as response:
        if response.status != 200:
            raise SystemExit('다운로드 실패: ' + name)
        data = response.read(65537)
    if not data or len(data) > 65536:
        raise SystemExit('파일 크기 오류: ' + name)
    temporary = root / (name + '.tmp')
    temporary.write_bytes(data)
    os.chmod(temporary, 0o600)
    temporary.replace(root / name)
print('프로그램 다운로드 완료')
print('아직 서버 연결이나 자동 예약을 시작하지 않았습니다.')
PY
