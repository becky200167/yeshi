from __future__ import annotations

import json
import math
import secrets
import sqlite3
from pathlib import Path
from typing import Any

from flask import Flask, g, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DB_FILE = DATA_DIR / "night_market.db"
STALLS_JSON_FILE = DATA_DIR / "stalls.json"
SUBMISSIONS_JSON_FILE = DATA_DIR / "submissions.json"
USERS_JSON_FILE = DATA_DIR / "users.json"
REVIEWS_JSON_FILE = DATA_DIR / "reviews.json"
UPLOAD_DIR = DATA_DIR / "uploads"
MAX_UPLOAD_IMAGE_COUNT = 8
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}

app = Flask(__name__)
CORS(app)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024

# Demo token store (in-memory). In production, replace with JWT/session storage.
TOKENS: dict[str, dict[str, str]] = {}


def read_json(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig") as f:
        return json.load(f)


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        g.db = conn
    return g.db


@app.teardown_appcontext
def close_db(_: Any) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(r[1] == column for r in rows)


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'merchant', 'admin')),
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen'))
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS stalls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          description TEXT,
          image_url TEXT,
          open_time TEXT NOT NULL,
          lng REAL NOT NULL,
          lat REAL NOT NULL,
          heat REAL NOT NULL DEFAULT 0.5,
          status TEXT NOT NULL DEFAULT 'approved',
          merchant_name TEXT NOT NULL DEFAULT 'system',
          is_open INTEGER NOT NULL DEFAULT 0 CHECK (is_open IN (0, 1)),
          live_lng REAL,
          live_lat REAL,
          live_updated_at TEXT
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS submissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          merchant_name TEXT NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          description TEXT,
          image_url TEXT,
          open_time TEXT NOT NULL,
          lng REAL NOT NULL,
          lat REAL NOT NULL,
          heat REAL NOT NULL DEFAULT 0.5,
          target_stall_id INTEGER,
          action TEXT NOT NULL DEFAULT 'create',
          status TEXT NOT NULL DEFAULT 'pending',
          reject_reason TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
          reviewed_at TEXT
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS reviews (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          stall_id INTEGER NOT NULL,
          user_name TEXT NOT NULL,
          rating INTEGER NOT NULL,
          content TEXT NOT NULL,
          merchant_reply TEXT,
          merchant_reply_at TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
          FOREIGN KEY (stall_id) REFERENCES stalls(id)
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS review_replies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          review_id INTEGER NOT NULL,
          parent_reply_id INTEGER,
          user_name TEXT NOT NULL,
          content TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'approved',
          created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
          FOREIGN KEY (review_id) REFERENCES reviews(id)
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_type TEXT NOT NULL,
          entity_id INTEGER,
          action TEXT NOT NULL,
          operator_name TEXT NOT NULL,
          detail TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'merchant')),
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          related_type TEXT,
          related_id INTEGER,
          is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
        """
    )

    # Migration for existing database.
    if not column_exists(conn, "stalls", "merchant_name"):
        cur.execute("ALTER TABLE stalls ADD COLUMN merchant_name TEXT NOT NULL DEFAULT 'system'")
    if not column_exists(conn, "stalls", "image_url"):
        cur.execute("ALTER TABLE stalls ADD COLUMN image_url TEXT")
    if not column_exists(conn, "stalls", "is_open"):
        cur.execute("ALTER TABLE stalls ADD COLUMN is_open INTEGER NOT NULL DEFAULT 0")
    if not column_exists(conn, "stalls", "live_lng"):
        cur.execute("ALTER TABLE stalls ADD COLUMN live_lng REAL")
    if not column_exists(conn, "stalls", "live_lat"):
        cur.execute("ALTER TABLE stalls ADD COLUMN live_lat REAL")
    if not column_exists(conn, "stalls", "live_updated_at"):
        cur.execute("ALTER TABLE stalls ADD COLUMN live_updated_at TEXT")
    if not column_exists(conn, "users", "status"):
        cur.execute("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
    if not column_exists(conn, "submissions", "reject_reason"):
        cur.execute("ALTER TABLE submissions ADD COLUMN reject_reason TEXT")
    if not column_exists(conn, "submissions", "image_url"):
        cur.execute("ALTER TABLE submissions ADD COLUMN image_url TEXT")
    if not column_exists(conn, "submissions", "created_at"):
        cur.execute("ALTER TABLE submissions ADD COLUMN created_at TEXT")
        cur.execute("UPDATE submissions SET created_at = datetime('now', 'localtime') WHERE created_at IS NULL")
    if not column_exists(conn, "submissions", "reviewed_at"):
        cur.execute("ALTER TABLE submissions ADD COLUMN reviewed_at TEXT")

    if not column_exists(conn, "reviews", "merchant_reply"):
        cur.execute("ALTER TABLE reviews ADD COLUMN merchant_reply TEXT")
    if not column_exists(conn, "reviews", "merchant_reply_at"):
        cur.execute("ALTER TABLE reviews ADD COLUMN merchant_reply_at TEXT")
    if not column_exists(conn, "reviews", "status"):
        cur.execute("ALTER TABLE reviews ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'")
    if not column_exists(conn, "reviews", "created_at"):
        cur.execute("ALTER TABLE reviews ADD COLUMN created_at TEXT")
        cur.execute("UPDATE reviews SET created_at = datetime('now', 'localtime') WHERE created_at IS NULL")
    if not column_exists(conn, "reviews", "updated_at"):
        cur.execute("ALTER TABLE reviews ADD COLUMN updated_at TEXT")
        cur.execute("UPDATE reviews SET updated_at = datetime('now', 'localtime') WHERE updated_at IS NULL")

    user_count = cur.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    if user_count == 0:
        users = read_json(USERS_JSON_FILE)
        if not users:
            users = [
                {"username": "user01", "password": "123456", "role": "user"},
                {"username": "merchant01", "password": "123456", "role": "merchant"},
                {"username": "admin01", "password": "123456", "role": "admin"},
            ]
        cur.executemany(
            "INSERT INTO users (username, password, role, status) VALUES (?, ?, ?, ?)",
            [(u["username"], u["password"], u["role"], u.get("status", "active")) for u in users],
        )

    stall_count = cur.execute("SELECT COUNT(*) FROM stalls").fetchone()[0]
    if stall_count == 0:
        stalls = read_json(STALLS_JSON_FILE)
        if stalls:
            cur.executemany(
                """
                INSERT INTO stalls (name, category, description, image_url, open_time, lng, lat, heat, status, merchant_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        s.get("name", "未命名摊位"),
                        s.get("category", "其他"),
                        s.get("description", ""),
                        s.get("image_url", ""),
                        s.get("open_time", "18:00-23:00"),
                        float(s.get("lng", 0)),
                        float(s.get("lat", 0)),
                        float(s.get("heat", 0.5)),
                        s.get("status", "approved"),
                        s.get("merchant_name", "system"),
                    )
                    for s in stalls
                ],
            )

    submission_count = cur.execute("SELECT COUNT(*) FROM submissions").fetchone()[0]
    if submission_count == 0:
        submissions = read_json(SUBMISSIONS_JSON_FILE)
        if submissions:
            cur.executemany(
                """
                INSERT INTO submissions (
                  merchant_name, name, category, description, image_url, open_time, lng, lat, heat,
                  target_stall_id, action, status, reject_reason, created_at, reviewed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        s.get("merchant_name", "merchant01"),
                        s.get("name", "未命名摊位"),
                        s.get("category", "其他"),
                        s.get("description", ""),
                        s.get("image_url", ""),
                        s.get("open_time", "18:00-23:00"),
                        float(s.get("lng", 0)),
                        float(s.get("lat", 0)),
                        float(s.get("heat", 0.5)),
                        s.get("target_stall_id"),
                        s.get("action", "create"),
                        s.get("status", "pending"),
                        s.get("reject_reason"),
                        s.get("created_at", "2026-01-01 18:00:00"),
                        s.get("reviewed_at"),
                    )
                    for s in submissions
                ],
            )

    review_count = cur.execute("SELECT COUNT(*) FROM reviews").fetchone()[0]
    if review_count == 0:
        reviews = read_json(REVIEWS_JSON_FILE)
        if reviews:
            cur.executemany(
                """
                INSERT INTO reviews (
                  stall_id, user_name, rating, content, merchant_reply, merchant_reply_at,
                  status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        int(r["stall_id"]),
                        r.get("user_name", "user01"),
                        int(r.get("rating", 5)),
                        r.get("content", ""),
                        r.get("merchant_reply"),
                        r.get("merchant_reply_at"),
                        r.get("status", "approved"),
                        r.get("created_at", "2026-01-01 19:00:00"),
                        r.get("updated_at", "2026-01-01 19:00:00"),
                    )
                    for r in reviews
                ],
            )

    # Backfill image_url for existing stalls if json has image values.
    stalls_for_backfill = read_json(STALLS_JSON_FILE)
    if stalls_for_backfill:
        cur.executemany(
            "UPDATE stalls SET image_url = ? WHERE id = ? AND (image_url IS NULL OR image_url = '')",
            [
                (s.get("image_url", ""), int(s["id"]))
                for s in stalls_for_backfill
                if s.get("id") and s.get("image_url")
            ],
        )

    conn.commit()
    conn.close()


def require_role(roles: set[str]) -> tuple[dict[str, str] | None, Any | None]:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None, (jsonify({"message": "未登录或登录已过期"}), 401)

    token = auth.split(" ", 1)[1].strip()
    user = TOKENS.get(token)
    if user is None:
        return None, (jsonify({"message": "未登录或登录已过期"}), 401)
    if user["role"] not in roles:
        return None, (jsonify({"message": "无权限执行此操作"}), 403)
    return user, None


def validate_submission(payload: dict[str, Any]) -> tuple[bool, str]:
    required = ["name", "category", "open_time", "lng", "lat"]
    missing = [k for k in required if k not in payload or payload[k] in (None, "")]
    if missing:
        return False, f"缺少必要字段: {', '.join(missing)}"

    try:
        lng = float(payload["lng"])
        lat = float(payload["lat"])
    except (TypeError, ValueError):
        return False, "经纬度格式不正确"

    if not (-180 <= lng <= 180 and -90 <= lat <= 90):
        return False, "经纬度超出合法范围"

    return True, ""


def validate_review(payload: dict[str, Any]) -> tuple[bool, str]:
    try:
        rating = int(payload.get("rating", 0))
    except (TypeError, ValueError):
        return False, "评分必须为 1-5 的整数"

    content = str(payload.get("content", "")).strip()
    if rating < 1 or rating > 5:
        return False, "评分必须为 1-5 的整数"
    if not content:
        return False, "评价内容不能为空"
    if len(content) > 500:
        return False, "评价内容不能超过 500 字"

    return True, ""


def create_submission_record(db: sqlite3.Connection, merchant_name: str, payload: dict[str, Any]) -> int:
    cur = db.execute(
        """
        INSERT INTO submissions (
          merchant_name, name, category, description, image_url, open_time, lng, lat, heat,
          target_stall_id, action, status, reject_reason, created_at, reviewed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, datetime('now', 'localtime'), NULL)
        """,
        (
            merchant_name,
            payload["name"],
            payload["category"],
            payload.get("description", ""),
            payload.get("image_url", ""),
            payload["open_time"],
            float(payload["lng"]),
            float(payload["lat"]),
            float(payload.get("heat", 0.5)),
            payload.get("target_stall_id"),
            payload.get("action", "create"),
        ),
    )
    db.commit()
    return int(cur.lastrowid)


def add_audit_log(
    db: sqlite3.Connection,
    entity_type: str,
    entity_id: int | None,
    action: str,
    operator_name: str,
    detail: str = "",
) -> None:
    db.execute(
        """
        INSERT INTO audit_logs (entity_type, entity_id, action, operator_name, detail, created_at)
        VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
        """,
        (entity_type, entity_id, action, operator_name, detail),
    )


def create_notification(
    db: sqlite3.Connection,
    username: str,
    role: str,
    title: str,
    content: str,
    related_type: str = "",
    related_id: int | None = None,
) -> None:
    db.execute(
        """
        INSERT INTO notifications (
          username, role, title, content, related_type, related_id, is_read, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now', 'localtime'))
        """,
        (username, role, title, content, related_type, related_id),
    )


def parse_pagination(default_page_size: int = 20, max_page_size: int = 100) -> tuple[int, int, int]:
    try:
        page = int(request.args.get("page", 1))
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = int(request.args.get("page_size", default_page_size))
    except (TypeError, ValueError):
        page_size = default_page_size
    page = max(1, page)
    page_size = max(1, min(max_page_size, page_size))
    offset = (page - 1) * page_size
    return page, page_size, offset


def make_paginated_result(items: list[dict[str, Any]], total: int, page: int, page_size: int) -> dict[str, Any]:
    total_pages = max(1, math.ceil(total / page_size)) if page_size > 0 else 1
    return {
        "items": items,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total": total,
            "total_pages": total_pages,
        },
    }


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius_km = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lng / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius_km * c


@app.errorhandler(RequestEntityTooLarge)
def handle_file_too_large(_: RequestEntityTooLarge) -> Any:
    return jsonify({"message": "上传失败：文件总大小不能超过 20MB"}), 413


@app.get("/uploads/<path:filename>")
def serve_upload_file(filename: str) -> Any:
    return send_from_directory(UPLOAD_DIR, filename)


@app.post("/api/uploads/images")
def upload_images() -> Any:
    user, err = require_role({"merchant", "admin"})
    if err is not None:
        return err

    files = request.files.getlist("images")
    if not files:
        return jsonify({"message": "请至少选择一张图片"}), 400
    if len(files) > MAX_UPLOAD_IMAGE_COUNT:
        return jsonify({"message": f"最多可上传 {MAX_UPLOAD_IMAGE_COUNT} 张图片"}), 400

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    urls: list[str] = []

    for file in files:
        raw_name = str(file.filename or "").strip()
        if not raw_name:
            continue

        ext = Path(raw_name).suffix.lower()
        if ext not in ALLOWED_IMAGE_EXTENSIONS:
            allowed = ", ".join(sorted(ALLOWED_IMAGE_EXTENSIONS))
            return jsonify({"message": f"仅支持以下图片格式: {allowed}"}), 400

        unique_name = secure_filename(f"{user['username']}_{secrets.token_hex(12)}{ext}")
        file_path = UPLOAD_DIR / unique_name
        file.save(file_path)
        urls.append(f"{request.host_url.rstrip('/')}/uploads/{unique_name}")

    if not urls:
        return jsonify({"message": "未检测到有效图片"}), 400

    return jsonify({"message": "上传成功", "urls": urls}), 201


@app.get("/health")
def health() -> Any:
    return jsonify({"status": "ok", "db": str(DB_FILE)})


@app.post("/api/auth/login")
def login() -> Any:
    payload = request.get_json(silent=True) or {}
    role = str(payload.get("role", "")).strip()
    username = str(payload.get("username", "")).strip()
    password = str(payload.get("password", "")).strip()

    if not role or not username or not password:
        return jsonify({"message": "角色、用户名和密码不能为空"}), 400

    db = get_db()
    matched = db.execute(
        "SELECT username, role, status FROM users WHERE role = ? AND username = ? AND password = ?",
        (role, username, password),
    ).fetchone()

    if matched is None:
        return jsonify({"message": "账号或密码错误"}), 401
    if matched["status"] != "active":
        return jsonify({"message": "账号已被冻结"}), 403

    token = secrets.token_urlsafe(24)
    TOKENS[token] = {"username": matched["username"], "role": matched["role"]}
    return jsonify({"token": token, "user": {"username": matched["username"], "role": matched["role"]}})


@app.post("/api/auth/register")
def register() -> Any:
    payload = request.get_json(silent=True) or {}
    role = str(payload.get("role", "")).strip()
    username = str(payload.get("username", "")).strip()
    password = str(payload.get("password", "")).strip()

    if role not in {"user", "merchant"}:
        return jsonify({"message": "角色参数不合法"}), 400
    if not username or not password:
        return jsonify({"message": "用户名和密码不能为空"}), 400
    if len(username) < 3 or len(username) > 30:
        return jsonify({"message": "用户名长度需为 3-30 个字符"}), 400
    if len(password) < 6 or len(password) > 64:
        return jsonify({"message": "密码长度需为 6-64 个字符"}), 400

    db = get_db()
    exists = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if exists is not None:
        return jsonify({"message": "用户名已存在"}), 409

    db.execute(
        "INSERT INTO users (username, password, role, status) VALUES (?, ?, ?, 'active')",
        (username, password, role),
    )
    db.commit()
    return jsonify({"message": "注册成功"}), 201


@app.get("/api/stalls")
def list_stalls() -> Any:
    category = str(request.args.get("category", "")).strip()
    q = str(request.args.get("q", "")).strip().lower()
    sort = str(request.args.get("sort", "id_asc")).strip()
    min_rating_raw = request.args.get("min_rating")
    center_lat_raw = request.args.get("center_lat")
    center_lng_raw = request.args.get("center_lng")
    max_distance_km_raw = request.args.get("max_distance_km")
    page, page_size, offset = parse_pagination(default_page_size=20, max_page_size=100)
    db = get_db()

    rows = db.execute(
        """
        SELECT
          s.id, s.name, s.category, s.description, s.image_url, s.open_time,
          CASE WHEN s.is_open = 1 AND s.live_lng IS NOT NULL THEN s.live_lng ELSE s.lng END AS lng,
          CASE WHEN s.is_open = 1 AND s.live_lat IS NOT NULL THEN s.live_lat ELSE s.lat END AS lat,
          s.heat, s.status, s.merchant_name, s.is_open, s.live_lng, s.live_lat, s.live_updated_at,
          CASE WHEN s.is_open = 1 THEN '营业中' ELSE '休息中' END AS business_status,
          COALESCE(rr.avg_rating, 0) AS avg_rating,
          COALESCE(rr.review_count, 0) AS review_count
        FROM stalls s
        LEFT JOIN (
          SELECT stall_id, AVG(rating) AS avg_rating, COUNT(*) AS review_count
          FROM reviews
          WHERE status = 'approved'
          GROUP BY stall_id
        ) rr ON rr.stall_id = s.id
        WHERE s.status = 'approved'
        ORDER BY s.id ASC
        """
    ).fetchall()
    items = [dict(r) for r in rows]

    if category:
        items = [x for x in items if str(x.get("category", "")).strip() == category]
    if q:
        items = [
            x
            for x in items
            if q in str(x.get("name", "")).lower()
            or q in str(x.get("category", "")).lower()
            or q in str(x.get("description", "")).lower()
        ]

    min_rating = None
    if min_rating_raw not in (None, ""):
        try:
            min_rating = float(min_rating_raw)
        except (TypeError, ValueError):
            return jsonify({"message": "最小评分参数格式错误"}), 400
        items = [x for x in items if float(x.get("avg_rating", 0.0)) >= min_rating]

    center_lat = None
    center_lng = None
    max_distance_km = None
    if max_distance_km_raw not in (None, ""):
        try:
            max_distance_km = float(max_distance_km_raw)
        except (TypeError, ValueError):
            return jsonify({"message": "最大距离参数格式错误"}), 400
        try:
            center_lat = float(center_lat_raw)
            center_lng = float(center_lng_raw)
        except (TypeError, ValueError):
            return jsonify({"message": "中心点经纬度参数格式错误"}), 400

    for item in items:
        if center_lat is not None and center_lng is not None:
            item["distance_km"] = round(
                haversine_km(center_lat, center_lng, float(item["lat"]), float(item["lng"])),
                3,
            )
        else:
            item["distance_km"] = None

    if max_distance_km is not None:
        items = [x for x in items if x["distance_km"] is not None and float(x["distance_km"]) <= max_distance_km]

    if sort == "rating_desc":
        items.sort(key=lambda x: (float(x.get("avg_rating", 0.0)), int(x.get("review_count", 0))), reverse=True)
    elif sort == "distance_asc":
        items.sort(key=lambda x: float(x.get("distance_km") if x.get("distance_km") is not None else 1e12))
    elif sort == "id_desc":
        items.sort(key=lambda x: int(x.get("id", 0)), reverse=True)
    else:
        items.sort(key=lambda x: int(x.get("id", 0)))

    total = len(items)
    paged = items[offset : offset + page_size]
    return jsonify(make_paginated_result(paged, total, page, page_size))


@app.get("/api/stalls/<int:stall_id>")
def get_stall(stall_id: int) -> Any:
    db = get_db()
    row = db.execute(
        """
        SELECT id, name, category, description, image_url, open_time,
               CASE WHEN is_open = 1 AND live_lng IS NOT NULL THEN live_lng ELSE lng END AS lng,
               CASE WHEN is_open = 1 AND live_lat IS NOT NULL THEN live_lat ELSE lat END AS lat,
               heat, status, merchant_name, is_open, live_lng, live_lat, live_updated_at,
               CASE WHEN is_open = 1 THEN '营业中' ELSE '休息中' END AS business_status
        FROM stalls
        WHERE id = ? AND status = 'approved'
        """,
        (stall_id,),
    ).fetchone()

    if row is None:
        return jsonify({"message": "摊位不存在"}), 404

    return jsonify(dict(row))


@app.get("/api/heatmap")
def heatmap() -> Any:
    db = get_db()
    mode = request.args.get("mode", "density")
    rows = db.execute(
        "SELECT lat, lng, heat FROM stalls WHERE status = 'approved' ORDER BY id ASC"
    ).fetchall()
    if mode == "density":
        # Density mode: compute local neighborhood density and normalize.
        raw = [(float(r["lat"]), float(r["lng"])) for r in rows]
        radius_deg = 0.0028  # ~300m neighborhood
        radius_sq = radius_deg * radius_deg
        scores: list[float] = []
        for lat_i, lng_i in raw:
            c = 0.0
            for lat_j, lng_j in raw:
                d_lat = lat_i - lat_j
                d_lng = lng_i - lng_j
                if (d_lat * d_lat + d_lng * d_lng) <= radius_sq:
                    c += 1.0
            scores.append(c)

        if scores:
            s_min = min(scores)
            s_max = max(scores)
        else:
            s_min = 0.0
            s_max = 0.0

        points = []
        for idx, (lat, lng) in enumerate(raw):
            if s_max > s_min:
                # Keep a baseline so sparse areas still show as cool colors.
                w = 0.15 + 0.85 * ((scores[idx] - s_min) / (s_max - s_min))
            else:
                w = 0.5
            points.append({"lat": lat, "lng": lng, "weight": round(w, 4)})
    else:
        points = [{"lat": float(r["lat"]), "lng": float(r["lng"]), "weight": float(r["heat"])} for r in rows]
    return jsonify(points)


@app.get("/api/merchant/stalls")
def list_merchant_stalls() -> Any:
    user, err = require_role({"merchant"})
    if err is not None:
        return err

    db = get_db()
    q = str(request.args.get("q", "")).strip()
    status = str(request.args.get("status", "")).strip()
    page, page_size, offset = parse_pagination(default_page_size=20, max_page_size=100)

    sql = """
        SELECT id, name, category, description, image_url, open_time, lng, lat, heat, status, merchant_name,
               is_open, live_lng, live_lat, live_updated_at,
               CASE WHEN is_open = 1 THEN '营业中' ELSE '休息中' END AS business_status
        FROM stalls
        WHERE merchant_name = ?
    """
    params: list[Any] = [user["username"]]
    if status:
        sql += " AND status = ?"
        params.append(status)
    if q:
        sql += " AND (name LIKE ? OR category LIKE ?)"
        like_q = f"%{q}%"
        params.extend([like_q, like_q])

    count_row = db.execute(f"SELECT COUNT(*) FROM ({sql})", tuple(params)).fetchone()
    total = int(count_row[0]) if count_row else 0
    sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
    params.extend([page_size, offset])
    rows = db.execute(sql, tuple(params)).fetchall()
    return jsonify(make_paginated_result([dict(r) for r in rows], total, page, page_size))


@app.get("/api/merchant/submissions")
def list_merchant_submissions() -> Any:
    user, err = require_role({"merchant"})
    if err is not None:
        return err

    db = get_db()
    status = str(request.args.get("status", "")).strip()
    q = str(request.args.get("q", "")).strip()
    page, page_size, offset = parse_pagination(default_page_size=20, max_page_size=100)
    sql = "SELECT * FROM submissions WHERE merchant_name = ?"
    params: list[Any] = [user["username"]]
    if status:
        sql += " AND status = ?"
        params.append(status)
    if q:
        sql += " AND (name LIKE ? OR category LIKE ? OR action LIKE ?)"
        like_q = f"%{q}%"
        params.extend([like_q, like_q, like_q])

    count_row = db.execute(f"SELECT COUNT(*) FROM ({sql})", tuple(params)).fetchone()
    total = int(count_row[0]) if count_row else 0
    sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
    params.extend([page_size, offset])
    rows = db.execute(sql, tuple(params)).fetchall()
    return jsonify(make_paginated_result([dict(r) for r in rows], total, page, page_size))


@app.post("/api/merchant/stalls")
def create_merchant_stall_submission() -> Any:
    user, err = require_role({"merchant"})
    if err is not None:
        return err

    payload = request.get_json(silent=True) or {}
    payload["action"] = "create"
    ok, message = validate_submission(payload)
    if not ok:
        return jsonify({"message": message}), 400

    db = get_db()
    new_id = create_submission_record(db, user["username"], payload)
    submission = db.execute("SELECT * FROM submissions WHERE id = ?", (new_id,)).fetchone()
    return jsonify({"message": "提交成功", "submission": dict(submission)}), 201


@app.post("/api/merchant/stalls/<int:stall_id>/update")
def create_merchant_stall_update_submission(stall_id: int) -> Any:
    user, err = require_role({"merchant"})
    if err is not None:
        return err

    payload = request.get_json(silent=True) or {}
    payload["action"] = "update"
    payload["target_stall_id"] = stall_id
    ok, message = validate_submission(payload)
    if not ok:
        return jsonify({"message": message}), 400

    db = get_db()
    owned = db.execute(
        "SELECT id FROM stalls WHERE id = ? AND merchant_name = ?",
        (stall_id, user["username"]),
    ).fetchone()
    if owned is None:
        return jsonify({"message": "无权操作该摊位"}), 403

    new_id = create_submission_record(db, user["username"], payload)
    submission = db.execute("SELECT * FROM submissions WHERE id = ?", (new_id,)).fetchone()
    return jsonify({"message": "提交成功", "submission": dict(submission)}), 201


@app.post("/api/merchant/submissions")
def create_submission_compat() -> Any:
    # Backward-compatible endpoint.
    return create_merchant_stall_submission()


@app.post("/api/merchant/stalls/<int:stall_id>/open")
def open_merchant_stall(stall_id: int) -> Any:
    user, err = require_role({"merchant"})
    if err is not None:
        return err

    payload = request.get_json(silent=True) or {}
    db = get_db()
    stall = db.execute(
        "SELECT id, name, merchant_name, status, lng, lat FROM stalls WHERE id = ? AND merchant_name = ?",
        (stall_id, user["username"]),
    ).fetchone()
    if stall is None:
        return jsonify({"message": "无权操作该摊位"}), 403
    if stall["status"] != "approved":
        return jsonify({"message": "仅已通过审核的摊位可出摊"}), 400

    try:
        live_lng = float(payload.get("lng", stall["lng"]))
        live_lat = float(payload.get("lat", stall["lat"]))
    except (TypeError, ValueError):
        return jsonify({"message": "经纬度格式不正确"}), 400

    if not (-180 <= live_lng <= 180 and -90 <= live_lat <= 90):
        return jsonify({"message": "经纬度超出合法范围"}), 400

    db.execute(
        "UPDATE stalls SET is_open = 1, live_lng = ?, live_lat = ?, live_updated_at = datetime('now', 'localtime') WHERE id = ?",
        (live_lng, live_lat, stall_id),
    )
    db.commit()
    return jsonify({"message": "出摊成功"})


@app.post("/api/merchant/stalls/<int:stall_id>/close")
def close_merchant_stall(stall_id: int) -> Any:
    user, err = require_role({"merchant"})
    if err is not None:
        return err

    db = get_db()
    stall = db.execute(
        "SELECT id, merchant_name FROM stalls WHERE id = ? AND merchant_name = ?",
        (stall_id, user["username"]),
    ).fetchone()
    if stall is None:
        return jsonify({"message": "无权操作该摊位"}), 403

    db.execute(
        "UPDATE stalls SET is_open = 0, live_updated_at = datetime('now', 'localtime') WHERE id = ?",
        (stall_id,),
    )
    db.commit()
    return jsonify({"message": "收摊成功"})


@app.get("/api/admin/submissions")
def list_admin_submissions() -> Any:
    _, err = require_role({"admin"})
    if err is not None:
        return err

    status = request.args.get("status", "pending")
    q = str(request.args.get("q", "")).strip()
    page, page_size, offset = parse_pagination(default_page_size=20, max_page_size=100)
    db = get_db()
    sql = "SELECT * FROM submissions WHERE 1=1"
    params: list[Any] = []
    if status:
        sql += " AND status = ?"
        params.append(status)
    if q:
        sql += " AND (merchant_name LIKE ? OR name LIKE ? OR category LIKE ? OR action LIKE ?)"
        like_q = f"%{q}%"
        params.extend([like_q, like_q, like_q, like_q])

    count_row = db.execute(f"SELECT COUNT(*) FROM ({sql})", tuple(params)).fetchone()
    total = int(count_row[0]) if count_row else 0
    sql += " ORDER BY id ASC LIMIT ? OFFSET ?"
    params.extend([page_size, offset])
    rows = db.execute(sql, tuple(params)).fetchall()
    return jsonify(make_paginated_result([dict(r) for r in rows], total, page, page_size))


@app.post("/api/admin/submissions/<int:submission_id>/approve")
def approve_submission(submission_id: int) -> Any:
    admin_user, err = require_role({"admin"})
    if err is not None:
        return err

    db = get_db()
    submission = db.execute("SELECT * FROM submissions WHERE id = ?", (submission_id,)).fetchone()
    if submission is None:
        return jsonify({"message": "提交记录不存在"}), 404

    if submission["status"] != "pending":
        return jsonify({"message": "该提交已审核，无法重复操作"}), 400

    action = submission["action"] or "create"

    if action == "update" and submission["target_stall_id"]:
        target = db.execute(
            "SELECT id, merchant_name FROM stalls WHERE id = ?",
            (int(submission["target_stall_id"]),),
        ).fetchone()
        if target is None:
            return jsonify({"message": "目标摊位不存在"}), 404

        db.execute(
            """
            UPDATE stalls
            SET name = ?, category = ?, description = ?, image_url = ?, open_time = ?, lng = ?, lat = ?, heat = ?,
                status = 'approved', merchant_name = ?
            WHERE id = ?
            """,
            (
                submission["name"],
                submission["category"],
                submission["description"],
                submission["image_url"],
                submission["open_time"],
                float(submission["lng"]),
                float(submission["lat"]),
                float(submission["heat"]),
                submission["merchant_name"],
                int(submission["target_stall_id"]),
            ),
        )
    else:
        db.execute(
            """
            INSERT INTO stalls (name, category, description, image_url, open_time, lng, lat, heat, status, merchant_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?)
            """,
            (
                submission["name"],
                submission["category"],
                submission["description"],
                submission["image_url"],
                submission["open_time"],
                float(submission["lng"]),
                float(submission["lat"]),
                float(submission["heat"]),
                submission["merchant_name"],
            ),
        )

    db.execute(
        "UPDATE submissions SET status = 'approved', reject_reason = NULL, reviewed_at = datetime('now', 'localtime') WHERE id = ?",
        (submission_id,),
    )
    add_audit_log(
        db,
        entity_type="submission",
        entity_id=submission_id,
        action="approve",
        operator_name=admin_user["username"],
        detail=f"{submission['merchant_name']} -> {submission['name']}",
    )
    create_notification(
        db,
        username=submission["merchant_name"],
        role="merchant",
        title="提交审核通过",
        content=f"您的摊位提交（{submission['name']}）已审核通过。",
        related_type="submission",
        related_id=submission_id,
    )
    db.commit()

    return jsonify({"message": "审核通过成功"})


@app.post("/api/admin/submissions/<int:submission_id>/reject")
def reject_submission(submission_id: int) -> Any:
    admin_user, err = require_role({"admin"})
    if err is not None:
        return err

    payload = request.get_json(silent=True) or {}
    reject_reason = str(payload.get("reject_reason", "")).strip()
    if not reject_reason:
        return jsonify({"message": "驳回原因不能为空"}), 400
    if len(reject_reason) > 200:
        return jsonify({"message": "驳回原因不能超过 200 字"}), 400

    db = get_db()
    row = db.execute("SELECT id, status FROM submissions WHERE id = ?", (submission_id,)).fetchone()
    if row is None:
        return jsonify({"message": "提交记录不存在"}), 404
    if row["status"] != "pending":
        return jsonify({"message": "该提交已审核，无法重复操作"}), 400

    db.execute(
        "UPDATE submissions SET status = 'rejected', reject_reason = ?, reviewed_at = datetime('now', 'localtime') WHERE id = ?",
        (reject_reason, submission_id),
    )
    add_audit_log(
        db,
        entity_type="submission",
        entity_id=submission_id,
        action="reject",
        operator_name=admin_user["username"],
        detail=reject_reason,
    )
    submission = db.execute("SELECT merchant_name, name FROM submissions WHERE id = ?", (submission_id,)).fetchone()
    if submission is not None:
        create_notification(
            db,
            username=submission["merchant_name"],
            role="merchant",
            title="提交审核驳回",
            content=f"您的摊位提交被驳回，原因：{reject_reason}",
            related_type="submission",
            related_id=submission_id,
        )
    db.commit()
    return jsonify({"message": "驳回成功"})


@app.post("/api/admin/submissions/batch-review")
def batch_review_submissions() -> Any:
    admin_user, err = require_role({"admin"})
    if err is not None:
        return err

    payload = request.get_json(silent=True) or {}
    ids_raw = payload.get("ids")
    action = str(payload.get("action", "")).strip()
    reject_reason = str(payload.get("reject_reason", "")).strip()

    if not isinstance(ids_raw, list) or not ids_raw:
        return jsonify({"message": "请提供待审核的提交 ID 列表"}), 400
    try:
        ids = [int(x) for x in ids_raw]
    except (TypeError, ValueError):
        return jsonify({"message": "提交 ID 列表格式错误"}), 400
    if action not in {"approve", "reject"}:
        return jsonify({"message": "审核动作不合法"}), 400
    if action == "reject" and not reject_reason:
        return jsonify({"message": "批量驳回时必须填写驳回原因"}), 400

    db = get_db()
    placeholders = ",".join("?" for _ in ids)
    rows = db.execute(
        f"SELECT * FROM submissions WHERE id IN ({placeholders})",
        tuple(ids),
    ).fetchall()
    rows_by_id = {int(r["id"]): r for r in rows}

    done = 0
    skipped: list[dict[str, Any]] = []
    for sid in ids:
        submission = rows_by_id.get(sid)
        if submission is None:
            skipped.append({"id": sid, "reason": "提交记录不存在"})
            continue
        if submission["status"] != "pending":
            skipped.append({"id": sid, "reason": "提交不是待审核状态"})
            continue

        if action == "approve":
            sub_action = submission["action"] or "create"
            if sub_action == "update" and submission["target_stall_id"]:
                target = db.execute(
                    "SELECT id FROM stalls WHERE id = ?",
                    (int(submission["target_stall_id"]),),
                ).fetchone()
                if target is None:
                    skipped.append({"id": sid, "reason": "目标摊位不存在"})
                    continue
                db.execute(
                    """
                    UPDATE stalls
                    SET name = ?, category = ?, description = ?, image_url = ?, open_time = ?, lng = ?, lat = ?, heat = ?,
                        status = 'approved', merchant_name = ?
                    WHERE id = ?
                    """,
                    (
                        submission["name"],
                        submission["category"],
                        submission["description"],
                        submission["image_url"],
                        submission["open_time"],
                        float(submission["lng"]),
                        float(submission["lat"]),
                        float(submission["heat"]),
                        submission["merchant_name"],
                        int(submission["target_stall_id"]),
                    ),
                )
            else:
                db.execute(
                    """
                    INSERT INTO stalls (name, category, description, image_url, open_time, lng, lat, heat, status, merchant_name)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?)
                    """,
                    (
                        submission["name"],
                        submission["category"],
                        submission["description"],
                        submission["image_url"],
                        submission["open_time"],
                        float(submission["lng"]),
                        float(submission["lat"]),
                        float(submission["heat"]),
                        submission["merchant_name"],
                    ),
                )
            db.execute(
                "UPDATE submissions SET status = 'approved', reject_reason = NULL, reviewed_at = datetime('now', 'localtime') WHERE id = ?",
                (sid,),
            )
            add_audit_log(
                db,
                entity_type="submission",
                entity_id=sid,
                action="batch_approve",
                operator_name=admin_user["username"],
                detail=f"{submission['merchant_name']} -> {submission['name']}",
            )
            create_notification(
                db,
                username=submission["merchant_name"],
                role="merchant",
                title="提交审核通过",
                content=f"您的摊位提交（{submission['name']}）已审核通过。",
                related_type="submission",
                related_id=sid,
            )
        else:
            db.execute(
                "UPDATE submissions SET status = 'rejected', reject_reason = ?, reviewed_at = datetime('now', 'localtime') WHERE id = ?",
                (reject_reason, sid),
            )
            add_audit_log(
                db,
                entity_type="submission",
                entity_id=sid,
                action="batch_reject",
                operator_name=admin_user["username"],
                detail=reject_reason,
            )
            create_notification(
                db,
                username=submission["merchant_name"],
                role="merchant",
                title="提交审核驳回",
                content=f"您的摊位提交被驳回，原因：{reject_reason}",
                related_type="submission",
                related_id=sid,
            )
        done += 1

    db.commit()
    return jsonify({"message": f"批量审核完成，成功 {done} 条，跳过 {len(skipped)} 条", "done": done, "skipped": skipped})


@app.get("/api/admin/users")
def list_admin_users() -> Any:
    _, err = require_role({"admin"})
    if err is not None:
        return err

    role = request.args.get("role")
    status = request.args.get("status")
    q = str(request.args.get("q", "")).strip()
    db = get_db()

    sql = "SELECT id, username, role, status FROM users WHERE 1=1"
    params: list[Any] = []
    if role:
        sql += " AND role = ?"
        params.append(role)
    if status:
        sql += " AND status = ?"
        params.append(status)
    if q:
        sql += " AND username LIKE ?"
        params.append(f"%{q}%")
    sql += " ORDER BY id ASC"
    rows = db.execute(sql, tuple(params)).fetchall()
    return jsonify([dict(r) for r in rows])


@app.post("/api/admin/users")
def create_admin_user() -> Any:
    admin_user, err = require_role({"admin"})
    if err is not None:
        return err

    payload = request.get_json(silent=True) or {}
    username = str(payload.get("username", "")).strip()
    password = str(payload.get("password", "")).strip()
    role = str(payload.get("role", "")).strip()
    if not username or not password or role not in {"user", "merchant"}:
        return jsonify({"message": "用户名、密码或角色参数不合法"}), 400

    db = get_db()
    exists = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if exists is not None:
        return jsonify({"message": "用户名已存在"}), 409

    cur = db.execute(
        "INSERT INTO users (username, password, role, status) VALUES (?, ?, ?, 'active')",
        (username, password, role),
    )
    add_audit_log(
        db,
        entity_type="user",
        entity_id=int(cur.lastrowid),
        action="create",
        operator_name=admin_user["username"],
        detail=f"{username} ({role})",
    )
    db.commit()
    row = db.execute("SELECT id, username, role, status FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify({"message": "创建用户成功", "user": dict(row)}), 201


@app.post("/api/admin/users/<int:user_id>/freeze")
def freeze_admin_user(user_id: int) -> Any:
    admin_user, err = require_role({"admin"})
    if err is not None:
        return err

    db = get_db()
    row = db.execute("SELECT id, role FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        return jsonify({"message": "用户不存在"}), 404
    if row["role"] == "admin":
        return jsonify({"message": "不能冻结管理员账号"}), 400

    db.execute("UPDATE users SET status = 'frozen' WHERE id = ?", (user_id,))
    add_audit_log(
        db,
        entity_type="user",
        entity_id=user_id,
        action="freeze",
        operator_name=admin_user["username"],
        detail=f"user_id={user_id}",
    )
    db.commit()
    return jsonify({"message": "冻结成功"})


@app.post("/api/admin/users/<int:user_id>/unfreeze")
def unfreeze_admin_user(user_id: int) -> Any:
    admin_user, err = require_role({"admin"})
    if err is not None:
        return err

    db = get_db()
    row = db.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        return jsonify({"message": "用户不存在"}), 404

    db.execute("UPDATE users SET status = 'active' WHERE id = ?", (user_id,))
    add_audit_log(
        db,
        entity_type="user",
        entity_id=user_id,
        action="unfreeze",
        operator_name=admin_user["username"],
        detail=f"user_id={user_id}",
    )
    db.commit()
    return jsonify({"message": "解冻成功"})


@app.get("/api/reviews")
def list_public_reviews() -> Any:
    stall_id = request.args.get("stall_id")
    q = str(request.args.get("q", "")).strip()
    page, page_size, offset = parse_pagination(default_page_size=20, max_page_size=100)
    db = get_db()

    sql_base = """
        SELECT r.id, r.stall_id, r.user_name, r.rating, r.content, r.merchant_reply, r.status,
               r.created_at, r.updated_at, s.name AS stall_name
        FROM reviews r
        JOIN stalls s ON s.id = r.stall_id
        WHERE r.status = 'approved'
    """
    params: list[Any] = []
    if stall_id:
        sql_base += " AND r.stall_id = ?"
        params.append(stall_id)
    if q:
        sql_base += " AND (r.content LIKE ? OR r.user_name LIKE ? OR s.name LIKE ?)"
        like_q = f"%{q}%"
        params.extend([like_q, like_q, like_q])

    count_row = db.execute(f"SELECT COUNT(*) FROM ({sql_base})", tuple(params)).fetchone()
    total = int(count_row[0]) if count_row else 0
    sql = f"{sql_base} ORDER BY r.id DESC LIMIT ? OFFSET ?"
    rows = db.execute(sql, tuple(params + [page_size, offset])).fetchall()

    reviews = [dict(r) for r in rows]
    review_ids = [int(r["id"]) for r in reviews]
    replies_by_review: dict[int, list[dict[str, Any]]] = {}
    if review_ids:
        placeholders = ",".join("?" for _ in review_ids)
        reply_rows = db.execute(
            f"""
            SELECT id, review_id, parent_reply_id, user_name, content, status, created_at, updated_at
            FROM review_replies
            WHERE status = 'approved' AND review_id IN ({placeholders})
            ORDER BY id ASC
            """,
            tuple(review_ids),
        ).fetchall()
        for rr in reply_rows:
            item = dict(rr)
            rid = int(item["review_id"])
            replies_by_review.setdefault(rid, []).append(item)

    for r in reviews:
        r["replies"] = replies_by_review.get(int(r["id"]), [])

    return jsonify(make_paginated_result(reviews, total, page, page_size))


@app.post("/api/reviews")
def create_review() -> Any:
    user, err = require_role({"user"})
    if err is not None:
        return err

    payload = request.get_json(silent=True) or {}
    ok, message = validate_review(payload)
    if not ok:
        return jsonify({"message": message}), 400

    try:
        stall_id = int(payload.get("stall_id"))
    except (TypeError, ValueError):
        return jsonify({"message": "摊位 ID 格式错误"}), 400

    db = get_db()
    stall = db.execute("SELECT id FROM stalls WHERE id = ? AND status = 'approved'", (stall_id,)).fetchone()
    if stall is None:
        return jsonify({"message": "摊位不存在或未通过审核"}), 404

    cur = db.execute(
        """
        INSERT INTO reviews (stall_id, user_name, rating, content, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'pending', datetime('now', 'localtime'), datetime('now', 'localtime'))
        """,
        (stall_id, user["username"], int(payload["rating"]), str(payload["content"]).strip()),
    )
    db.commit()

    row = db.execute("SELECT * FROM reviews WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify({"message": "评价提交成功，等待审核", "review": dict(row)}), 201


@app.post("/api/reviews/<int:review_id>/replies")
def create_review_reply(review_id: int) -> Any:
    user, err = require_role({"user"})
    if err is not None:
        return err

    payload = request.get_json(silent=True) or {}
    content = str(payload.get("content", "")).strip()
    if not content:
        return jsonify({"message": "回复内容不能为空"}), 400
    if len(content) > 500:
        return jsonify({"message": "回复内容不能超过 500 字"}), 400

    parent_reply_id = payload.get("parent_reply_id")
    db = get_db()
    review_row = db.execute(
        "SELECT id FROM reviews WHERE id = ? AND status = 'approved'",
        (review_id,),
    ).fetchone()
    if review_row is None:
        return jsonify({"message": "评价不存在或未通过审核"}), 404

    if parent_reply_id is not None:
        try:
            parent_reply_id = int(parent_reply_id)
        except (TypeError, ValueError):
            return jsonify({"message": "父回复 ID 格式错误"}), 400
        parent_row = db.execute(
            "SELECT id FROM review_replies WHERE id = ? AND review_id = ?",
            (parent_reply_id, review_id),
        ).fetchone()
        if parent_row is None:
            return jsonify({"message": "父回复不存在"}), 404

    cur = db.execute(
        """
        INSERT INTO review_replies (
          review_id, parent_reply_id, user_name, content, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'approved', datetime('now', 'localtime'), datetime('now', 'localtime'))
        """,
        (review_id, parent_reply_id, user["username"], content),
    )
    db.commit()
    row = db.execute(
        """
        SELECT id, review_id, parent_reply_id, user_name, content, status, created_at, updated_at
        FROM review_replies WHERE id = ?
        """,
        (cur.lastrowid,),
    ).fetchone()
    return jsonify({"message": "回复成功", "reply": dict(row)}), 201


@app.get("/api/merchant/reviews")
def list_merchant_reviews() -> Any:
    user, err = require_role({"merchant"})
    if err is not None:
        return err

    status = request.args.get("status")
    stall_id = request.args.get("stall_id")
    q = str(request.args.get("q", "")).strip()
    page, page_size, offset = parse_pagination(default_page_size=20, max_page_size=100)
    db = get_db()

    sql = """
        SELECT r.id, r.stall_id, r.user_name, r.rating, r.content, r.merchant_reply, r.status,
               r.created_at, r.updated_at, s.name AS stall_name
        FROM reviews r
        JOIN stalls s ON s.id = r.stall_id
        WHERE s.merchant_name = ?
    """
    params: list[Any] = [user["username"]]
    if stall_id:
        try:
            stall_id_int = int(stall_id)
        except (TypeError, ValueError):
            return jsonify({"message": "摊位 ID 格式错误"}), 400
        sql += " AND r.stall_id = ?"
        params.append(stall_id_int)
    if status:
        sql += " AND r.status = ?"
        params.append(status)
    if q:
        sql += " AND (r.content LIKE ? OR r.user_name LIKE ? OR s.name LIKE ?)"
        like_q = f"%{q}%"
        params.extend([like_q, like_q, like_q])

    count_row = db.execute(f"SELECT COUNT(*) FROM ({sql})", tuple(params)).fetchone()
    total = int(count_row[0]) if count_row else 0
    sql += " ORDER BY r.id DESC LIMIT ? OFFSET ?"
    params.extend([page_size, offset])

    rows = db.execute(sql, tuple(params)).fetchall()
    return jsonify(make_paginated_result([dict(r) for r in rows], total, page, page_size))


@app.post("/api/merchant/reviews/<int:review_id>/reply")
def reply_review(review_id: int) -> Any:
    user, err = require_role({"merchant"})
    if err is not None:
        return err

    payload = request.get_json(silent=True) or {}
    reply = str(payload.get("reply", "")).strip()
    if not reply:
        return jsonify({"message": "回复内容不能为空"}), 400
    if len(reply) > 500:
        return jsonify({"message": "回复内容不能超过 500 字"}), 400

    db = get_db()
    row = db.execute(
        """
        SELECT r.id, r.user_name, s.name AS stall_name
        FROM reviews r
        JOIN stalls s ON s.id = r.stall_id
        WHERE r.id = ? AND s.merchant_name = ?
        """,
        (review_id, user["username"]),
    ).fetchone()
    if row is None:
        return jsonify({"message": "无权回复该评价"}), 403

    db.execute(
        """
        UPDATE reviews
        SET merchant_reply = ?, merchant_reply_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime')
        WHERE id = ?
        """,
        (reply, review_id),
    )
    create_notification(
        db,
        username=row["user_name"],
        role="user",
        title="收到商家回复",
        content=f"您在摊位「{row['stall_name']}」的评价收到了商家回复。",
        related_type="review",
        related_id=review_id,
    )
    db.commit()
    return jsonify({"message": "回复成功"})


@app.get("/api/admin/reviews")
def list_admin_reviews() -> Any:
    _, err = require_role({"admin"})
    if err is not None:
        return err

    status = request.args.get("status")
    q = str(request.args.get("q", "")).strip()
    page, page_size, offset = parse_pagination(default_page_size=20, max_page_size=100)
    db = get_db()

    sql = """
        SELECT r.id, r.stall_id, r.user_name, r.rating, r.content, r.merchant_reply, r.status,
               r.created_at, r.updated_at, s.name AS stall_name, s.merchant_name
        FROM reviews r
        JOIN stalls s ON s.id = r.stall_id
    """
    params: list[Any] = []
    if status:
        sql += " WHERE r.status = ?"
        params.append(status)
    if q:
        sql += (" AND" if status else " WHERE") + " (r.content LIKE ? OR r.user_name LIKE ? OR s.name LIKE ? OR s.merchant_name LIKE ?)"
        like_q = f"%{q}%"
        params.extend([like_q, like_q, like_q, like_q])

    count_row = db.execute(f"SELECT COUNT(*) FROM ({sql})", tuple(params)).fetchone()
    total = int(count_row[0]) if count_row else 0
    sql += " ORDER BY r.id DESC LIMIT ? OFFSET ?"
    params.extend([page_size, offset])

    rows = db.execute(sql, tuple(params)).fetchall()
    return jsonify(make_paginated_result([dict(r) for r in rows], total, page, page_size))


@app.post("/api/admin/reviews/<int:review_id>/approve")
def approve_review(review_id: int) -> Any:
    admin_user, err = require_role({"admin"})
    if err is not None:
        return err

    db = get_db()
    row = db.execute("SELECT id, user_name FROM reviews WHERE id = ?", (review_id,)).fetchone()
    if row is None:
        return jsonify({"message": "评价不存在"}), 404

    db.execute(
        "UPDATE reviews SET status = 'approved', updated_at = datetime('now', 'localtime') WHERE id = ?",
        (review_id,),
    )
    add_audit_log(
        db,
        entity_type="review",
        entity_id=review_id,
        action="approve",
        operator_name=admin_user["username"],
        detail=f"review_id={review_id}",
    )
    create_notification(
        db,
        username=row["user_name"],
        role="user",
        title="评价审核通过",
        content="您的评价已通过审核并对外展示。",
        related_type="review",
        related_id=review_id,
    )
    db.commit()
    return jsonify({"message": "审核通过成功"})


@app.post("/api/admin/reviews/<int:review_id>/reject")
def reject_review(review_id: int) -> Any:
    admin_user, err = require_role({"admin"})
    if err is not None:
        return err

    db = get_db()
    row = db.execute("SELECT id, user_name FROM reviews WHERE id = ?", (review_id,)).fetchone()
    if row is None:
        return jsonify({"message": "评价不存在"}), 404

    db.execute(
        "UPDATE reviews SET status = 'rejected', updated_at = datetime('now', 'localtime') WHERE id = ?",
        (review_id,),
    )
    add_audit_log(
        db,
        entity_type="review",
        entity_id=review_id,
        action="reject",
        operator_name=admin_user["username"],
        detail=f"review_id={review_id}",
    )
    create_notification(
        db,
        username=row["user_name"],
        role="user",
        title="评价审核驳回",
        content="您的评价未通过审核。",
        related_type="review",
        related_id=review_id,
    )
    db.commit()
    return jsonify({"message": "驳回成功"})


@app.post("/api/admin/reviews/batch-review")
def batch_review_reviews() -> Any:
    admin_user, err = require_role({"admin"})
    if err is not None:
        return err

    payload = request.get_json(silent=True) or {}
    ids_raw = payload.get("ids")
    action = str(payload.get("action", "")).strip()
    if not isinstance(ids_raw, list) or not ids_raw:
        return jsonify({"message": "请提供待审核的评价 ID 列表"}), 400
    try:
        ids = [int(x) for x in ids_raw]
    except (TypeError, ValueError):
        return jsonify({"message": "评价 ID 列表格式错误"}), 400
    if action not in {"approve", "reject"}:
        return jsonify({"message": "审核动作不合法"}), 400

    db = get_db()
    placeholders = ",".join("?" for _ in ids)
    rows = db.execute(
        f"SELECT id, user_name, status FROM reviews WHERE id IN ({placeholders})",
        tuple(ids),
    ).fetchall()
    row_map = {int(r["id"]): r for r in rows}

    done = 0
    skipped: list[dict[str, Any]] = []
    for rid in ids:
        row = row_map.get(rid)
        if row is None:
            skipped.append({"id": rid, "reason": "评价不存在"})
            continue
        if row["status"] != "pending":
            skipped.append({"id": rid, "reason": "评价不是待审核状态"})
            continue

        next_status = "approved" if action == "approve" else "rejected"
        db.execute(
            "UPDATE reviews SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?",
            (next_status, rid),
        )
        add_audit_log(
            db,
            entity_type="review",
            entity_id=rid,
            action=f"batch_{action}",
            operator_name=admin_user["username"],
            detail=f"review_id={rid}",
        )
        title = "评价审核通过" if action == "approve" else "评价审核驳回"
        content = "您的评价已通过审核并对外展示。" if action == "approve" else f"您的评价（ID: {rid}）未通过审核。"
        create_notification(
            db,
            username=row["user_name"],
            role="user",
            title=title,
            content=content,
            related_type="review",
            related_id=rid,
        )
        done += 1

    db.commit()
    return jsonify({"message": f"批量审核完成，成功 {done} 条，跳过 {len(skipped)} 条", "done": done, "skipped": skipped})


@app.delete("/api/admin/reviews/<int:review_id>")
def delete_review(review_id: int) -> Any:
    admin_user, err = require_role({"admin"})
    if err is not None:
        return err

    db = get_db()
    row = db.execute("SELECT id, user_name FROM reviews WHERE id = ?", (review_id,)).fetchone()
    if row is None:
        return jsonify({"message": "评价不存在"}), 404

    db.execute("DELETE FROM reviews WHERE id = ?", (review_id,))
    add_audit_log(
        db,
        entity_type="review",
        entity_id=review_id,
        action="delete",
        operator_name=admin_user["username"],
        detail=f"review_id={review_id}",
    )
    create_notification(
        db,
        username=row["user_name"],
        role="user",
        title="评价已删除",
        content="您的评价已被管理员删除。",
        related_type="review",
        related_id=review_id,
    )
    db.commit()
    return jsonify({"message": "删除成功"})


@app.get("/api/admin/stalls")
def list_admin_stalls() -> Any:
    _, err = require_role({"admin"})
    if err is not None:
        return err

    status = str(request.args.get("status", "")).strip()
    category = str(request.args.get("category", "")).strip()
    q = str(request.args.get("q", "")).strip()
    page, page_size, offset = parse_pagination(default_page_size=20, max_page_size=100)
    db = get_db()

    sql = """
        SELECT id, name, category, description, image_url, open_time, lng, lat, heat, status, merchant_name,
               is_open, live_lng, live_lat, live_updated_at,
               CASE WHEN is_open = 1 THEN '营业中' ELSE '休息中' END AS business_status
        FROM stalls
        WHERE 1=1
    """
    params: list[Any] = []
    if status:
        sql += " AND status = ?"
        params.append(status)
    if category:
        sql += " AND category = ?"
        params.append(category)
    if q:
        sql += " AND (name LIKE ? OR merchant_name LIKE ? OR description LIKE ?)"
        like_q = f"%{q}%"
        params.extend([like_q, like_q, like_q])

    count_row = db.execute(f"SELECT COUNT(*) FROM ({sql})", tuple(params)).fetchone()
    total = int(count_row[0]) if count_row else 0
    sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
    params.extend([page_size, offset])
    rows = db.execute(sql, tuple(params)).fetchall()
    return jsonify(make_paginated_result([dict(r) for r in rows], total, page, page_size))


@app.post("/api/admin/stalls/<int:stall_id>/offline")
def offline_stall(stall_id: int) -> Any:
    admin_user, err = require_role({"admin"})
    if err is not None:
        return err

    db = get_db()
    row = db.execute(
        "SELECT id, name, merchant_name, status FROM stalls WHERE id = ?",
        (stall_id,),
    ).fetchone()
    if row is None:
        return jsonify({"message": "摊位不存在"}), 404
    if row["status"] == "offline":
        return jsonify({"message": "摊位已是下架状态"}), 400

    db.execute("UPDATE stalls SET status = 'offline' WHERE id = ?", (stall_id,))
    add_audit_log(
        db,
        entity_type="stall",
        entity_id=stall_id,
        action="offline",
        operator_name=admin_user["username"],
        detail=f"stall={row['name']}",
    )
    create_notification(
        db,
        username=row["merchant_name"],
        role="merchant",
        title="摊位已下架",
        content=f"您的摊位「{row['name']}」已被管理员下架。",
        related_type="stall",
        related_id=stall_id,
    )
    db.commit()
    return jsonify({"message": "下架成功"})


@app.post("/api/admin/stalls/<int:stall_id>/restore")
def restore_stall(stall_id: int) -> Any:
    admin_user, err = require_role({"admin"})
    if err is not None:
        return err

    db = get_db()
    row = db.execute(
        "SELECT id, name, merchant_name, status FROM stalls WHERE id = ?",
        (stall_id,),
    ).fetchone()
    if row is None:
        return jsonify({"message": "摊位不存在"}), 404

    db.execute("UPDATE stalls SET status = 'approved' WHERE id = ?", (stall_id,))
    add_audit_log(
        db,
        entity_type="stall",
        entity_id=stall_id,
        action="restore",
        operator_name=admin_user["username"],
        detail=f"stall={row['name']}",
    )
    create_notification(
        db,
        username=row["merchant_name"],
        role="merchant",
        title="摊位已恢复",
        content=f"您的摊位「{row['name']}」已恢复上架。",
        related_type="stall",
        related_id=stall_id,
    )
    db.commit()
    return jsonify({"message": "恢复成功"})


@app.delete("/api/admin/stalls/<int:stall_id>")
def delete_stall(stall_id: int) -> Any:
    admin_user, err = require_role({"admin"})
    if err is not None:
        return err

    db = get_db()
    row = db.execute(
        "SELECT id, name, merchant_name FROM stalls WHERE id = ?",
        (stall_id,),
    ).fetchone()
    if row is None:
        return jsonify({"message": "摊位不存在"}), 404

    review_ids = db.execute("SELECT id FROM reviews WHERE stall_id = ?", (stall_id,)).fetchall()
    if review_ids:
        placeholders = ",".join("?" for _ in review_ids)
        rid_values = tuple(int(x["id"]) for x in review_ids)
        db.execute(f"DELETE FROM review_replies WHERE review_id IN ({placeholders})", rid_values)
    db.execute("DELETE FROM reviews WHERE stall_id = ?", (stall_id,))
    db.execute("DELETE FROM stalls WHERE id = ?", (stall_id,))
    add_audit_log(
        db,
        entity_type="stall",
        entity_id=stall_id,
        action="delete",
        operator_name=admin_user["username"],
        detail=f"stall={row['name']}",
    )
    create_notification(
        db,
        username=row["merchant_name"],
        role="merchant",
        title="摊位已删除",
        content=f"您的摊位「{row['name']}」已被管理员删除。",
        related_type="stall",
        related_id=stall_id,
    )
    db.commit()
    return jsonify({"message": "删除成功"})


@app.get("/api/notifications")
def list_notifications() -> Any:
    user, err = require_role({"user", "merchant"})
    if err is not None:
        return err

    unread_only = str(request.args.get("unread_only", "")).strip() == "1"
    page, page_size, offset = parse_pagination(default_page_size=20, max_page_size=100)
    db = get_db()

    sql = """
        SELECT id, username, role, title, content, related_type, related_id, is_read, created_at
        FROM notifications
        WHERE username = ? AND role = ?
    """
    params: list[Any] = [user["username"], user["role"]]
    if unread_only:
        sql += " AND is_read = 0"

    count_row = db.execute(f"SELECT COUNT(*) FROM ({sql})", tuple(params)).fetchone()
    total = int(count_row[0]) if count_row else 0
    sql += " ORDER BY id DESC LIMIT ? OFFSET ?"
    params.extend([page_size, offset])
    rows = db.execute(sql, tuple(params)).fetchall()
    return jsonify(make_paginated_result([dict(r) for r in rows], total, page, page_size))


@app.post("/api/notifications/<int:notification_id>/read")
def mark_notification_read(notification_id: int) -> Any:
    user, err = require_role({"user", "merchant"})
    if err is not None:
        return err

    db = get_db()
    row = db.execute(
        "SELECT id FROM notifications WHERE id = ? AND username = ? AND role = ?",
        (notification_id, user["username"], user["role"]),
    ).fetchone()
    if row is None:
        return jsonify({"message": "通知不存在"}), 404
    db.execute("UPDATE notifications SET is_read = 1 WHERE id = ?", (notification_id,))
    db.commit()
    return jsonify({"message": "已标记为已读"})


@app.post("/api/notifications/read-all")
def mark_all_notifications_read() -> Any:
    user, err = require_role({"user", "merchant"})
    if err is not None:
        return err

    db = get_db()
    db.execute(
        "UPDATE notifications SET is_read = 1 WHERE username = ? AND role = ? AND is_read = 0",
        (user["username"], user["role"]),
    )
    db.commit()
    return jsonify({"message": "全部标记为已读"})


@app.get("/api/admin/audit-logs")
def list_admin_audit_logs() -> Any:
    _, err = require_role({"admin"})
    if err is not None:
        return err

    entity_type = request.args.get("entity_type")
    action = request.args.get("action")
    q = str(request.args.get("q", "")).strip()
    db = get_db()

    sql = "SELECT id, entity_type, entity_id, action, operator_name, detail, created_at FROM audit_logs WHERE 1=1"
    params: list[Any] = []
    if entity_type:
        sql += " AND entity_type = ?"
        params.append(entity_type)
    if action:
        sql += " AND action = ?"
        params.append(action)
    if q:
        sql += " AND (operator_name LIKE ? OR detail LIKE ?)"
        like_q = f"%{q}%"
        params.extend([like_q, like_q])
    sql += " ORDER BY id DESC LIMIT 300"

    rows = db.execute(sql, tuple(params)).fetchall()
    return jsonify([dict(r) for r in rows])


if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=5000, debug=True)




