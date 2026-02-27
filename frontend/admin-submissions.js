const auth = requireRole("admin");
bindLogout();

const adminMsg = document.getElementById("adminMsg");

function setMsg(text) {
  adminMsg.textContent = text;
}

async function loadPendingSubmissions() {
  const list = document.getElementById("pendingList");
  list.innerHTML = "";
  const status = document.getElementById("submissionStatusFilter").value;
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const rows = await apiFetch(`/api/admin/submissions${qs}`, {}, auth.token);

  if (rows.length === 0) {
    list.innerHTML = "<li>暂无提交记录</li>";
    return;
  }

  rows.forEach((s) => {
    const li = document.createElement("li");
    li.className = "list-item";
    li.innerHTML = `
      <div><strong>#${s.id} ${escapeHtml(s.name)}</strong> (${escapeHtml(s.action)})</div>
      <div>商户: ${escapeHtml(s.merchant_name)} | 类别: ${escapeHtml(s.category)}</div>
      <div>位置: ${s.lat}, ${s.lng}</div>
      <div class="hint">状态: ${escapeHtml(s.status)} | 提交时间: ${escapeHtml(s.created_at || "")}</div>
      ${s.reviewed_at ? `<div class="hint">审核时间: ${escapeHtml(s.reviewed_at)}</div>` : ""}
      ${s.reject_reason ? `<div class="hint">驳回原因: ${escapeHtml(s.reject_reason)}</div>` : ""}
    `;

    if (s.status === "pending") {
      const box = document.createElement("div");
      box.className = "panel-actions";

      const approveBtn = document.createElement("button");
      approveBtn.textContent = "通过";
      approveBtn.addEventListener("click", async () => {
        try {
          const result = await apiFetch(`/api/admin/submissions/${s.id}/approve`, { method: "POST" }, auth.token);
          setMsg(result.message);
          await loadPendingSubmissions();
        } catch (error) {
          setMsg(error.message);
        }
      });

      const rejectBtn = document.createElement("button");
      rejectBtn.textContent = "驳回";
      rejectBtn.addEventListener("click", async () => {
        const reason = window.prompt("请输入驳回原因：", "信息不完整，请补充后重提");
        if (reason === null) return;
        try {
          const result = await apiFetch(
            `/api/admin/submissions/${s.id}/reject`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reject_reason: reason }),
            },
            auth.token,
          );
          setMsg(result.message);
          await loadPendingSubmissions();
        } catch (error) {
          setMsg(error.message);
        }
      });

      box.appendChild(approveBtn);
      box.appendChild(rejectBtn);
      li.appendChild(box);
    }

    list.appendChild(li);
  });
}

document.getElementById("loadPendingBtn").addEventListener("click", () => {
  loadPendingSubmissions().catch((error) => setMsg(error.message));
});
document.getElementById("submissionStatusFilter").addEventListener("change", () => {
  loadPendingSubmissions().catch((error) => setMsg(error.message));
});

loadPendingSubmissions().catch((error) => setMsg(error.message));
