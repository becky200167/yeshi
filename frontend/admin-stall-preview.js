(function () {
  function parseImageUrls(imageValue) {
    if (typeof parseViewerImageUrls === "function") {
      return parseViewerImageUrls(imageValue);
    }
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
      return renderZoomableImageGallery(imageValue, "stall-thumb", { emptyText: "暂无图片" });
    }
    const urls = parseImageUrls(imageValue);
    if (urls.length === 0) return '<div class="hint">暂无图片</div>';
    return `
      <div class="image-grid">
        ${urls.map((url) => `<img src="${escapeHtml(url)}" alt="摊位图片" class="stall-thumb" />`).join("")}
      </div>
    `;
  }

  function statusLabel(status) {
    return {
      pending: "待审核",
      approved: "已通过",
      rejected: "已驳回",
      offline: "已下架",
      active: "正常",
      frozen: "已冻结",
    }[String(status || "").trim()] || String(status || "未知");
  }

  function statusBadge(status) {
    const finalStatus = String(status || "unknown").trim() || "unknown";
    return `<span class="status-badge status-${escapeHtml(finalStatus)}">${escapeHtml(statusLabel(finalStatus))}</span>`;
  }

  function businessStatusText(stall) {
    return stall?.business_status || (Number(stall?.is_open) === 1 ? "营业中" : "休息中");
  }

  function reviewSummaryText(stall, reviews) {
    const approvedCount = reviews.filter((item) => item.status === "approved").length;
    const pendingCount = reviews.filter((item) => item.status === "pending").length;
    const rejectedCount = reviews.filter((item) => item.status === "rejected").length;
    const displayedCount = Number(stall?.review_count || 0);
    const displayedAvg = Number(stall?.avg_rating || 0).toFixed(1);
    return `展示评分：${displayedAvg} / 5（已通过 ${displayedCount} 条） | 全部评价 ${reviews.length} 条，待审核 ${pendingCount} 条，已驳回 ${rejectedCount} 条，已通过 ${approvedCount} 条`;
  }

  function renderReplyBlocks(replies) {
    const list = Array.isArray(replies) ? replies : [];
    if (list.length === 0) return '<div class="hint">暂无用户回复</div>';

    const replyMap = new Map(list.map((item) => [Number(item.id), item]));
    const childrenMap = new Map();
    list
      .filter((item) => item.parent_reply_id)
      .forEach((item) => {
        const parentId = Number(item.parent_reply_id);
        const bucket = childrenMap.get(parentId) || [];
        bucket.push(item);
        childrenMap.set(parentId, bucket);
      });

    function renderOne(item, indent = 0) {
      const parent = item.parent_reply_id ? replyMap.get(Number(item.parent_reply_id)) : null;
      const replyTo = parent ? ` 回复 ${escapeHtml(parent.user_name)}` : "";
      return `
        <div class="reply-box" style="margin-left:${indent}px">
          <div><strong>${escapeHtml(item.user_name)}</strong>${replyTo} ${statusBadge(item.status || "approved")}</div>
          <div>${escapeHtml(item.content)}</div>
          <div class="hint">${escapeHtml(item.created_at || "")}</div>
        </div>
      `;
    }

    return list
      .filter((item) => !item.parent_reply_id)
      .map((item) => {
        const children = childrenMap.get(Number(item.id)) || [];
        return renderOne(item, 0) + children.map((child) => renderOne(child, 16)).join("");
      })
      .join("");
  }

  function renderReviewItem(review, focusReviewId) {
    const focusClass = Number(review.id) === Number(focusReviewId) ? " admin-review-focus" : "";
    const userActionLabel = review.user_status === "frozen" ? "解冻用户" : "冻结用户";
    return `
      <li class="list-item${focusClass}" data-preview-review-id="${review.id}">
        <div><strong>${escapeHtml(review.user_name)}</strong> ${stars(review.rating)} (${review.rating}) ${statusBadge(review.status)}</div>
        <div>${escapeHtml(review.content || "")}</div>
        <div class="hint">${escapeHtml(review.created_at || "")} | 用户状态：${escapeHtml(statusLabel(review.user_status || "active"))}</div>
        ${review.merchant_reply ? `<div class="reply-box">商户回复：${escapeHtml(review.merchant_reply)}</div>` : ""}
        ${renderReplyBlocks(review.replies)}
        <div class="review-inline-actions">
          <button type="button" class="danger-btn" data-review-delete="${review.id}">删除评论</button>
          ${
            review.user_id
              ? `<button type="button" class="warning-btn" data-review-user-action="${review.id}" data-user-id="${review.user_id}" data-user-next="${review.user_status === "frozen" ? "unfreeze" : "freeze"}">${userActionLabel}</button>`
              : ""
          }
        </div>
      </li>
    `;
  }

  function renderStallDetail(stall) {
    if (!stall) return '<div class="hint">暂无摊位数据</div>';
    return `
      <div><strong>类别：</strong>${escapeHtml(stall.category || "")}</div>
      <div><strong>营业时间：</strong>${escapeHtml(stall.open_time || "")}</div>
      <div><strong>营业状态：</strong>${escapeHtml(businessStatusText(stall))}</div>
      <div><strong>商户：</strong>${escapeHtml(stall.merchant_name || "未知")}</div>
      <div><strong>评分：</strong>${Number(stall.avg_rating || 0).toFixed(1)} (${stall.review_count || 0} 条)</div>
      <div><strong>简介：</strong>${escapeHtml(stall.description || "暂无")}</div>
      ${renderImageGallery(stall.image_url)}
    `;
  }

  window.createAdminStallPreview = function createAdminStallPreview(options = {}) {
    const auth = options.auth || requireRole("admin");
    const onMutated = typeof options.onMutated === "function" ? options.onMutated : async () => {};
    const setPageMessage = typeof options.setPageMessage === "function" ? options.setPageMessage : () => {};

    const modal = document.getElementById("adminStallPreviewModal");
    const closeBtn = document.getElementById("adminPreviewCloseBtn");
    const heading = document.getElementById("adminPreviewHeading");
    const context = document.getElementById("adminPreviewContext");
    const notice = document.getElementById("adminPreviewNotice");
    const actions = document.getElementById("adminPreviewActions");
    const mapRoot = document.getElementById("adminPreviewMap");
    const title = document.getElementById("adminPreviewTitle");
    const detail = document.getElementById("adminPreviewDetail");
    const meta = document.getElementById("adminPreviewMeta");
    const reviewSummary = document.getElementById("adminPreviewReviewSummary");
    const reviewsList = document.getElementById("adminPreviewReviewsList");

    let previewMap = null;
    let previewMarker = null;
    let requestToken = 0;
    let state = {
      source: "",
      submissionId: null,
      stallId: null,
      focusReviewId: null,
      currentStall: null,
      currentReviews: [],
    };

    function openModal() {
      modal.classList.remove("hidden");
      if (previewMap) setTimeout(() => previewMap.invalidateSize(), 0);
    }

    function closeModal() {
      modal.classList.add("hidden");
    }

    function setNotice(text, tone = "") {
      notice.className = tone ? `hint preview-notice preview-notice-${tone}` : "hint preview-notice";
      notice.textContent = text || "";
    }

    function setActions(buttons) {
      actions.innerHTML = "";
      buttons.forEach((item) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = item.label;
        if (item.className) btn.className = item.className;
        if (item.disabled) btn.disabled = true;
        btn.addEventListener("click", item.onClick);
        actions.appendChild(btn);
      });
    }

    function ensureMap() {
      if (previewMap || !mapRoot) return;
      previewMap = L.map(mapRoot).setView([28.21, 113.0], 13);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap",
      }).addTo(previewMap);
    }

    function renderMap(stall) {
      ensureMap();
      if (!previewMap) return;
      const lat = Number(stall?.lat);
      const lng = Number(stall?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      if (previewMarker) previewMap.removeLayer(previewMarker);
      previewMarker = L.marker([lat, lng]).addTo(previewMap);
      previewMarker.bindPopup(escapeHtml(stall.name || "摊位位置")).openPopup();
      previewMap.setView([lat, lng], 16);
      setTimeout(() => previewMap.invalidateSize(), 0);
    }

    function renderCommon(stall, reviews) {
      state.currentStall = stall;
      state.currentReviews = reviews;
      const stallIdText = stall?.id ? `#${stall.id} ` : "";
      title.textContent = `${stallIdText}${stall?.name || "摊位预览"}`;
      detail.innerHTML = renderStallDetail(stall);
      reviewSummary.textContent = reviewSummaryText(stall, reviews);
      reviewsList.innerHTML = reviews.length > 0
        ? reviews.map((item) => renderReviewItem(item, state.focusReviewId)).join("")
        : "<li>暂无评价</li>";
      renderMap(stall);
      bindReviewInlineActions();

      if (state.focusReviewId) {
        const focusEl = reviewsList.querySelector(`[data-preview-review-id="${state.focusReviewId}"]`);
        if (focusEl) setTimeout(() => focusEl.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
      }
    }

    function setLoading(sourceLabel) {
      heading.textContent = "摊位预览";
      context.textContent = sourceLabel;
      title.textContent = "正在加载...";
      detail.innerHTML = '<div class="hint">正在加载摊位详情</div>';
      meta.innerHTML = '<div class="hint">正在整理管理员上下文</div>';
      reviewSummary.textContent = "正在加载评价数据";
      reviewsList.innerHTML = "<li>正在加载...</li>";
      setActions([]);
      setNotice("");
    }

    async function refreshListAndPageMessage(result) {
      if (result?.message) setPageMessage(result.message);
      await onMutated();
    }

    async function freezeOrUnfreezeUser(userId, action) {
      const result = await apiFetch(`/api/admin/users/${userId}/${action}`, { method: "POST" }, auth.token);
      await refreshListAndPageMessage(result);
      await refreshCurrentView();
    }

    async function deleteReview(reviewId) {
      const result = await apiFetch(`/api/admin/reviews/${reviewId}`, { method: "DELETE" }, auth.token);
      if (Number(state.focusReviewId) === Number(reviewId)) {
        state.focusReviewId = null;
      }
      await refreshListAndPageMessage(result);
      await refreshCurrentView();
    }

    async function runSubmissionAction(submissionId, action) {
      const request = { method: "POST" };
      if (action === "reject") {
        const reason = window.prompt("请输入驳回原因：", "信息不完整，请补充后重提");
        if (reason === null) return;
        request.headers = { "Content-Type": "application/json" };
        request.body = JSON.stringify({ reject_reason: reason.trim() });
      }

      const result = await apiFetch(`/api/admin/submissions/${submissionId}/${action}`, request, auth.token);
      await refreshListAndPageMessage(result);
      await openSubmission(submissionId);
    }

    async function runReviewAction(reviewId, action) {
      const endpoint = action === "delete" ? `/api/admin/reviews/${reviewId}` : `/api/admin/reviews/${reviewId}/${action}`;
      const request = { method: action === "delete" ? "DELETE" : "POST" };
      const result = await apiFetch(endpoint, request, auth.token);
      if (action === "delete" && Number(state.focusReviewId) === Number(reviewId)) {
        state.focusReviewId = null;
        setNotice("该评价已删除。", "warn");
      }
      await refreshListAndPageMessage(result);
      await refreshCurrentView();
    }

    async function runStallAction(stallId, action) {
      const endpoint = action === "delete" ? `/api/admin/stalls/${stallId}` : `/api/admin/stalls/${stallId}/${action}`;
      const request = { method: action === "delete" ? "DELETE" : "POST" };
      const result = await apiFetch(endpoint, request, auth.token);
      await refreshListAndPageMessage(result);
      if (action === "delete") {
        closeModal();
        return;
      }
      await openStall(stallId);
    }

    async function refreshCurrentView() {
      if (state.source === "submission" && state.submissionId) {
        await openSubmission(state.submissionId);
        return;
      }
      if (state.source === "review" && state.stallId) {
        await openReview(state.stallId, state.focusReviewId);
        return;
      }
      if (state.source === "stall" && state.stallId) {
        await openStall(state.stallId);
      }
    }

    function bindReviewInlineActions() {
      reviewsList.querySelectorAll("[data-review-delete]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const reviewId = Number(btn.getAttribute("data-review-delete"));
          if (!window.confirm(`确认删除评价 #${reviewId}？`)) return;
          try {
            await deleteReview(reviewId);
          } catch (error) {
            setPageMessage(error.message);
            setNotice(error.message, "error");
          }
        });
      });

      reviewsList.querySelectorAll("[data-review-user-action]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const userId = Number(btn.getAttribute("data-user-id"));
          const action = String(btn.getAttribute("data-user-next") || "freeze");
          try {
            await freezeOrUnfreezeUser(userId, action);
          } catch (error) {
            setPageMessage(error.message);
            setNotice(error.message, "error");
          }
        });
      });
    }

    function bindMerchantActions(stall) {
      meta.querySelectorAll("[data-merchant-user-action]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const userId = Number(btn.getAttribute("data-user-id"));
          const action = String(btn.getAttribute("data-merchant-user-action") || "freeze");
          try {
            await freezeOrUnfreezeUser(userId, action);
          } catch (error) {
            setPageMessage(error.message);
            setNotice(error.message, "error");
          }
        });
      });
    }

    function merchantActionHtml(stall) {
      if (!stall?.merchant_user_id) return "";
      const frozen = stall.merchant_user_status === "frozen";
      return `
        <div class="context-actions">
          <button
            type="button"
            class="${frozen ? "" : "warning-btn"}"
            data-merchant-user-action="${frozen ? "unfreeze" : "freeze"}"
            data-user-id="${stall.merchant_user_id}"
          >
            ${frozen ? "解冻商家" : "冻结商家"}
          </button>
        </div>
      `;
    }

    function renderSubmissionView(data) {
      const submission = data.submission || {};
      const stall = data.preview_stall || null;
      const reviews = Array.isArray(data.preview_reviews) ? data.preview_reviews : [];
      const diffText = Array.isArray(data.diff_fields) && data.diff_fields.length > 0 ? data.diff_fields.join("、") : "无";

      heading.textContent = "摊位提交预览";
      context.innerHTML = `来源：摊位提交 #${submission.id || "-"} ${statusBadge(submission.status)}`;
      meta.innerHTML = `
        <div class="context-card">
          <div><strong>提交人：</strong>${escapeHtml(submission.submitter_name || submission.merchant_name || "")} (${escapeHtml(submission.submitter_role || "merchant")})</div>
          <div><strong>提交类型：</strong>${escapeHtml(submission.action || "create")} | <strong>模式：</strong>${escapeHtml(submission.submission_mode || "full")}</div>
          <div><strong>商户归属：</strong>${escapeHtml(stall?.merchant_name || submission.merchant_name || "未识别")}</div>
          <div><strong>商家账号状态：</strong>${statusBadge(stall?.merchant_user_status || "unknown")}</div>
          <div><strong>目标摊位：</strong>${escapeHtml(submission.target_stall_id || "-")}</div>
          <div><strong>变更字段：</strong>${escapeHtml(diffText)}</div>
          ${submission.change_note ? `<div><strong>勘误说明：</strong>${escapeHtml(submission.change_note)}</div>` : ""}
          ${submission.reject_reason ? `<div><strong>驳回原因：</strong>${escapeHtml(submission.reject_reason)}</div>` : ""}
          <div><strong>提交时间：</strong>${escapeHtml(submission.created_at || "")}</div>
          ${data.source_stall ? `<div><strong>当前摊位状态：</strong>${statusBadge(data.source_stall.status)}</div>` : ""}
          ${merchantActionHtml(stall)}
        </div>
      `;
      renderCommon(stall, reviews);
      bindMerchantActions(stall);
      setNotice(data.preview_notice || "");
      setActions(
        submission.status === "pending"
          ? [
              {
                label: "通过",
                disabled: data.can_approve === false,
                onClick: async () => {
                  try {
                    await runSubmissionAction(submission.id, "approve");
                  } catch (error) {
                    setPageMessage(error.message);
                    setNotice(error.message, "error");
                  }
                },
              },
              {
                label: "驳回",
                className: "danger-btn",
                onClick: async () => {
                  try {
                    await runSubmissionAction(submission.id, "reject");
                  } catch (error) {
                    setPageMessage(error.message);
                    setNotice(error.message, "error");
                  }
                },
              },
            ]
          : []
      );
    }

    function renderReviewView(stall, reviews) {
      const focusReview = reviews.find((item) => Number(item.id) === Number(state.focusReviewId)) || null;
      heading.textContent = "评价审核预览";
      context.innerHTML = `来源：评价审核 ${focusReview ? `#${focusReview.id}` : ""}`;
      meta.innerHTML = focusReview
        ? `
            <div class="context-card">
              <div><strong>当前评价：</strong>#${focusReview.id} ${statusBadge(focusReview.status)}</div>
              <div><strong>用户：</strong>${escapeHtml(focusReview.user_name)}</div>
              <div><strong>用户状态：</strong>${statusBadge(focusReview.user_status || "active")}</div>
              <div><strong>评分：</strong>${stars(focusReview.rating)} (${focusReview.rating})</div>
              <div><strong>内容：</strong>${escapeHtml(focusReview.content || "")}</div>
              <div><strong>商家账号状态：</strong>${statusBadge(stall.merchant_user_status || "unknown")}</div>
              ${merchantActionHtml(stall)}
            </div>
          `
        : `
            <div class="context-card">
              <div><strong>当前摊位：</strong>#${stall.id} ${escapeHtml(stall.name || "")}</div>
              <div><strong>商户：</strong>${escapeHtml(stall.merchant_name || "")}</div>
              <div><strong>商家账号状态：</strong>${statusBadge(stall.merchant_user_status || "unknown")}</div>
              <div><strong>状态：</strong>${statusBadge(stall.status)}</div>
              ${merchantActionHtml(stall)}
            </div>
          `;
      renderCommon(stall, reviews);
      bindMerchantActions(stall);
      setActions(
        focusReview
          ? [
              {
                label: "通过",
                onClick: async () => {
                  try {
                    await runReviewAction(focusReview.id, "approve");
                  } catch (error) {
                    setPageMessage(error.message);
                    setNotice(error.message, "error");
                  }
                },
              },
              {
                label: "驳回",
                className: "warning-btn",
                onClick: async () => {
                  try {
                    await runReviewAction(focusReview.id, "reject");
                  } catch (error) {
                    setPageMessage(error.message);
                    setNotice(error.message, "error");
                  }
                },
              },
              {
                label: "删除评论",
                className: "danger-btn",
                onClick: async () => {
                  try {
                    await runReviewAction(focusReview.id, "delete");
                  } catch (error) {
                    setPageMessage(error.message);
                    setNotice(error.message, "error");
                  }
                },
              },
            ]
          : []
      );
    }

    function renderStallView(stall, reviews) {
      heading.textContent = "摊位管理预览";
      context.innerHTML = `来源：摊位管理 #${stall.id} ${statusBadge(stall.status)}`;
      meta.innerHTML = `
        <div class="context-card">
          <div><strong>商户：</strong>${escapeHtml(stall.merchant_name || "")}</div>
          <div><strong>商家账号状态：</strong>${statusBadge(stall.merchant_user_status || "unknown")}</div>
          <div><strong>营业状态：</strong>${escapeHtml(businessStatusText(stall))}</div>
          ${stall.live_updated_at ? `<div><strong>最近更新：</strong>${escapeHtml(stall.live_updated_at)}</div>` : ""}
          ${merchantActionHtml(stall)}
        </div>
      `;
      renderCommon(stall, reviews);
      bindMerchantActions(stall);
      setActions([
        {
          label: "下架",
          disabled: stall.status === "offline",
          onClick: async () => {
            try {
              await runStallAction(stall.id, "offline");
            } catch (error) {
              setPageMessage(error.message);
              setNotice(error.message, "error");
            }
          },
        },
        {
          label: "恢复上架",
          disabled: stall.status === "approved",
          onClick: async () => {
            try {
              await runStallAction(stall.id, "restore");
            } catch (error) {
              setPageMessage(error.message);
              setNotice(error.message, "error");
            }
          },
        },
        {
          label: "删除摊位",
          className: "danger-btn",
          onClick: async () => {
            if (!window.confirm(`确认删除摊位 #${stall.id} ${stall.name}？`)) return;
            try {
              await runStallAction(stall.id, "delete");
            } catch (error) {
              setPageMessage(error.message);
              setNotice(error.message, "error");
            }
          },
        },
      ]);
    }

    async function openSubmission(submissionId) {
      state = {
        source: "submission",
        submissionId: Number(submissionId),
        stallId: null,
        focusReviewId: null,
        currentStall: null,
        currentReviews: [],
      };
      const token = ++requestToken;
      openModal();
      setLoading(`来源：摊位提交 #${submissionId}`);
      try {
        const data = await apiFetch(`/api/admin/submissions/${submissionId}/preview`, {}, auth.token);
        if (token !== requestToken) return;
        state.stallId = data.preview_stall?.id || data.submission?.target_stall_id || null;
        renderSubmissionView(data);
      } catch (error) {
        if (token !== requestToken) return;
        setPageMessage(error.message);
        setNotice(error.message, "error");
      }
    }

    async function openReview(stallId, focusReviewId = null) {
      state = {
        source: "review",
        submissionId: null,
        stallId: Number(stallId),
        focusReviewId: focusReviewId ? Number(focusReviewId) : null,
        currentStall: null,
        currentReviews: [],
      };
      const token = ++requestToken;
      openModal();
      setLoading(`来源：评价审核 ${focusReviewId ? `#${focusReviewId}` : ""}`);
      try {
        const query = state.focusReviewId ? `?include_all=1&focus_review_id=${encodeURIComponent(state.focusReviewId)}` : "?include_all=1";
        const [stall, reviewsData] = await Promise.all([
          apiFetch(`/api/admin/stalls/${stallId}/detail`, {}, auth.token),
          apiFetch(`/api/admin/stalls/${stallId}/reviews${query}`, {}, auth.token),
        ]);
        if (token !== requestToken) return;
        const reviews = Array.isArray(reviewsData.items) ? reviewsData.items : [];
        renderReviewView(stall, reviews);
      } catch (error) {
        if (token !== requestToken) return;
        setPageMessage(error.message);
        setNotice(error.message, "error");
      }
    }

    async function openStall(stallId) {
      state = {
        source: "stall",
        submissionId: null,
        stallId: Number(stallId),
        focusReviewId: null,
        currentStall: null,
        currentReviews: [],
      };
      const token = ++requestToken;
      openModal();
      setLoading(`来源：摊位管理 #${stallId}`);
      try {
        const [stall, reviewsData] = await Promise.all([
          apiFetch(`/api/admin/stalls/${stallId}/detail`, {}, auth.token),
          apiFetch(`/api/admin/stalls/${stallId}/reviews?include_all=1`, {}, auth.token),
        ]);
        if (token !== requestToken) return;
        const reviews = Array.isArray(reviewsData.items) ? reviewsData.items : [];
        renderStallView(stall, reviews);
      } catch (error) {
        if (token !== requestToken) return;
        setPageMessage(error.message);
        setNotice(error.message, "error");
      }
    }

    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (modal) {
      modal.addEventListener("click", (event) => {
        if (event.target === modal) closeModal();
      });
    }

    return {
      openSubmission,
      openReview,
      openStall,
      close: closeModal,
    };
  };
})();
