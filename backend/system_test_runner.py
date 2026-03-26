from __future__ import annotations

import json
import shutil
import sqlite3
import statistics
import sys
import tempfile
import time
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import backend.app as app_module


ORIGINAL_DB_FILE = ROOT_DIR / "data" / "night_market.db"


@dataclass
class TestCaseResult:
    case_id: str
    category: str
    objective: str
    expected: str
    actual: str
    passed: bool
    status_code: int | None = None


def fetch_counts(db_path: Path) -> dict[str, int]:
    conn = sqlite3.connect(db_path)
    try:
        conn.row_factory = sqlite3.Row
        tables = ["users", "stalls", "reviews", "submissions", "notifications", "audit_logs"]
        counts: dict[str, int] = {}
        for table in tables:
            row = conn.execute(f"SELECT COUNT(*) AS c FROM {table}").fetchone()
            counts[table] = int(row["c"]) if row is not None else 0
        return counts
    finally:
        conn.close()


def query_one(db_path: Path, sql: str, params: tuple[Any, ...] = ()) -> sqlite3.Row | None:
    conn = sqlite3.connect(db_path)
    try:
        conn.row_factory = sqlite3.Row
        return conn.execute(sql, params).fetchone()
    finally:
        conn.close()


def percentile(values: list[float], ratio: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int(round((len(ordered) - 1) * ratio))))
    return ordered[index]


def benchmark(name: str, fn: Callable[[], Any], rounds: int = 20, warmup: int = 3) -> dict[str, Any]:
    for _ in range(warmup):
        fn()

    elapsed_ms: list[float] = []
    for _ in range(rounds):
        start = time.perf_counter()
        fn()
        elapsed_ms.append((time.perf_counter() - start) * 1000)

    return {
        "name": name,
        "rounds": rounds,
        "avg_ms": round(statistics.mean(elapsed_ms), 2),
        "median_ms": round(statistics.median(elapsed_ms), 2),
        "p95_ms": round(percentile(elapsed_ms, 0.95), 2),
        "max_ms": round(max(elapsed_ms), 2),
    }


def get_json(response: Any) -> dict[str, Any]:
    payload = response.get_json(silent=True)
    return payload if isinstance(payload, dict) else {}


def login(client: Any, role: str, username: str, password: str) -> tuple[Any, dict[str, Any]]:
    response = client.post(
        "/api/auth/login",
        json={"role": role, "username": username, "password": password},
    )
    return response, get_json(response)


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def make_submission_payload(name: str, category: str = "测试小吃") -> dict[str, Any]:
    return {
        "name": name,
        "category": category,
        "description": "系统测试自动生成的摊位记录",
        "image_url": "",
        "open_time": "18:00-23:30",
        "lng": 112.9388,
        "lat": 28.2282,
        "heat": 0.78,
    }


def main() -> None:
    base_counts = fetch_counts(ORIGINAL_DB_FILE)
    results: list[TestCaseResult] = []

    with tempfile.TemporaryDirectory(prefix="night_market_test_", dir=str(ROOT_DIR / "data")) as temp_dir:
        temp_db_file = Path(temp_dir) / "night_market_test.db"
        shutil.copy2(ORIGINAL_DB_FILE, temp_db_file)

        app_module.DB_FILE = temp_db_file
        app_module.TOKENS.clear()
        app_module.init_db()
        app_module.app.testing = True
        client = app_module.app.test_client()

        sample_stall = query_one(
            temp_db_file,
            "SELECT id, name FROM stalls WHERE status = 'approved' ORDER BY id ASC LIMIT 1",
        )
        merchant_stall = query_one(
            temp_db_file,
            "SELECT id, name, lng, lat FROM stalls WHERE status = 'approved' AND merchant_name = 'merchant01' ORDER BY id ASC LIMIT 1",
        )
        if sample_stall is None or merchant_stall is None:
            raise RuntimeError("测试数据不足，无法找到基础摊位样本。")

        keyword = str(sample_stall["name"])[:4]
        unique_suffix = uuid.uuid4().hex[:8]

        user_login_resp, user_login_data = login(client, "user", "user01", "123456")
        merchant_login_resp, merchant_login_data = login(client, "merchant", "merchant01", "123456")
        admin_login_resp, admin_login_data = login(client, "admin", "admin01", "123456")
        user_token = str(user_login_data.get("token", ""))
        merchant_token = str(merchant_login_data.get("token", ""))
        admin_token = str(admin_login_data.get("token", ""))

        results.append(
            TestCaseResult(
                case_id="TC01",
                category="普通用户",
                objective="用户登录",
                expected="正确账号密码登录后返回 Token",
                actual="登录成功并返回 Token" if user_login_resp.status_code == 200 and user_token else "登录失败",
                passed=user_login_resp.status_code == 200 and bool(user_token),
                status_code=user_login_resp.status_code,
            )
        )

        list_stalls_resp = client.get("/api/stalls?page=1&page_size=20")
        list_stalls_data = get_json(list_stalls_resp)
        stall_items = list_stalls_data.get("items", [])
        results.append(
            TestCaseResult(
                case_id="TC02",
                category="普通用户",
                objective="地图浏览",
                expected="摊位列表正常返回并可用于地图点位渲染",
                actual=f"返回 {len(stall_items)} 条摊位记录",
                passed=list_stalls_resp.status_code == 200 and isinstance(stall_items, list) and len(stall_items) > 0,
                status_code=list_stalls_resp.status_code,
            )
        )

        filter_resp = client.get(f"/api/stalls?q={keyword}")
        filter_data = get_json(filter_resp)
        filter_items = filter_data.get("items", [])
        filter_passed = filter_resp.status_code == 200 and isinstance(filter_items, list) and len(filter_items) > 0
        results.append(
            TestCaseResult(
                case_id="TC03",
                category="普通用户",
                objective="关键字筛选",
                expected="输入关键字后返回匹配摊位",
                actual=f"关键字“{keyword}”匹配 {len(filter_items)} 条记录",
                passed=filter_passed,
                status_code=filter_resp.status_code,
            )
        )

        review_content = f"系统测试评价 {unique_suffix}"
        create_review_resp = client.post(
            "/api/reviews",
            headers=auth_header(user_token),
            json={"stall_id": int(merchant_stall["id"]), "rating": 5, "content": review_content},
        )
        create_review_data = get_json(create_review_resp)
        created_review = create_review_data.get("review", {})
        created_review_id = int(created_review.get("id", 0))
        results.append(
            TestCaseResult(
                case_id="TC04",
                category="普通用户",
                objective="评价提交",
                expected="评价写入数据库并进入待审核状态",
                actual=f"评价状态为 {created_review.get('status', 'unknown')}",
                passed=create_review_resp.status_code == 201 and created_review.get("status") == "pending",
                status_code=create_review_resp.status_code,
            )
        )

        approve_review_resp = client.post(
            f"/api/admin/reviews/{created_review_id}/approve",
            headers=auth_header(admin_token),
        )

        merchant_reply_text = f"商户回复 {unique_suffix}"
        merchant_reply_resp = client.post(
            f"/api/merchant/reviews/{created_review_id}/reply",
            headers=auth_header(merchant_token),
            json={"reply": merchant_reply_text},
        )
        reply_row = query_one(
            temp_db_file,
            "SELECT merchant_reply FROM reviews WHERE id = ?",
            (created_review_id,),
        )
        results.append(
            TestCaseResult(
                case_id="TC09",
                category="商户",
                objective="评价回复",
                expected="商户可回复本摊位用户评价并写入记录",
                actual="回复成功并写入评价表" if reply_row and reply_row["merchant_reply"] == merchant_reply_text else "回复失败",
                passed=approve_review_resp.status_code == 200
                and merchant_reply_resp.status_code == 200
                and reply_row is not None
                and reply_row["merchant_reply"] == merchant_reply_text,
                status_code=merchant_reply_resp.status_code,
            )
        )

        public_review_resp = client.get(f"/api/reviews?stall_id={int(merchant_stall['id'])}&q={unique_suffix}")
        public_review_data = get_json(public_review_resp)
        public_review_items = public_review_data.get("items", [])
        matched_review = next((item for item in public_review_items if int(item.get("id", 0)) == created_review_id), None)
        results.append(
            TestCaseResult(
                case_id="TC05",
                category="普通用户",
                objective="查看商户回复",
                expected="审核通过后的评价可查看商户回复内容",
                actual="已查询到商户回复" if matched_review and matched_review.get("merchant_reply") == merchant_reply_text else "未查询到商户回复",
                passed=public_review_resp.status_code == 200
                and matched_review is not None
                and matched_review.get("merchant_reply") == merchant_reply_text,
                status_code=public_review_resp.status_code,
            )
        )

        create_submission_name = f"系统测试新增摊位-{unique_suffix}"
        create_submission_resp = client.post(
            "/api/merchant/stalls",
            headers=auth_header(merchant_token),
            json=make_submission_payload(create_submission_name),
        )
        create_submission_data = get_json(create_submission_resp)
        create_submission = create_submission_data.get("submission", {})
        create_submission_id = int(create_submission.get("id", 0))
        results.append(
            TestCaseResult(
                case_id="TC06",
                category="商户",
                objective="新增摊位申请",
                expected="提交后进入待审核状态",
                actual=f"提交状态为 {create_submission.get('status', 'unknown')}",
                passed=create_submission_resp.status_code == 201 and create_submission.get("status") == "pending",
                status_code=create_submission_resp.status_code,
            )
        )

        update_submission_resp = client.post(
            f"/api/merchant/stalls/{int(merchant_stall['id'])}/update",
            headers=auth_header(merchant_token),
            json={
                "name": str(merchant_stall["name"]),
                "category": "烧烤",
                "description": f"系统测试修改说明 {unique_suffix}",
                "image_url": "",
                "open_time": "17:30-23:30",
                "lng": float(merchant_stall["lng"]),
                "lat": float(merchant_stall["lat"]),
                "heat": 0.83,
            },
        )
        update_submission_data = get_json(update_submission_resp)
        update_submission = update_submission_data.get("submission", {})
        update_submission_id = int(update_submission.get("id", 0))
        results.append(
            TestCaseResult(
                case_id="TC07",
                category="商户",
                objective="修改摊位申请",
                expected="修改申请提交后进入待审核状态",
                actual=f"提交状态为 {update_submission.get('status', 'unknown')}",
                passed=update_submission_resp.status_code == 201 and update_submission.get("status") == "pending",
                status_code=update_submission_resp.status_code,
            )
        )

        open_resp = client.post(
            f"/api/merchant/stalls/{int(merchant_stall['id'])}/open",
            headers=auth_header(merchant_token),
            json={"lng": float(merchant_stall["lng"]) + 0.0001, "lat": float(merchant_stall["lat"]) + 0.0001},
        )
        open_row = query_one(temp_db_file, "SELECT is_open FROM stalls WHERE id = ?", (int(merchant_stall["id"]),))
        close_resp = client.post(
            f"/api/merchant/stalls/{int(merchant_stall['id'])}/close",
            headers=auth_header(merchant_token),
        )
        close_row = query_one(temp_db_file, "SELECT is_open FROM stalls WHERE id = ?", (int(merchant_stall["id"]),))
        results.append(
            TestCaseResult(
                case_id="TC08",
                category="商户",
                objective="开摊与收摊",
                expected="开摊后状态变为营业中，收摊后恢复休息中",
                actual="开摊与收摊均执行成功" if open_row and close_row and int(open_row["is_open"]) == 1 and int(close_row["is_open"]) == 0 else "状态更新异常",
                passed=open_resp.status_code == 200
                and close_resp.status_code == 200
                and open_row is not None
                and close_row is not None
                and int(open_row["is_open"]) == 1
                and int(close_row["is_open"]) == 0,
                status_code=open_resp.status_code,
            )
        )

        approve_submission_resp = client.post(
            f"/api/admin/submissions/{create_submission_id}/approve",
            headers=auth_header(admin_token),
        )
        created_stall = query_one(
            temp_db_file,
            "SELECT id, status FROM stalls WHERE name = ? ORDER BY id DESC LIMIT 1",
            (create_submission_name,),
        )
        results.append(
            TestCaseResult(
                case_id="TC11",
                category="管理员",
                objective="摊位审核通过",
                expected="审核通过后摊位进入公开列表",
                actual="摊位已写入主表并处于 approved 状态" if created_stall and created_stall["status"] == "approved" else "审核未生效",
                passed=approve_submission_resp.status_code == 200
                and created_stall is not None
                and created_stall["status"] == "approved",
                status_code=approve_submission_resp.status_code,
            )
        )

        reject_reason = "系统测试驳回说明"
        reject_submission_resp = client.post(
            f"/api/admin/submissions/{update_submission_id}/reject",
            headers=auth_header(admin_token),
            json={"reject_reason": reject_reason},
        )
        rejected_submission = query_one(
            temp_db_file,
            "SELECT status, reject_reason FROM submissions WHERE id = ?",
            (update_submission_id,),
        )
        results.append(
            TestCaseResult(
                case_id="TC12",
                category="管理员",
                objective="摊位审核驳回",
                expected="审核驳回后记录拒绝原因",
                actual=f"状态={rejected_submission['status']}，原因={rejected_submission['reject_reason']}" if rejected_submission else "未查询到驳回记录",
                passed=reject_submission_resp.status_code == 200
                and rejected_submission is not None
                and rejected_submission["status"] == "rejected"
                and rejected_submission["reject_reason"] == reject_reason,
                status_code=reject_submission_resp.status_code,
            )
        )

        batch_submission_ids: list[int] = []
        for batch_index in range(2):
            batch_name = f"系统测试批量提交-{unique_suffix}-{batch_index + 1}"
            resp = client.post(
                "/api/merchant/stalls",
                headers=auth_header(merchant_token),
                json=make_submission_payload(batch_name, category="测试饮品"),
            )
            payload = get_json(resp)
            submission = payload.get("submission", {})
            batch_submission_ids.append(int(submission.get("id", 0)))
        batch_review_resp = client.post(
            "/api/admin/submissions/batch-review",
            headers=auth_header(admin_token),
            json={"ids": batch_submission_ids, "action": "approve"},
        )
        batch_review_data = get_json(batch_review_resp)
        results.append(
            TestCaseResult(
                case_id="TC13",
                category="管理员",
                objective="批量审核",
                expected="多条待审核记录可一次性审核通过",
                actual=f"done={batch_review_data.get('done')}，skipped={len(batch_review_data.get('skipped', []))}",
                passed=batch_review_resp.status_code == 200
                and batch_review_data.get("done") == 2
                and len(batch_review_data.get("skipped", [])) == 0,
                status_code=batch_review_resp.status_code,
            )
        )

        temp_username = f"case_user_{unique_suffix}"
        create_user_resp = client.post(
            "/api/admin/users",
            headers=auth_header(admin_token),
            json={"username": temp_username, "password": "123456", "role": "user"},
        )
        create_user_data = get_json(create_user_resp)
        temp_user = create_user_data.get("user", {})
        temp_user_id = int(temp_user.get("id", 0))
        freeze_user_resp = client.post(
            f"/api/admin/users/{temp_user_id}/freeze",
            headers=auth_header(admin_token),
        )
        frozen_login_resp, frozen_login_data = login(client, "user", temp_username, "123456")
        results.append(
            TestCaseResult(
                case_id="TC14",
                category="管理员",
                objective="冻结用户",
                expected="被冻结账号无法登录",
                actual=f"登录返回 {frozen_login_resp.status_code}，提示：{frozen_login_data.get('message', '')}",
                passed=create_user_resp.status_code == 201
                and freeze_user_resp.status_code == 200
                and frozen_login_resp.status_code == 403,
                status_code=frozen_login_resp.status_code,
            )
        )

        merchant_notification_resp = client.get(
            "/api/notifications?page=1&page_size=20",
            headers=auth_header(merchant_token),
        )
        merchant_notification_data = get_json(merchant_notification_resp)
        merchant_notifications = merchant_notification_data.get("items", [])
        merchant_titles = {str(item.get("title", "")) for item in merchant_notifications}
        results.append(
            TestCaseResult(
                case_id="TC10",
                category="商户",
                objective="查看系统通知",
                expected="可查看审核结果等通知信息",
                actual=f"共查询到 {len(merchant_notifications)} 条通知",
                passed=merchant_notification_resp.status_code == 200
                and len(merchant_notifications) > 0
                and ("提交审核通过" in merchant_titles or "提交审核驳回" in merchant_titles),
                status_code=merchant_notification_resp.status_code,
            )
        )

        audit_log_resp = client.get("/api/admin/audit-logs", headers=auth_header(admin_token))
        audit_logs = audit_log_resp.get_json(silent=True) or []
        has_expected_log = any(
            str(item.get("action", "")) in {"freeze", "approve", "batch_approve", "reject"} for item in audit_logs
        )
        results.append(
            TestCaseResult(
                case_id="TC15",
                category="管理员",
                objective="日志查看",
                expected="管理员可查询审核和用户管理日志",
                actual=f"返回 {len(audit_logs)} 条日志记录",
                passed=audit_log_resp.status_code == 200 and isinstance(audit_logs, list) and has_expected_log,
                status_code=audit_log_resp.status_code,
            )
        )

        unauthorized_resp = client.get("/api/merchant/stalls")
        unauthorized_data = get_json(unauthorized_resp)
        results.append(
            TestCaseResult(
                case_id="EX01",
                category="异常",
                objective="未授权访问",
                expected="未携带 Token 访问受保护接口时返回 401",
                actual=f"返回 {unauthorized_resp.status_code}，提示：{unauthorized_data.get('message', '')}",
                passed=unauthorized_resp.status_code == 401,
                status_code=unauthorized_resp.status_code,
            )
        )

        bad_review_resp = client.post(
            "/api/reviews",
            headers=auth_header(user_token),
            json={"rating": 4, "content": "缺少 stall_id 的测试评价"},
        )
        bad_review_data = get_json(bad_review_resp)
        results.append(
            TestCaseResult(
                case_id="EX02",
                category="异常",
                objective="参数错误",
                expected="缺少必要参数时拒绝请求",
                actual=f"返回 {bad_review_resp.status_code}，提示：{bad_review_data.get('message', '')}",
                passed=bad_review_resp.status_code == 400,
                status_code=bad_review_resp.status_code,
            )
        )

        duplicate_approve_resp = client.post(
            f"/api/admin/submissions/{create_submission_id}/approve",
            headers=auth_header(admin_token),
        )
        duplicate_approve_data = get_json(duplicate_approve_resp)
        results.append(
            TestCaseResult(
                case_id="EX03",
                category="异常",
                objective="重复审核",
                expected="同一提交重复审核时应阻止重复操作",
                actual=f"返回 {duplicate_approve_resp.status_code}，提示：{duplicate_approve_data.get('message', '')}",
                passed=duplicate_approve_resp.status_code == 400,
                status_code=duplicate_approve_resp.status_code,
            )
        )

        forbidden_resp = client.get("/api/admin/users", headers=auth_header(user_token))
        forbidden_data = get_json(forbidden_resp)
        results.append(
            TestCaseResult(
                case_id="EX04",
                category="异常",
                objective="越权访问",
                expected="普通用户访问管理员接口时返回 403",
                actual=f"返回 {forbidden_resp.status_code}，提示：{forbidden_data.get('message', '')}",
                passed=forbidden_resp.status_code == 403,
                status_code=forbidden_resp.status_code,
            )
        )

        benchmarks = [
            benchmark(
                "login_user",
                lambda: client.post(
                    "/api/auth/login",
                    json={"role": "user", "username": "user01", "password": "123456"},
                ),
            ),
            benchmark("list_stalls_20", lambda: client.get("/api/stalls?page=1&page_size=20")),
            benchmark("heatmap_density", lambda: client.get("/api/heatmap?mode=density")),
            benchmark(
                "admin_stalls_20",
                lambda: client.get("/api/admin/stalls?page=1&page_size=20", headers=auth_header(admin_token)),
            ),
        ]

        post_run_counts = fetch_counts(temp_db_file)

    summary = {
        "environment": {
            "os": "Windows 10",
            "language": "Python 3.10",
            "framework": "Flask",
            "database": "SQLite",
            "map_component": "Leaflet",
            "browser": "Chrome / Edge",
            "api_test_tool": "Flask test_client + SQLite 查询",
        },
        "base_counts": base_counts,
        "post_run_counts": post_run_counts,
        "test_cases": [asdict(item) for item in results],
        "benchmarks": benchmarks,
        "pass_count": sum(1 for item in results if item.passed),
        "fail_count": sum(1 for item in results if not item.passed),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
