import importlib.util
import sys
import types
import unittest
from unittest.mock import patch
import urllib.error
from pathlib import Path
if sys.platform == 'win32':
    sys.modules['fcntl'] = types.SimpleNamespace()
spec = importlib.util.spec_from_file_location('collector', Path(__file__).with_name('collector.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

class CollectorTests(unittest.TestCase):
    def test_honest_app_identifier_is_used_only_for_our_server(self):
        captured=[]
        class Response:
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def read(self,limit): return b'{}'
        class Opener:
            def open(self,req,timeout):
                captured.append(req)
                return Response()
        with patch.object(c.urllib.request,'build_opener',return_value=Opener()):
            c.request(c.SERVER+'/api/mobile-news/claim',{},'test-token')
            c.request('https://news.google.com/rss/search?q=test')
        self.assertEqual(captured[0].get_header('User-agent'),'PowerEditorAndroidCollector/1.0')
        self.assertIsNone(captured[1].get_header('User-agent'))
        self.assertIsNone(captured[1].get_header('Authorization'))

    def test_idle_never_contacts_google(self):
        calls=[]
        def http(*args):
            calls.append(args)
            return {'jobs': []}
        self.assertEqual(c.collect({'token':'test'}, http)['googleRequests'], 0)
        self.assertEqual(len(calls), 1)

    def test_success_has_no_auth_on_google_and_posts_xml_to_fixed_server(self):
        calls=[]
        def http(url, data=None, token=None):
            calls.append((url,data,token))
            if url.endswith('/claim'):
                return {'leaseId':'lease','jobs':[{'category':'power','url':'https://news.google.com/rss/search?q=power'}]}
            if data is None:
                self.assertIsNone(token)
                return '<rss><channel/></rss>'
            self.assertEqual(token, 'secret')
            return {'accepted': True, 'count': 0}
        self.assertEqual(c.collect({'token':'secret'}, http)['status'], 'ok')
        self.assertEqual(len(calls), 3)

    def test_503_stops_remaining_queries(self):
        google=[]
        def http(url, data=None, token=None):
            if url.endswith('/claim'):
                return {'leaseId':'lease','jobs':[{'category':x,'url':'https://news.google.com/rss/search?q='+x} for x in ['power','kepco','outage']]}
            if data is None:
                google.append(url)
                raise urllib.error.HTTPError(url,503,'Unavailable',{},None)
            self.assertEqual(data['error'], 'http_503')
            return {'accepted':True}
        self.assertEqual(c.collect({'token':'secret'},http)['status'],'http_503')
        self.assertEqual(len(google),1)

    def test_untrusted_job_url_is_rejected(self):
        for url in ['http://news.google.com/rss/search','https://news.google.com.evil.test/rss/search','https://news.google.com:443/rss/search','https://evil.test/rss/search','https://news.google.com/articles/test']:
            with self.assertRaises(ValueError):
                c.validate_job({'category':'power','url':url})

if __name__ == '__main__':
    unittest.main()
