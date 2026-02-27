const auth = requireRole("admin");
bindLogout();

const adminMsg = document.getElementById("adminMsg");

function setMsg(text) {
  adminMsg.textContent = text;
}

async function loadAuditLogs() {
  const entityType = document.getElementById("logEntityFilter").value;
  const action = document.getElementById("logActionFilter").value;
  const q = document.getElementById("logSearchInput").value.trim();
  const list = document.getElementById("auditLogList");
  list.innerHTML = "";

  const params = new URLSearchParams();
  if (entityType) params.set("entity_type", entityType);
  if (action) params.set("action", action);
  if (q) params.set("q", q);
  const qs = params.toString() ? `?${params.toString()}` : "";

  const rows = await apiFetch(`/api/admin/audit-logs${qs}`, {}, auth.token);
  if (rows.length === 0) {
    list.innerHTML = "<li>暂无审核记录</li>";
    return;
  }

  rows.forEach((r) => {
    const li = document.createElement("li");
    li.className = "list-item";
    li.innerHTML = `
      <div><strong>#${r.id}</strong> [${escapeHtml(r.entity_type)}] ${escapeHtml(r.action)}</div>
      <div>操作者: ${escapeHtml(r.operator_name)} | 实体ID: ${escapeHtml(String(r.entity_id ?? ""))}</div>
      <div class="hint">${escapeHtml(r.detail || "")}</div>
      <div class="hint">${escapeHtml(r.created_at || "")}</div>
    `;
    list.appendChild(li);
  });
}

document.getElementById("loadLogsBtn").addEventListener("click", () => {
  loadAuditLogs().catch((error) => setMsg(error.message));
});
document.getElementById("logEntityFilter").addEventListener("change", () => {
  loadAuditLogs().catch((error) => setMsg(error.message));
});
document.getElementById("logActionFilter").addEventListener("change", () => {
  loadAuditLogs().catch((error) => setMsg(error.message));
});

loadAuditLogs().catch((error) => setMsg(error.message));
