const auth = requireRole("admin");
bindLogout();

const adminMsg = document.getElementById("adminMsg");
const batchHint = document.getElementById("submissionBatchHint");
const pageInfo = document.getElementById("submissionPageInfo");
let currentPage = 1;
let totalPages = 1;
const selectedIds = new Set();

const preview = createAdminStallPreview({
  auth,
  setPageMessage: setMsg,
  onMutated: async () => {
    await loadPendingSubmissions();
  },
});

function parseImageUrls(imageValue) {
  if (!imageValue) return [];
  if (Array.isArray(imageValue)) return imageValue.filter(Boolean).map((item) => String(item));
  const raw = String(imageValue).trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map((item) => String(item));
    } catch {
      // fallback to single url
    }
  }
  return [raw];
}

function renderImageGallery(imageValue) {
  if (typeof renderZoomableImageGallery === "function") {
    return renderZoomableImageGallery(imageValue, "stall-thumb", { emptyText: "" });
  }
  const urls = parseImageUrls(imageValue);
  if (urls.length === 0) return "";
  return `
    <div class="image-grid">
      ${urls.map((url) => `<img src="${escapeHtml(url)}" alt="摊位图片" class="stall-thumb" />`).join("")}
    </div>
  `;
}

function parseChangePayload(raw) {
  if (!raw) return null;
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  const text = String(raw).trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // ignore parse errors
  }
  return null;
}

function renderChangePayload(raw) {
  const obj = parseChangePayload(raw);
  if (!obj) return "";
  const keys = Object.keys(obj);
  if (keys.length === 0) return "";
  const text = keys
    .map((key) => `${key}: ${typeof obj[key] === "string" ? obj[key] : JSON.stringify(obj[key])}`)
    .join(" | ");
  return `<div class="hint">变更字段: ${escapeHtml(text)}</div>`;
}

function setMsg(text) {
  adminMsg.textContent = text;
}

function updateBatchHint() {
  batchHint.textContent = selectedIds.size > 0 ? `已选择 ${selectedIds.size} 条` : "未选择记录";
}

async function reviewSubmission(submissionId, action) {
  const request = { method: "POST" };
  if (action === "reject") {
    const reason = window.prompt("请输入驳回原因：", "信息不完整，请补充后重提");
    if (reason === null) return;
    request.headers = { "Content-Type": "application/json" };
    request.body = JSON.stringify({ reject_reason: reason.trim() });
  }

  const result = await apiFetch(`/api/admin/submissions/${submissionId}/${action}`, request, auth.token);
  setMsg(result.message);
  await loadPendingSubmissions();
}

async function loadPendingSubmissions() {
  const list = document.getElementById("pendingList");
  list.innerHTML = "";
  selectedIds.clear();
  updateBatchHint();

  const status = document.getElementById("submissionStatusFilter").value;
  const submitterRole = document.getElementById("submissionRoleFilter").value;
  const submissionMode = document.getElementById("submissionModeFilter").value;
  const q = document.getElementById("submissionSearchInput").value.trim();
  const params = new URLSearchParams({ page: String(currentPage), page_size: "10" });
  if (status) params.set("status", status);
  if (submitterRole) params.set("submitter_role", submitterRole);
  if (submissionMode) params.set("submission_mode", submissionMode);
  if (q) params.set("q", q);

  const data = await apiFetch(`/api/admin/submissions?${params.toString()}`, {}, auth.token);
  const { items, pagination } = unwrapItems(data);
  totalPages = pagination?.total_pages || 1;
  pageInfo.textContent = `第 ${pagination?.page || 1} / ${totalPages} 页，共 ${pagination?.total || items.length} 条`;

  if (items.length === 0) {
    list.innerHTML = "<li>暂无提交记录</li>";
    return;
  }

  items.forEach((submission) => {
    const li = document.createElement("li");
    li.className = "list-item";
    li.innerHTML = `
      <label><input type="checkbox" data-submission-id="${submission.id}" ${submission.status === "pending" ? "" : "disabled"} /> 选择</label>
      <div>
        <button type="button" class="inline-link-btn" data-preview-submission="${submission.id}">#${submission.id} ${escapeHtml(submission.name)}</button>
        (${escapeHtml(submission.action)})
      </div>
      <div>提交人: ${escapeHtml(submission.submitter_name || submission.merchant_name)} (${escapeHtml(submission.submitter_role || "merchant")}) | 商户归属: ${escapeHtml(submission.merchant_name || "")}</div>
      <div>类别: ${escapeHtml(submission.category)} | 营业时间: ${escapeHtml(submission.open_time || "")} | 模式: ${escapeHtml(submission.submission_mode || "full")}</div>
      <div>位置: ${submission.lat}, ${submission.lng} | 热度: ${submission.heat ?? "-"}</div>
      ${submission.action === "update" ? `<div class="hint">目标摊位ID: ${submission.target_stall_id || "-"}</div>` : ""}
      ${submission.change_note ? `<div class="hint">勘误说明: ${escapeHtml(submission.change_note)}</div>` : ""}
      ${renderChangePayload(submission.change_payload)}
      <div class="hint">简介: ${escapeHtml(submission.description || "暂无")}</div>
      ${renderImageGallery(submission.image_url)}
      <div class="hint">状态: ${escapeHtml(submission.status)} | 提交时间: ${escapeHtml(submission.created_at || "")}</div>
      ${submission.reviewed_at ? `<div class="hint">审核时间: ${escapeHtml(submission.reviewed_at)}</div>` : ""}
      ${submission.reject_reason ? `<div class="hint">驳回原因: ${escapeHtml(submission.reject_reason)}</div>` : ""}
    `;

    li.querySelector(`[data-preview-submission="${submission.id}"]`)?.addEventListener("click", () => {
      preview.openSubmission(submission.id).catch((error) => setMsg(error.message));
    });

    li.querySelector(`input[data-submission-id="${submission.id}"]`)?.addEventListener("change", (event) => {
      if (event.target.checked) selectedIds.add(submission.id);
      else selectedIds.delete(submission.id);
      updateBatchHint();
    });

    const actionBox = document.createElement("div");
    actionBox.className = "panel-actions";

    const previewBtn = document.createElement("button");
    previewBtn.type = "button";
    previewBtn.textContent = "查看预览";
    previewBtn.addEventListener("click", () => {
      preview.openSubmission(submission.id).catch((error) => setMsg(error.message));
    });
    actionBox.appendChild(previewBtn);

    if (submission.status === "pending") {
      const approveBtn = document.createElement("button");
      approveBtn.type = "button";
      approveBtn.textContent = "通过";
      approveBtn.addEventListener("click", async () => {
        try {
          await reviewSubmission(submission.id, "approve");
        } catch (error) {
          setMsg(error.message);
        }
      });

      const rejectBtn = document.createElement("button");
      rejectBtn.type = "button";
      rejectBtn.textContent = "驳回";
      rejectBtn.className = "danger-btn";
      rejectBtn.addEventListener("click", async () => {
        try {
          await reviewSubmission(submission.id, "reject");
        } catch (error) {
          setMsg(error.message);
        }
      });

      actionBox.appendChild(approveBtn);
      actionBox.appendChild(rejectBtn);
    }

    li.appendChild(actionBox);
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
}

document.getElementById("loadPendingBtn").addEventListener("click", () => {
  currentPage = 1;
  loadPendingSubmissions().catch((error) => setMsg(error.message));
});
document.getElementById("submissionStatusFilter").addEventListener("change", () => {
  currentPage = 1;
  loadPendingSubmissions().catch((error) => setMsg(error.message));
});
document.getElementById("submissionRoleFilter").addEventListener("change", () => {
  currentPage = 1;
  loadPendingSubmissions().catch((error) => setMsg(error.message));
});
document.getElementById("submissionModeFilter").addEventListener("change", () => {
  currentPage = 1;
  loadPendingSubmissions().catch((error) => setMsg(error.message));
});
document.getElementById("submissionSearchBtn").addEventListener("click", () => {
  currentPage = 1;
  loadPendingSubmissions().catch((error) => setMsg(error.message));
});
document.getElementById("batchApproveBtn").addEventListener("click", () => {
  batchReview("approve").catch((error) => setMsg(error.message));
});
document.getElementById("batchRejectBtn").addEventListener("click", () => {
  batchReview("reject").catch((error) => setMsg(error.message));
});
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
