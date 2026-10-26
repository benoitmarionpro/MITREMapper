# Serveur de développement sans cache : python tools/serve.py [port]
# Évite que le navigateur (Firefox en particulier) garde d'anciens modules JS après une modification.
import http.server, os, sys

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
print(f'MITREMapper : http://localhost:{port}  (sans cache, Ctrl+C pour arrêter)')
http.server.ThreadingHTTPServer(('127.0.0.1', port), NoCache).serve_forever()
