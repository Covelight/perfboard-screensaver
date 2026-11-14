#!/usr/bin/env python3
"""Static server for the perfboard clock preview.

Plain `python3 -m http.server` validates If-Modified-Since, so a browser that
already pulled an earlier build happily keeps showing the cached copy. This
serves the same folder with `Cache-Control: no-store` so every reload gets the
current index.html, and binds 0.0.0.0 so the sandbox preview proxy can reach it.
"""
import http.server
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))
        sys.stderr.flush()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    os.chdir(ROOT)
    with Server(("0.0.0.0", PORT), Handler) as httpd:
        print("serving %s on http://0.0.0.0:%d (no-store)" % (ROOT, PORT), flush=True)
        httpd.serve_forever()
