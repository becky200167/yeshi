const auth = requireRole("user");
bindLogout();

const map = L.map("map").setView([28.21, 113.0], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap",
}).addTo(map);

const markersLayer = L.layerGroup().addTo(map);
let heatLayer = null;
let heatVisible = false;
let stalls = [];
let selectedStallId = null;
const HIDE_MARKERS_ZOOM = 14;

const reviewList = document.getElementById("reviewList");
const reviewMsg = document.getElementById("reviewMsg");
const reviewSummary = document.getElementById("reviewSummary");
const selectedStallTitle = document.getElementById("selectedStallTitle");
const selectedStallDetail = document.getElementById("selectedStallDetail");
const reviewModal = document.getElementById("reviewModal");
const reviewModalTitle = document.getElementById("reviewModalTitle");
const reviewStallIdInput = document.getElementById("reviewStallId");

function getStallById(stallId) {
  return stalls.find((s) => s.id === Number(stallId));
}

function setSelectedStall(stallId) {
  selectedStallId = Number(stallId);
  const stall = getStallById(selectedStallId);
  if (!stall) return;
  selectedStallTitle.textContent = `#${stall.id} ${stall.name} 的评价`;
  selectedStallDetail.innerHTML = `
    <div><strong>类别：</strong>${escapeHtml(stall.category)}</div>
    <div><strong>营业时间：</strong>${escapeHtml(stall.open_time)}</div>
    <div><strong>商户：</strong>${escapeHtml(stall.merchant_name || "未知")}</div>
    <div><strong>简介：</strong>${escapeHtml(stall.description || "暂无")}</div>
    ${stall.image_url ? `<img src="${escapeHtml(stall.image_url)}" alt="摊位图片" class="stall-thumb" />` : ""}
  `;
}

function popupHtml(stall) {
  return `
    <div>
      <strong>${escapeHtml(stall.name)}</strong><br/>
      ${stall.image_url ? `<img src="${escapeHtml(stall.image_url)}" alt="摊位图片" class="popup-thumb" /><br/>` : ""}
      类别: ${escapeHtml(stall.category)}<br/>
      营业时间: ${escapeHtml(stall.open_time)}<br/>
      商户: ${escapeHtml(stall.merchant_name || "未知")}<br/>
      简介: ${escapeHtml(stall.description || "")}
      <div class="panel-actions" style="margin-top:6px;">
        <button type="button" onclick="window.userOpenReview(${stall.id})">我要评价</button>
      </div>
    </div>
  `;
}

function renderReviews(items) {
  reviewList.innerHTML = "";
  if (items.length > 0) {
    const avg = items.reduce((sum, r) => sum + Number(r.rating || 0), 0) / items.length;
    reviewSummary.textContent = `总评分：${avg.toFixed(1)} / 5（${items.length} 条评价）`;
  } else {
    reviewSummary.textContent = "总评分：暂无（0 条评价）";
  }

  if (items.length === 0) {
    reviewList.innerHTML = "<li>暂无评价</li>";
    return;
  }

  items.forEach((r) => {
    const li = document.createElement("li");
    li.className = "list-item";
    const replies = Array.isArray(r.replies) ? r.replies : [];
    const replyMap = new Map(replies.map((x) => [Number(x.id), x]));
    const topReplies = replies.filter((x) => !x.parent_reply_id);
    const childrenMap = new Map();
    replies
      .filter((x) => x.parent_reply_id)
      .forEach((x) => {
        const pid = Number(x.parent_reply_id);
        const arr = childrenMap.get(pid) || [];
        arr.push(x);
        childrenMap.set(pid, arr);
      });

    const renderReplyLine = (rp, indent = 0) => {
      const parent = rp.parent_reply_id ? replyMap.get(Number(rp.parent_reply_id)) : null;
      const toText = parent ? ` 回复 ${escapeHtml(parent.user_name)}` : "";
      return `
        <div class="reply-box" style="margin-left:${indent}px">
          <div><strong>${escapeHtml(rp.user_name)}</strong>${toText}</div>
          <div>${escapeHtml(rp.content)}</div>
          <div class="hint">${escapeHtml(rp.created_at || "")}</div>
          <button type="button" data-reply-review="${r.id}" data-parent-reply="${rp.id}">回复Ta</button>
        </div>
      `;
    };

    const renderedReplies = topReplies
      .map((rp) => {
        const children = childrenMap.get(Number(rp.id)) || [];
        return (
          renderReplyLine(rp, 0) +
          children.map((c) => renderReplyLine(c, 16)).join("")
        );
      })
      .join("");

    li.innerHTML = `
      <div><strong>${escapeHtml(r.user_name)}</strong> ${stars(r.rating)} (${r.rating})</div>
      <div>${escapeHtml(r.content)}</div>
      <div class="hint">${escapeHtml(r.created_at || "")}</div>
      ${r.merchant_reply ? `<div class="reply-box">商户回复：${escapeHtml(r.merchant_reply)}</div>` : ""}
      <div class="panel-actions">
        <button type="button" data-reply-review="${r.id}" data-parent-reply="">回复评论</button>
      </div>
      ${renderedReplies || '<div class="hint">暂无用户回复</div>'}
    `;
    reviewList.appendChild(li);
  });

  reviewList.querySelectorAll("button[data-reply-review]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const reviewId = Number(btn.getAttribute("data-reply-review"));
      const parentReplyRaw = btn.getAttribute("data-parent-reply");
      const parentReplyId = parentReplyRaw ? Number(parentReplyRaw) : null;
      const placeholder = parentReplyId ? "回复这条评论..." : "回复主评论...";
      const content = window.prompt("请输入回复内容：", "");
      if (content === null) return;
      const trimmed = content.trim();
      if (!trimmed) {
        reviewMsg.textContent = "回复内容不能为空";
        return;
      }
      try {
        const result = await apiFetch(
          `/api/reviews/${reviewId}/replies`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              content: trimmed,
              parent_reply_id: parentReplyId,
            }),
          },
          auth.token,
        );
        reviewMsg.textContent = result.message || placeholder;
        await loadReviews();
      } catch (error) {
        reviewMsg.textContent = error.message;
      }
    });
  });
}

async function loadStalls() {
  stalls = await apiFetch("/api/stalls");
  markersLayer.clearLayers();

  stalls.forEach((stall) => {
    const marker = L.marker([stall.lat, stall.lng]).bindPopup(popupHtml(stall));
    marker.on("click", async () => {
      setSelectedStall(stall.id);
      await loadReviews(stall.id);
    });
    marker.addTo(markersLayer);
  });
}

async function loadHeatmap() {
  const points = await apiFetch("/api/heatmap?mode=density");
  const latlngs = points.map((p) => [p.lat, p.lng, p.weight]);

  if (heatLayer) map.removeLayer(heatLayer);
  heatLayer = L.heatLayer(latlngs, {
    radius: 22,
    blur: 16,
    maxZoom: 18,
    max: 6.0,
    minOpacity: 0.35,
    gradient: {
      0.12: "#1d4ed8",
      0.3: "#06b6d4",
      0.5: "#22c55e",
      0.7: "#facc15",
      0.88: "#f97316",
      1.0: "#dc2626",
    },
  });
  if (heatVisible) heatLayer.addTo(map);
}

function updateMarkerVisibility() {
  const hideMarkers = heatVisible && map.getZoom() < HIDE_MARKERS_ZOOM;
  if (hideMarkers && map.hasLayer(markersLayer)) {
    map.removeLayer(markersLayer);
  }
  if (!hideMarkers && !map.hasLayer(markersLayer)) {
    markersLayer.addTo(map);
  }
}

async function loadReviews(stallId = selectedStallId) {
  if (!stallId) {
    reviewList.innerHTML = "<li>请先点击一个摊位</li>";
    reviewSummary.textContent = "总评分：暂无（0 条评价）";
    return;
  }
  setSelectedStall(stallId);
  const rows = await apiFetch(`/api/reviews?stall_id=${encodeURIComponent(stallId)}`);
  renderReviews(rows);
}

function openReviewModal(stallId) {
  setSelectedStall(stallId);
  const stall = getStallById(stallId);
  if (!stall) return;
  reviewModalTitle.textContent = `为 #${stall.id} ${stall.name} 提交评价`;
  reviewStallIdInput.value = String(stall.id);
  reviewModal.classList.remove("hidden");
}

function closeReviewModal() {
  reviewModal.classList.add("hidden");
}

window.userViewReviews = async function userViewReviews(stallId) {
  await loadReviews(stallId);
};

window.userOpenReview = function userOpenReview(stallId) {
  openReviewModal(stallId);
};

document.getElementById("reviewForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const stallId = Number(form.get("stall_id"));

  try {
    const result = await apiFetch(
      "/api/reviews",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stall_id: stallId,
          rating: Number(form.get("rating")),
          content: String(form.get("content") || "").trim(),
        }),
      },
      auth.token,
    );
    reviewMsg.textContent = result.message;
    e.target.reset();
    closeReviewModal();
    await loadReviews(stallId);
  } catch (error) {
    reviewMsg.textContent = error.message;
  }
});

document.getElementById("closeReviewModalBtn").addEventListener("click", closeReviewModal);
reviewModal.addEventListener("click", (e) => {
  if (e.target === reviewModal) closeReviewModal();
});

document.getElementById("loadReviewsBtn").addEventListener("click", async () => {
  await loadReviews();
});

document.getElementById("toggleHeatBtn").addEventListener("click", () => {
  heatVisible = !heatVisible;
  if (!heatLayer) return;
  if (heatVisible) heatLayer.addTo(map);
  else map.removeLayer(heatLayer);
  updateMarkerVisibility();
});

map.on("zoomend", updateMarkerVisibility);

document.getElementById("refreshBtn").addEventListener("click", async () => {
  await loadStalls();
  await loadHeatmap();
  await loadReviews();
  updateMarkerVisibility();
});

(async function init() {
  await loadStalls();
  await loadHeatmap();
  updateMarkerVisibility();
  if (stalls.length > 0) {
    await loadReviews(stalls[0].id);
  } else {
    selectedStallDetail.textContent = "暂无摊位详情";
    reviewSummary.textContent = "总评分：暂无（0 条评价）";
    reviewList.innerHTML = "<li>暂无摊位数据</li>";
  }
})();
