const auth = requireRole("admin");
bindLogout();

const adminMsg = document.getElementById("adminMsg");
const batchHint = document.getElementById("reviewBatchHint");
const pageInfo = document.getElementById("reviewPageInfo");
let currentPage = 1;
let totalPages = 1;
const selectedIds = new Set();

const preview = createAdminStallPreview({
  auth,
  setPageMessage: setMsg,
  onMutated: async () => {
    await loadAdminReviews();
  },
});

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

  items.forEach((review) => {
    const li = document.createElement("li");
    li.className = "list-item";
    li.innerHTML = `
      <label><input type="checkbox" data-review-id="${review.id}" ${review.status === "pending" ? "" : "disabled"} /> 选择</label>
      <div>
        <button type="button" class="inline-link-btn" data-preview-review="${review.id}" data-preview-stall="${review.stall_id}">
          ${escapeHtml(review.stall_name)}
        </button>
        | ${escapeHtml(review.user_name)} | ${stars(review.rating)} (${review.rating})
      </div>
      <div>${escapeHtml(review.content)}</div>
      <div class="hint">状态: ${escapeHtml(review.status)} | 商户: ${escapeHtml(review.merchant_name || "")}</div>
      ${review.merchant_reply ? `<div class="reply-box">商户回复：${escapeHtml(review.merchant_reply)}</div>` : ""}
    `;

    li.querySelector(`[data-preview-review="${review.id}"]`)?.addEventListener("click", () => {
      preview.openReview(review.stall_id, review.id).catch((error) => setMsg(error.message));
    });

    li.querySelector(`input[data-review-id="${review.id}"]`)?.addEventListener("change", (event) => {
      if (event.target.checked) selectedIds.add(review.id);
      else selectedIds.delete(review.id);
      updateBatchHint();
    });

    const actionBox = document.createElement("div");
    actionBox.className = "panel-actions";

    const previewBtn = document.createElement("button");
    previewBtn.type = "button";
    previewBtn.textContent = "查看摊位";
    previewBtn.addEventListener("click", () => {
      preview.openReview(review.stall_id, review.id).catch((error) => setMsg(error.message));
    });

    const approveBtn = document.createElement("button");
    approveBtn.type = "button";
    approveBtn.textContent = "通过";
    approveBtn.addEventListener("click", async () => {
      try {
        const result = await apiFetch(`/api/admin/reviews/${review.id}/approve`, { method: "POST" }, auth.token);
        setMsg(result.message);
        await loadAdminReviews();
      } catch (error) {
        setMsg(error.message);
      }
    });

    const rejectBtn = document.createElement("button");
    rejectBtn.type = "button";
    rejectBtn.textContent = "驳回";
    rejectBtn.className = "warning-btn";
    rejectBtn.addEventListener("click", async () => {
      try {
        const result = await apiFetch(`/api/admin/reviews/${review.id}/reject`, { method: "POST" }, auth.token);
        setMsg(result.message);
        await loadAdminReviews();
      } catch (error) {
        setMsg(error.message);
      }
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "删除";
    delBtn.className = "danger-btn";
    delBtn.addEventListener("click", async () => {
      try {
        const result = await apiFetch(`/api/admin/reviews/${review.id}`, { method: "DELETE" }, auth.token);
        setMsg(result.message);
        await loadAdminReviews();
      } catch (error) {
        setMsg(error.message);
      }
    });

    actionBox.appendChild(previewBtn);
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
document.getElementById("batchApproveReviewsBtn").addEventListener("click", () => {
  batchReview("approve").catch((error) => setMsg(error.message));
});
document.getElementById("batchRejectReviewsBtn").addEventListener("click", () => {
  batchReview("reject").catch((error) => setMsg(error.message));
});
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
