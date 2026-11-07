from pathlib import Path
import json,re
root=Path(__file__).resolve().parents[1]
html=(root/'frontend/index.html').read_text();js=(root/'frontend/app.js').read_text()
ids=re.findall(r'id="([^"]+)"',html);assert len(ids)==len(set(ids))
manifest=json.loads((root/'.openai/hosting.json').read_text());assert manifest['project_id']=='appgprj_6ae5ecde3fb88191ba63844a0af4de81';assert 'static' not in manifest
assert (root/'dist/server/index.js').exists();assert 'api/briefing' in (root/'worker/index.js').read_text()
assert 'Notification.requestPermission' not in js
assert '공식 한전 서비스 아님' in html
print('PASS: source IDs, preserved Site identity, Worker migration, no automatic push permission request in app startup')
