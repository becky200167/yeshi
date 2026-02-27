const auth = requireRole("admin");
bindLogout();

const adminMsg = document.getElementById("adminMsg");

function setMsg(text) {
  adminMsg.textContent = text;
}

async function loadAdminReviews() {
  const status = document.getElementById("reviewStatusFilter").value;
  const list = document.getElementById("adminReviewsList");
  list.innerHTML = "";

  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const rows = await apiFetch(`/api/admin/reviews${qs}`, {}, auth.token);

  if (rows.length === 0) {
    list.innerHTML = "<li>暂无评价记录</li>";
    return;
  }

  rows.forEach((r) => {
    const li = document.createElement("li");
    li.className = "list-item";
    li.innerHTML = `
      <div><strong>${escapeHtml(r.stall_name)}</strong> | ${escapeHtml(r.user_name)} | ${stars(r.rating)} (${r.rating})</div>
      <div>${escapeHtml(r.content)}</div>
      <div class="hint">状态: ${escapeHtml(r.status)} | 商户: ${escapeHtml(r.merchant_name || "")}</div>
      ${r.merchant_reply ? `<div class="reply-box">商户回复：${escapeHtml(r.merchant_reply)}</div>` : ""}
    `;

    const actionBox = document.createElement("div");
    actionBox.className = "panel-actions";

    const approveBtn = document.createElement("button");
    approveBtn.textContent = "通过";
    approveBtn.addEventListener("click", async () => {
      try {
        const result = await apiFetch(`/api/admin/reviews/${r.id}/approve`, { method: "POST" }, auth.token);
        setMsg(result.message);
        await loadAdminReviews();
      } catch (error) {
        setMsg(error.message);
      }
    });

    const rejectBtn = document.createElement("button");
    rejectBtn.textContent = "驳回";
    rejectBtn.addEventListener("click", async () => {
      try {
        const result = await apiFetch(`/api/admin/reviews/${r.id}/reject`, { method: "POST" }, auth.token);
        setMsg(result.message);
        await loadAdminReviews();
      } catch (error) {
        setMsg(error.message);
      }
    });

    const delBtn = document.createElement("button");
    delBtn.textContent = "删除";
    delBtn.addEventListener("click", async () => {
      try {
        const result = await apiFetch(`/api/admin/reviews/${r.id}`, { method: "DELETE" }, auth.token);
        setMsg(result.message);
        await loadAdminReviews();
      } catch (error) {
        setMsg(error.message);
      }
    });

    actionBox.appendChild(approveBtn);
    actionBox.appendChild(rejectBtn);
    actionBox.appendChild(delBtn);
    li.appendChild(actionBox);
    list.appendChild(li);
  });
}

document.getElementById("loadReviewsBtn").addEventListener("click", () => {
  loadAdminReviews().catch((error) => setMsg(error.message));
});
document.getElementById("reviewStatusFilter").addEventListener("change", () => {
  loadAdminReviews().catch((error) => setMsg(error.message));
});

loadAdminReviews().catch((error) => setMsg(error.message));
