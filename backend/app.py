from __future__ import annotations

import json
import secrets
import sqlite3
from pathlib import Path
from typing import Any

from flask import Flask, g, jsonify, request
from flask_cors import CORS

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DB_FILE = DATA_DIR / "night_market.db"
STALLS_JSON_FILE = DATA_DIR / "stalls.json"
SUBMISSIONS_JSON_FILE = DATA_DIR / "submissions.json"
USERS_JSON_FILE = DATA_DIR / "users.json"
REVIEWS_JSON_FILE = DATA_DIR / "reviews.json"

app = Flask(__name__)
CORS(app)

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
          merchant_name TEXT NOT NULL DEFAULT 'system'
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

    # Migration for existing database.
    if not column_exists(conn, "stalls", "merchant_name"):
        cur.execute("ALTER TABLE stalls ADD COLUMN merchant_name TEXT NOT NULL DEFAULT 'system'")
    if not column_exists(conn, "stalls", "image_url"):
        cur.execute("ALTER TABLE stalls ADD COLUMN image_url TEXT")
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
        return None, (jsonify({"message": "缺少或非法的 Authorization 头"}), 401)

    token = auth.split(" ", 1)[1].strip()
    user = TOKENS.get(token)
    if user is None:
        return None, (jsonify({"message": "登录已失效，请重新登录"}), 401)
    if user["role"] not in roles:
        return None, (jsonify({"message": "无权限访问该接口"}), 403)
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
        return False, "经纬度必须是数字"

    if not (-180 <= lng <= 180 and -90 <= lat <= 90):
        return False, "经纬度超出合法范围"

    return True, ""


def validate_review(payload: dict[str, Any]) -> tuple[bool, str]:
    try:
        rating = int(payload.get("rating", 0))
    except (TypeError, ValueError):
        return False, "评分必须是 1-5 的整数"

    content = str(payload.get("content", "")).strip()
    if rating < 1 or rating > 5:
        return False, "评分必须是 1-5 的整数"
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
        return jsonify({"message": "role、username、password 均为必填"}), 400

    db = get_db()
    matched = db.execute(
        "SELECT username, role, status FROM users WHERE role = ? AND username = ? AND password = ?",
        (role, username, password),
    ).fetchone()

    if matched is None:
        return jsonify({"message": "账号、密码或角色不正确"}), 401
    if matched["status"] != "active":
        return jsonify({"message": "账号已被冻结，请联系管理员"}), 403

    token = secrets.token_urlsafe(24)
    TOKENS[token] = {"username": matched["username"], "role": matched["role"]}
    return jsonify({"token": token, "user": {"username": matched["username"], "role": matched["role"]}})


@app.get("/api/stalls")
def list_stalls() -> Any:
    category = request.args.get("category")
    db = get_db()

    if category:
        rows = db.execute(
            """
            SELECT id, name, category, description, image_url, open_time, lng, lat, heat, status, merchant_name
            FROM stalls
            WHERE status = 'approved' AND category = ?
            ORDER BY id ASC
            """,
            (category,),
        ).fetchall()
    else:
        rows = db.execute(
            """
            SELECT id, name, category, description, image_url, open_time, lng, lat, heat, status, merchant_name
            FROM stalls
            WHERE status = 'approved'
            ORDER BY id ASC
            """
        ).fetchall()

    return jsonify([dict(r) for r in rows])


@app.get("/api/stalls/<int:stall_id>")
def get_stall(stall_id: int) -> Any:
    db = get_db()
    row = db.execute(
        """
        SELECT id, name, category, description, image_url, open_time, lng, lat, heat, status, merchant_name
        FROM stalls
        WHERE id = ? AND status = 'approved'
        """,
        (stall_id,),
    ).fetchone()

    if row is None:
        return jsonify({"message": "未找到摊位"}), 404

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
    rows = db.execute(
        """
        SELECT id, name, category, description, image_url, open_time, lng, lat, heat, status, merchant_name
        FROM stalls
        WHERE merchant_name = ?
        ORDER BY id DESC
        """,
        (user["username"],),
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.get("/api/merchant/submissions")
def list_merchant_submissions() -> Any:
    user, err = require_role({"merchant"})
    if err is not None:
        return err

    db = get_db()
    rows = db.execute(
        "SELECT * FROM submissions WHERE merchant_name = ? ORDER BY id DESC",
        (user["username"],),
    ).fetchall()
    return jsonify([dict(r) for r in rows])


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
    return jsonify({"message": "新增摊位申请已提交，等待管理员审核", "submission": dict(submission)}), 201


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
        return jsonify({"message": "只能修改你自己的摊位"}), 403

    new_id = create_submission_record(db, user["username"], payload)
    submission = db.execute("SELECT * FROM submissions WHERE id = ?", (new_id,)).fetchone()
    return jsonify({"message": "修改申请已提交，等待管理员审核", "submission": dict(submission)}), 201


@app.post("/api/merchant/submissions")
def create_submission_compat() -> Any:
    # Backward-compatible endpoint.
    return create_merchant_stall_submission()


@app.get("/api/admin/submissions")
def list_admin_submissions() -> Any:
    _, err = require_role({"admin"})
    if err is not None:
        return err

    status = request.args.get("status", "pending")
    db = get_db()

    if status:
        rows = db.execute(
            "SELECT * FROM submissions WHERE status = ? ORDER BY id ASC",
            (status,),
        ).fetchall()
    else:
        rows = db.execute("SELECT * FROM submissions ORDER BY id ASC").fetchall()

    return jsonify([dict(r) for r in rows])


@app.post("/api/admin/submissions/<int:submission_id>/approve")
def approve_submission(submission_id: int) -> Any:
    admin_user, err = require_role({"admin"})
    if err is not None:
        return err

    db = get_db()
    submission = db.execute("SELECT * FROM submissions WHERE id = ?", (submission_id,)).fetchone()
    if submission is None:
        return jsonify({"message": "未找到提交记录"}), 404

    if submission["status"] != "pending":
        return jsonify({"message": "该记录不是待审核状态"}), 400

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
    db.commit()

    return jsonify({"message": "审核通过并已写入数据库"})


@app.post("/api/admin/submissions/<int:submission_id>/reject")
def reject_submission(submission_id: int) -> Any:
    admin_user, err = require_role({"admin"})
    if err is not None:
        return err

    payload = request.get_json(silent=True) or {}
    reject_reason = str(payload.get("reject_reason", "")).strip()
    if not reject_reason:
        return jsonify({"message": "请填写驳回原因"}), 400
    if len(reject_reason) > 200:
        return jsonify({"message": "驳回原因不能超过 200 字"}), 400

    db = get_db()
    row = db.execute("SELECT id, status FROM submissions WHERE id = ?", (submission_id,)).fetchone()
    if row is None:
        return jsonify({"message": "未找到提交记录"}), 404
    if row["status"] != "pending":
        return jsonify({"message": "该记录不是待审核状态"}), 400

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
    db.commit()
    return jsonify({"message": "已驳回该提交"})


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
        return jsonify({"message": "username、password 必填，role 仅支持 user/merchant"}), 400

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
    return jsonify({"message": "账号创建成功", "user": dict(row)}), 201


@app.post("/api/admin/users/<int:user_id>/freeze")
def freeze_admin_user(user_id: int) -> Any:
    admin_user, err = require_role({"admin"})
    if err is not None:
        return err

    db = get_db()
    row = db.execute("SELECT id, role FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        return jsonify({"message": "账号不存在"}), 404
    if row["role"] == "admin":
        return jsonify({"message": "不允许冻结管理员账号"}), 400

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
    return jsonify({"message": "账号已冻结"})


@app.post("/api/admin/users/<int:user_id>/unfreeze")
def unfreeze_admin_user(user_id: int) -> Any:
    admin_user, err = require_role({"admin"})
    if err is not None:
        return err

    db = get_db()
    row = db.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        return jsonify({"message": "账号不存在"}), 404

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
    return jsonify({"message": "账号已解冻"})


@app.get("/api/reviews")
def list_public_reviews() -> Any:
    stall_id = request.args.get("stall_id")
    db = get_db()

    if stall_id:
        rows = db.execute(
            """
            SELECT r.id, r.stall_id, r.user_name, r.rating, r.content, r.merchant_reply, r.status,
                   r.created_at, r.updated_at, s.name AS stall_name
            FROM reviews r
            JOIN stalls s ON s.id = r.stall_id
            WHERE r.status = 'approved' AND r.stall_id = ?
            ORDER BY r.id DESC
            """,
            (stall_id,),
        ).fetchall()
    else:
        rows = db.execute(
            """
            SELECT r.id, r.stall_id, r.user_name, r.rating, r.content, r.merchant_reply, r.status,
                   r.created_at, r.updated_at, s.name AS stall_name
            FROM reviews r
            JOIN stalls s ON s.id = r.stall_id
            WHERE r.status = 'approved'
            ORDER BY r.id DESC
            LIMIT 200
            """
        ).fetchall()

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

    return jsonify(reviews)


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
        return jsonify({"message": "stall_id 非法"}), 400

    db = get_db()
    stall = db.execute("SELECT id FROM stalls WHERE id = ? AND status = 'approved'", (stall_id,)).fetchone()
    if stall is None:
        return jsonify({"message": "目标摊位不存在"}), 404

    cur = db.execute(
        """
        INSERT INTO reviews (stall_id, user_name, rating, content, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'pending', datetime('now', 'localtime'), datetime('now', 'localtime'))
        """,
        (stall_id, user["username"], int(payload["rating"]), str(payload["content"]).strip()),
    )
    db.commit()

    row = db.execute("SELECT * FROM reviews WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify({"message": "评价已提交，等待管理员审核", "review": dict(row)}), 201


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
        return jsonify({"message": "目标评论不存在或未通过审核"}), 404

    if parent_reply_id is not None:
        try:
            parent_reply_id = int(parent_reply_id)
        except (TypeError, ValueError):
            return jsonify({"message": "parent_reply_id 非法"}), 400
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
    return jsonify({"message": "回复已发布", "reply": dict(row)}), 201


@app.get("/api/merchant/reviews")
def list_merchant_reviews() -> Any:
    user, err = require_role({"merchant"})
    if err is not None:
        return err

    status = request.args.get("status")
    stall_id = request.args.get("stall_id")
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
            return jsonify({"message": "stall_id 非法"}), 400
        sql += " AND r.stall_id = ?"
        params.append(stall_id_int)
    if status:
        sql += " AND r.status = ?"
        params.append(status)
    sql += " ORDER BY r.id DESC"

    rows = db.execute(sql, tuple(params)).fetchall()
    return jsonify([dict(r) for r in rows])


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
        SELECT r.id
        FROM reviews r
        JOIN stalls s ON s.id = r.stall_id
        WHERE r.id = ? AND s.merchant_name = ?
        """,
        (review_id, user["username"]),
    ).fetchone()
    if row is None:
        return jsonify({"message": "无法回复不属于你的评价"}), 403

    db.execute(
        """
        UPDATE reviews
        SET merchant_reply = ?, merchant_reply_at = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime')
        WHERE id = ?
        """,
        (reply, review_id),
    )
    db.commit()
    return jsonify({"message": "回复已保存"})


@app.get("/api/admin/reviews")
def list_admin_reviews() -> Any:
    _, err = require_role({"admin"})
    if err is not None:
        return err

    status = request.args.get("status")
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
    sql += " ORDER BY r.id DESC"

    rows = db.execute(sql, tuple(params)).fetchall()
    return jsonify([dict(r) for r in rows])


@app.post("/api/admin/reviews/<int:review_id>/approve")
def approve_review(review_id: int) -> Any:
    admin_user, err = require_role({"admin"})
    if err is not None:
        return err

    db = get_db()
    row = db.execute("SELECT id FROM reviews WHERE id = ?", (review_id,)).fetchone()
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
    db.commit()
    return jsonify({"message": "评价已审核通过"})


@app.post("/api/admin/reviews/<int:review_id>/reject")
def reject_review(review_id: int) -> Any:
    admin_user, err = require_role({"admin"})
    if err is not None:
        return err

    db = get_db()
    row = db.execute("SELECT id FROM reviews WHERE id = ?", (review_id,)).fetchone()
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
    db.commit()
    return jsonify({"message": "评价已驳回"})


@app.delete("/api/admin/reviews/<int:review_id>")
def delete_review(review_id: int) -> Any:
    admin_user, err = require_role({"admin"})
    if err is not None:
        return err

    db = get_db()
    row = db.execute("SELECT id FROM reviews WHERE id = ?", (review_id,)).fetchone()
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
    db.commit()
    return jsonify({"message": "评价已删除"})


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
