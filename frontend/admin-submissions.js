const auth = requireRole("admin");
bindLogout();

const adminMsg = document.getElementById("adminMsg");
const batchHint = document.getElementById("submissionBatchHint");
const pageInfo = document.getElementById("submissionPageInfo");
let currentPage = 1;
let totalPages = 1;
const selectedIds = new Set();

function parseImageUrls(imageValue) {
  if (!imageValue) return [];
  if (Array.isArray(imageValue)) return imageValue.filter(Boolean).map((x) => String(x));
  const raw = String(imageValue).trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map((x) => String(x));
    } catch {
      // fallback to single URL
    }
  }
  return [raw];
}

function renderImageGallery(imageValue) {
  const urls = parseImageUrls(imageValue);
  if (urls.length === 0) return "";
  return `
    <div class="image-grid">
      ${urls.map((u) => `<img src="${escapeHtml(u)}" alt="摊位图片" class="stall-thumb" />`).join("")}
    </div>
  `;
}

function setMsg(text) {
  adminMsg.textContent = text;
}

function updateBatchHint() {
  batchHint.textContent = selectedIds.size > 0 ? `已选择 ${selectedIds.size} 条` : "未选择记录";
}

async function loadPendingSubmissions() {
  const list = document.getElementById("pendingList");
  list.innerHTML = "";
  selectedIds.clear();
  updateBatchHint();
  const status = document.getElementById("submissionStatusFilter").value;
  const q = document.getElementById("submissionSearchInput").value.trim();
  const params = new URLSearchParams({ page: String(currentPage), page_size: "10" });
  if (status) params.set("status", status);
  if (q) params.set("q", q);

  const data = await apiFetch(`/api/admin/submissions?${params.toString()}`, {}, auth.token);
  const { items, pagination } = unwrapItems(data);
  totalPages = pagination?.total_pages || 1;
  pageInfo.textContent = `第 ${pagination?.page || 1} / ${totalPages} 页，共 ${pagination?.total || items.length} 条`;

  if (items.length === 0) {
    list.innerHTML = "<li>暂无提交记录</li>";
    return;
  }

  items.forEach((s) => {
    const li = document.createElement("li");
    li.className = "list-item";
    li.innerHTML = `
      <label><input type="checkbox" data-submission-id="${s.id}" ${s.status === "pending" ? "" : "disabled"} /> 选择</label>
      <div><strong>#${s.id} ${escapeHtml(s.name)}</strong> (${escapeHtml(s.action)})</div>
      <div>商户: ${escapeHtml(s.merchant_name)} | 类别: ${escapeHtml(s.category)} | 营业时间: ${escapeHtml(s.open_time || "")}</div>
      <div>位置: ${s.lat}, ${s.lng} | 热度: ${s.heat ?? "-"}</div>
      ${s.action === "update" ? `<div class="hint">目标摊位ID: ${s.target_stall_id || "-"}</div>` : ""}
      <div class="hint">简介: ${escapeHtml(s.description || "暂无")}</div>
      ${renderImageGallery(s.image_url)}
      <div class="hint">状态: ${escapeHtml(s.status)} | 提交时间: ${escapeHtml(s.created_at || "")}</div>
      ${s.reviewed_at ? `<div class="hint">审核时间: ${escapeHtml(s.reviewed_at)}</div>` : ""}
      ${s.reject_reason ? `<div class="hint">驳回原因: ${escapeHtml(s.reject_reason)}</div>` : ""}
    `;

    li.querySelector(`input[data-submission-id="${s.id}"]`)?.addEventListener("change", (e) => {
      if (e.target.checked) selectedIds.add(s.id);
      else selectedIds.delete(s.id);
      updateBatchHint();
    });

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

async function batchReview(action) {
  if (selectedIds.size === 0) {
    setMsg("请先选择待审核记录");
    return;
  }
  let rejectReason = "";
  if (action === "reject") {
    const reason = window.prompt("请输入批量驳回原因：", "信息不完整，请补充后重提");
    if (reason === null) return;
    rejectReason = reason.trim();
    if (!rejectReason) {
      setMsg("驳回原因不能为空");
      return;
    }
  }
  try {
    const result = await apiFetch(
      "/api/admin/submissions/batch-review",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: Array.from(selectedIds),
          action,
          reject_reason: rejectReason,
        }),
      },
      auth.token,
    );
    setMsg(result.message);
    await loadPendingSubmissions();
  } catch (error) {
    setMsg(error.message);
  }
}

document.getElementById("loadPendingBtn").addEventListener("click", () => {
  currentPage = 1;
  loadPendingSubmissions().catch((error) => setMsg(error.message));
});
document.getElementById("submissionStatusFilter").addEventListener("change", () => {
  currentPage = 1;
  loadPendingSubmissions().catch((error) => setMsg(error.message));
});
document.getElementById("submissionSearchBtn").addEventListener("click", () => {
  currentPage = 1;
  loadPendingSubmissions().catch((error) => setMsg(error.message));
});
document.getElementById("batchApproveBtn").addEventListener("click", () => batchReview("approve"));
document.getElementById("batchRejectBtn").addEventListener("click", () => batchReview("reject"));
document.getElementById("submissionPrevPageBtn").addEventListener("click", () => {
  if (currentPage <= 1) return;
  currentPage -= 1;
  loadPendingSubmissions().catch((error) => setMsg(error.message));
});
document.getElementById("submissionNextPageBtn").addEventListener("click", () => {
  if (currentPage >= totalPages) return;
  currentPage += 1;
  loadPendingSubmissions().catch((error) => setMsg(error.message));
});

loadPendingSubmissions().catch((error) => setMsg(error.message));
