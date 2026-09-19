#!/usr/bin/env python3
"""Русское поле — local/shared server, Python 3.9+, standard library only."""
import argparse
import json
import mimetypes
import re
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

WORLD = "russkoe-pole-v1"
LIMIT = 2_000_000_000
ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "field.sqlite3"
WAKE = threading.Condition()
WRITE_LOCK = threading.Lock()

def hash32(x, y, salt=0):
    n = (x * 374761393 + y * 668265263 + salt * 1442695041) & 0xffffffff
    n = ((n ^ (n >> 13)) * 1274126177) & 0xffffffff
    return (n ^ (n >> 16)) & 0xffffffff

def default_on(x, y):
    return hash32(x, y, 7) / 4294967296 >= .022 and hash32(x, y, 97) / 4294967296 < .43

def connection():
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    return db

def initialize():
    with connection() as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
        INSERT OR IGNORE INTO meta VALUES ('revision', 0);
        CREATE TABLE IF NOT EXISTS cells (
            x INTEGER NOT NULL, y INTEGER NOT NULL, is_on INTEGER NOT NULL,
            revision INTEGER NOT NULL, PRIMARY KEY(x,y));
        CREATE TABLE IF NOT EXISTS operations (
            operation TEXT PRIMARY KEY, x INTEGER NOT NULL, y INTEGER NOT NULL,
            is_on INTEGER NOT NULL, revision INTEGER NOT NULL UNIQUE);
        CREATE INDEX IF NOT EXISTS operation_revision ON operations(revision);
        """)

def revision(db):
    return db.execute("SELECT value FROM meta WHERE key='revision'").fetchone()[0]

def record(row):
    value = {"x": row["x"], "y": row["y"], "on": bool(row["is_on"]), "revision": row["revision"]}
    if "operation" in row.keys():
        value["operation"] = row["operation"]
    return value

def get_bounds(query):
    values = tuple(int(query[k][0]) for k in ("x0", "x1", "y0", "y1"))
    x0, x1, y0, y1 = values
    if any(abs(n) > LIMIT for n in values) or x1 < x0 or y1 < y0 or (x1-x0+1)*(y1-y0+1) > 4194304:
        raise ValueError("Invalid viewport")
    return values

def toggle_cell(x, y, operation):
    # BEGIN IMMEDIATE serializes concurrent toggles. An operation id is retry-safe.
    with WRITE_LOCK, connection() as db:
        db.execute("BEGIN IMMEDIATE")
        old = db.execute("SELECT * FROM operations WHERE operation=?", (operation,)).fetchone()
        if old:
            if old["x"] != x or old["y"] != y:
                raise ValueError("Operation id reused")
            return record(old)
        row = db.execute("SELECT is_on FROM cells WHERE x=? AND y=?", (x, y)).fetchone()
        on = not (bool(row[0]) if row else default_on(x, y))
        rev = revision(db) + 1
        db.execute("UPDATE meta SET value=? WHERE key='revision'", (rev,))
        db.execute("INSERT INTO cells VALUES(?,?,?,?) ON CONFLICT(x,y) DO UPDATE SET is_on=excluded.is_on, revision=excluded.revision", (x, y, int(on), rev))
        db.execute("INSERT INTO operations VALUES(?,?,?,?,?)", (operation, x, y, int(on), rev))
    with WAKE:
        WAKE.notify_all()
    return {"x": x, "y": y, "on": on, "revision": rev, "operation": operation}

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "RusskoePole/1"

    def log_message(self, fmt, *args):
        if args and str(args[0]).startswith("GET /api/events"):
            return
        super().log_message(fmt, *args)

    def json_response(self, value, status=200):
        data = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if status >= 400:
            self.close_connection = True
            self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlsplit(self.path)
        try:
            if url.path == "/api/meta":
                return self.json_response({"world": WORLD})
            if url.path == "/api/cells":
                bounds = get_bounds(parse_qs(url.query))
                with connection() as db:
                    # The revision and rows must come from the same SQLite snapshot.
                    db.execute("BEGIN")
                    rev = revision(db)
                    rows = db.execute("SELECT * FROM cells WHERE x BETWEEN ? AND ? AND y BETWEEN ? AND ?", bounds).fetchall()
                return self.json_response({"revision": rev, "cells": [record(r) for r in rows]})
            if url.path == "/api/events":
                query = parse_qs(url.query)
                bounds = get_bounds(query)
                since = max(0, int(query.get("since", ["0"])[0]))
                try:
                    since = max(since, int(self.headers.get("Last-Event-ID", "0")))
                except ValueError:
                    pass
                return self.events(bounds, since)
            # Serve only the finished artwork. Never expose the SQLite database or source.
            if url.path in ("/", "/index.html", "/russkoe-pole.html"):
                file = ROOT / "index.html"
                data = file.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-cache")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                self.wfile.write(data)
                return
            self.json_response({"error": "Not found"}, 404)
        except (ValueError, KeyError):
            self.json_response({"error": "Invalid parameters"}, 400)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_POST(self):
        if urlsplit(self.path).path != "/api/toggle":
            return self.json_response({"error": "Not found"}, 404)
        # Prevent other websites from issuing state-changing requests to this server.
        origin = self.headers.get("Origin")
        if origin and urlsplit(origin).netloc != self.headers.get("Host"):
            return self.json_response({"error": "Wrong origin"}, 403)
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return self.json_response({"error": "JSON required"}, 415)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 1024:
                raise ValueError("Invalid body size")
            body = json.loads(self.rfile.read(length))
            x, y, op = body["x"], body["y"], body["id"]
            if type(x) is not int or type(y) is not int or abs(x) > LIMIT or abs(y) > LIMIT:
                raise ValueError("Invalid coordinates")
            if not isinstance(op, str) or not re.fullmatch(r"[A-Za-z0-9-]{10,100}", op):
                raise ValueError("Invalid operation")
            if hash32(x, y, 7) / 4294967296 < .022:
                return self.json_response({"error": "No window"}, 422)
            return self.json_response(toggle_cell(x, y, op))
        except (ValueError, KeyError, TypeError):
            self.json_response({"error": "Invalid toggle"}, 400)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def events(self, bounds, since):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        self.connection.settimeout(20)
        last_heartbeat = 0
        try:
            while True:
                with connection() as db:
                    db.execute("BEGIN")
                    now_rev = revision(db)
                    rows = db.execute("SELECT * FROM operations WHERE revision>? AND revision<=? AND x BETWEEN ? AND ? AND y BETWEEN ? AND ? ORDER BY revision LIMIT 2000", (since, now_rev, *bounds)).fetchall()
                if len(rows) == 2000:
                    self.wfile.write(b"event: reset\ndata: {}\n\n")
                    self.wfile.flush()
                    break
                for row in rows:
                    data = json.dumps(record(row), separators=(",", ":"))
                    self.wfile.write(f"id: {row['revision']}\nevent: cell\ndata: {data}\n\n".encode())
                since = now_rev
                if rows or time.monotonic()-last_heartbeat > 10:
                    self.wfile.write(f"id: {since}\nevent: heartbeat\ndata: {{}}\n\n".encode())
                    self.wfile.flush()
                    last_heartbeat = time.monotonic()
                with WAKE:
                    WAKE.wait(timeout=1)
        except (BrokenPipeError, ConnectionResetError, TimeoutError, OSError):
            pass
        self.close_connection = True

def main():
    global DB_PATH
    parser = argparse.ArgumentParser(description="Русское поле — общая карта")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--database", type=Path, default=DB_PATH)
    parser.add_argument("--strictPort", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    DB_PATH = args.database.resolve()
    initialize()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    print(f"Русское поле: http://{args.host}:{args.port}", flush=True)
    print(f"Состояния окон: {DB_PATH}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nПоле сохранено.")
    finally:
        server.server_close()

if __name__ == "__main__":
    main()
