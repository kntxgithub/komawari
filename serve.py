"""komawari のローカルプレビュー用サーバー。

配信範囲をこのプロジェクト配下だけに限り、127.0.0.1 のみで待ち受ける。
`python -m http.server` と違って、うっかり上位ディレクトリを公開したり
同一ネットワークの他端末から見えたりしない。

使い方: python serve.py [ポート番号]
"""

import http.server
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8137


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # 編集した内容が古いキャッシュに隠れないようにする
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def do_GET(self):
        # .git/ や .claude/ などは配信しない
        if any(part.startswith(".") for part in self.path.split("?")[0].split("/") if part):
            self.send_error(404)
            return
        super().do_GET()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server(("127.0.0.1", PORT), Handler) as httpd:
        print(f"serving {ROOT}")
        print(f"  http://127.0.0.1:{PORT}/")
        httpd.serve_forever()
