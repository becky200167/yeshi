const auth = requireRole("admin");
bindLogout();

const adminMsg = document.getElementById("adminMsg");
const batchHint = document.getElementById("reviewBatchHint");
const pageInfo = document.getElementById("reviewPageInfo");
let currentPage = 1;
let totalPages = 1;
const selectedIds = new Set();

function setMsg(text) {
  adminMsg.textContent = text;
}

function updateBatchHint() {
  batchHint.textContent = selectedIds.size > 0 ? `已选择 ${selectedIds.size} 条` : "未选择记录";
}

async function loadAdminReviews() {
  const status = document.getElementById("reviewStatusFilter").value;
  const q = document.getElementById("reviewSearchInput").value.trim();
  const list = document.getElementById("adminReviewsList");
  list.innerHTML = "";
  selectedIds.clear();
  updateBatchHint();

  const params = new URLSearchParams({ page: String(currentPage), page_size: "10" });
  if (status) params.set("status", status);
  if (q) params.set("q", q);
  const data = await apiFetch(`/api/admin/reviews?${params.toString()}`, {}, auth.token);
  const { items, pagination } = unwrapItems(data);
  totalPages = pagination?.total_pages || 1;
  pageInfo.textContent = `第 ${pagination?.page || 1} / ${totalPages} 页，共 ${pagination?.total || items.length} 条`;

  if (items.length === 0) {
    list.innerHTML = "<li>暂无评价记录</li>";
    return;
  }

  items.forEach((r) => {
    const li = document.createElement("li");
    li.className = "list-item";
    li.innerHTML = `
      <label><input type="checkbox" data-review-id="${r.id}" ${r.status === "pending" ? "" : "disabled"} /> 选择</label>
      <div><strong>${escapeHtml(r.stall_name)}</strong> | ${escapeHtml(r.user_name)} | ${stars(r.rating)} (${r.rating})</div>
      <div>${escapeHtml(r.content)}</div>
      <div class="hint">状态: ${escapeHtml(r.status)} | 商户: ${escapeHtml(r.merchant_name || "")}</div>
      ${r.merchant_reply ? `<div class="reply-box">商户回复：${escapeHtml(r.merchant_reply)}</div>` : ""}
    `;

    li.querySelector(`input[data-review-id="${r.id}"]`)?.addEventListener("change", (e) => {
      if (e.target.checked) selectedIds.add(r.id);
      else selectedIds.delete(r.id);
      updateBatchHint();
    });

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

async function batchReview(action) {
  if (selectedIds.size === 0) {
    setMsg("请先选择待审核评价");
    return;
  }
  try {
    const result = await apiFetch(
      "/api/admin/reviews/batch-review",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds), action }),
      },
      auth.token,
    );
    setMsg(result.message);
    await loadAdminReviews();
  } catch (error) {
    setMsg(error.message);
  }
}

document.getElementById("loadReviewsBtn").addEventListener("click", () => {
  currentPage = 1;
  loadAdminReviews().catch((error) => setMsg(error.message));
});
document.getElementById("reviewStatusFilter").addEventListener("change", () => {
  currentPage = 1;
  loadAdminReviews().catch((error) => setMsg(error.message));
});
document.getElementById("reviewSearchBtn").addEventListener("click", () => {
  currentPage = 1;
  loadAdminReviews().catch((error) => setMsg(error.message));
});
document.getElementById("batchApproveReviewsBtn").addEventListener("click", () => batchReview("approve"));
document.getElementById("batchRejectReviewsBtn").addEventListener("click", () => batchReview("reject"));
document.getElementById("reviewPrevPageBtn").addEventListener("click", () => {
  if (currentPage <= 1) return;
  currentPage -= 1;
  loadAdminReviews().catch((error) => setMsg(error.message));
});
document.getElementById("reviewNextPageBtn").addEventListener("click", () => {
  if (currentPage >= totalPages) return;
  currentPage += 1;
  loadAdminReviews().catch((error) => setMsg(error.message));
});

loadAdminReviews().catch((error) => setMsg(error.message));
