#!/usr/bin/env python3
"""Power Editor personal Android collector. Python stdlib only; no AI/body fetch."""
import argparse
import fcntl
import getpass
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path.home() / '.power-editor-collector'
SERVER = 'https://power-editor-design-1031.ycshinbass.chatgpt.site'
LIMIT = 750000

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def request(url, data=None, token=None):
    headers = {'Accept': 'application/json' if data is not None else 'application/rss+xml'}
    # Identify our own client to our hosting edge. Preserve the already tested
    # default Python request on Google; do not impersonate a browser.
    if urllib.parse.urlsplit(url).netloc == urllib.parse.urlsplit(SERVER).netloc:
        headers['User-Agent'] = 'PowerEditorAndroidCollector/1.0'
    if token:
        headers['Authorization'] = 'Bearer ' + token
    payload = None if data is None else json.dumps(data).encode()
    if payload is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=payload, headers=headers)
    with urllib.request.build_opener(NoRedirect).open(req, timeout=30) as response:
        body = response.read(LIMIT + 1)
        if len(body) > LIMIT:
            raise ValueError('response_limit')
        return json.loads(body) if data is not None else body.decode('utf-8-sig')

def validate_job(job):
    u = urllib.parse.urlsplit(job['url'])
    if (job.get('category') not in ('kepco', 'power', 'outage') or
        u.scheme != 'https' or u.netloc != 'news.google.com' or
        u.path != '/rss/search' or u.fragment):
        raise ValueError('invalid_job')

def collect(config, http=request, clock=time.time, pause=time.sleep):
    token = config['token']
    batch = http(SERVER + '/api/mobile-news/claim', {}, token)
    jobs = batch.get('jobs', [])
    if not jobs:
        return {'status': 'idle', 'googleRequests': 0}
    if len(jobs) > 3 or not isinstance(batch.get('leaseId'), str):
        raise ValueError('invalid_batch')
    for job in jobs:
        validate_job(job)
    results = []
    for job in jobs:
        if results:
            pause(3)
        payload = {'leaseId': batch['leaseId'], 'category': job['category']}
        try:
            xml = http(job['url'])
            if len(xml.encode()) > LIMIT or ('<rss' not in xml and '<feed' not in xml):
                raise ValueError('invalid_feed')
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as error:
            code = 'http_' + str(error.code) if isinstance(error, urllib.error.HTTPError) else 'fetch_failed'
            http(SERVER + '/api/mobile-news/result', {**payload, 'error': code}, token)
            return {'status': code, 'googleRequests': len(results) + 1}
        # If upload fails, stop: never repeat Google requests in the same run.
        answer = http(SERVER + '/api/mobile-news/result', {**payload, 'xml': xml}, token)
        if not answer.get('accepted'):
            raise ValueError('upload_rejected')
        results.append({'category': job['category'], 'count': answer.get('count')})
    return {'status': 'ok', 'googleRequests': len(results), 'results': results}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--configure', action='store_true')
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    ROOT.mkdir(mode=0o700, exist_ok=True)
    os.chmod(ROOT, 0o700)
    config_file = ROOT / 'config.json'
    if args.configure:
        token = getpass.getpass('전용 연결키 (화면에 표시되지 않음): ').strip()
        if not 40 <= len(token) <= 100 or not all(c.isalnum() or c in '_-' for c in token):
            raise SystemExit('연결키 형식 오류')
        config_file.write_text(json.dumps({'token': token}))
        os.chmod(config_file, 0o600)
        print('연결 설정 저장 완료. --once로 수신 시험을 하세요.')
        return
    if not config_file.exists():
        raise SystemExit('먼저 --configure로 연결키를 등록하세요.')
    with (ROOT / 'run.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        try:
            result = collect(json.loads(config_file.read_text()))
        except Exception:
            result = {'status': 'connection_failed'}
        result['at'] = time.strftime('%Y-%m-%dT%H:%M:%S%z')
        # One bounded status file; no permanent RSS archive or credentials in logs.
        (ROOT / 'status.json').write_text(json.dumps(result, ensure_ascii=False))
        print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    main()
