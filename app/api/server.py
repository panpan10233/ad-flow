"""HTTP 服务器：ThreadingHTTPServer + 静态托管 + CORS + 安全拦截。

- 监听 0.0.0.0:8788
- 静态根目录固定为 app/static
- 拦截 /.env* 与 *.py，杜绝密钥与源码下发
"""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from . import router
from ..config import ROOT
from ..execution import ExecutionStore

STATIC_ROOT = (ROOT / "app" / "static").resolve()
PORT = 8788
STORE = ExecutionStore()

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, payload, ctype):
        body = payload.encode("utf-8") if isinstance(payload, str) else payload
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _json(self, code, data):
        self._send(code, json.dumps(data, ensure_ascii=False), "application/json; charset=utf-8")

    def _body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return {}
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def do_OPTIONS(self):
        self._send(204, b"", "application/json; charset=utf-8")

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def _dispatch(self, method):
        try:
            u = urlparse(self.path)
            path = unquote(u.path)

            if path.startswith("/api/"):
                body = self._body() if method == "POST" else {}
                status, data = router.handle(method, path, parse_qs(u.query), body, STORE)
                if isinstance(data, str):
                    self._send(status, data, "text/csv; charset=utf-8")
                else:
                    self._json(status, data)
                return

            # 密钥文件与源码绝不下发
            if path.startswith("/.env") or path.lower().endswith(".py"):
                self._json(403, {"error": "forbidden"})
                return

            if path in ("", "/"):
                path = "/index.html"
            target = (STATIC_ROOT / path.lstrip("/")).resolve()
            if not (target == STATIC_ROOT or STATIC_ROOT in target.parents):
                self._json(403, {"error": "forbidden"})
                return
            if not target.is_file():
                self._json(404, {"error": "not found"})
                return
            self._send(200, target.read_bytes(), MIME.get(target.suffix.lower(), "application/octet-stream"))
        except Exception as e:
            self._json(500, {"ok": False, "error": str(e)})

    def log_message(self, fmt, *args):
        pass  # 静默访问日志，避免刷屏


def run(host="0.0.0.0", port=PORT):
    server = ThreadingHTTPServer((host, port), Handler)
    print("\n  智投引擎 AdFlow · Python 后端已启动")
    print(f"  ➜  本地访问: http://localhost:{port}")
    print(f"  ➜  静态目录: {STATIC_ROOT}")
    print("  ➜  密钥文件: .env.local.json（仅存服务端，不会下发前端）")
    print("  ➜  按 Ctrl+C 停止\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
