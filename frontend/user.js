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
let discoverPage = 1;
let discoverTotalPages = 1;
const markerById = new Map();
const HIDE_MARKERS_ZOOM = 14;
const DISCOVER_PAGE_SIZE = 20;
const MAP_FETCH_PAGE_SIZE = 100;

const reviewList = document.getElementById("reviewList");
const reviewMsg = document.getElementById("reviewMsg");
const reviewSummary = document.getElementById("reviewSummary");
const selectedStallTitle = document.getElementById("selectedStallTitle");
const selectedStallDetail = document.getElementById("selectedStallDetail");
const reviewModal = document.getElementById("reviewModal");
const reviewModalTitle = document.getElementById("reviewModalTitle");
const reviewStallIdInput = document.getElementById("reviewStallId");
const discoverPageInfo = document.getElementById("discoverPageInfo");
const notificationDot = document.getElementById("notificationDot");

function businessStatusText(stall) {
  return Number(stall?.is_open) === 1 ? "营业中" : "休息中";
}

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

function primaryImageUrl(imageValue) {
  const urls = parseImageUrls(imageValue);
  return urls.length > 0 ? urls[0] : "";
}

function renderImageGallery(imageValue, cls = "stall-thumb") {
  const urls = parseImageUrls(imageValue);
  if (urls.length === 0) return "";
  return `
    <div class="image-grid">
      ${urls.map((u) => `<img src="${escapeHtml(u)}" alt="摊位图片" class="${cls}" />`).join("")}
    </div>
  `;
}

function setNotificationDotVisible(visible) {
  if (!notificationDot) return;
  notificationDot.classList.toggle("hidden", !visible);
}

async function updateNotificationDot() {
  const data = await apiFetch("/api/notifications?unread_only=1&page=1&page_size=1", {}, auth.token);
  const { pagination } = unwrapItems(data);
  setNotificationDotVisible((pagination?.total || 0) > 0);
}

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
    <div><strong>营业状态：</strong>${escapeHtml(businessStatusText(stall))}</div>
    <div><strong>商户：</strong>${escapeHtml(stall.merchant_name || "未知")}</div>
    <div><strong>评分：</strong>${Number(stall.avg_rating || 0).toFixed(1)} (${stall.review_count || 0} 条)</div>
    ${stall.distance_km !== null && stall.distance_km !== undefined ? `<div><strong>距离：</strong>${stall.distance_km} km</div>` : ""}
    <div><strong>简介：</strong>${escapeHtml(stall.description || "暂无")}</div>
    ${renderImageGallery(stall.image_url, "stall-thumb")}
  `;
  highlightSelectedDiscoverItem();
}

function highlightSelectedDiscoverItem() {
  const list = document.getElementById("discoverList");
  if (!list) return;
  list.querySelectorAll(".list-item").forEach((el) => {
    const itemId = Number(el.getAttribute("data-stall-id"));
    el.classList.toggle("active", itemId === Number(selectedStallId));
  });
}

function popupHtml(stall) {
  return `
    <div>
      <strong>${escapeHtml(stall.name)}</strong><br/>
      ${renderImageGallery(stall.image_url, "popup-thumb")}
      类别: ${escapeHtml(stall.category)}<br/>
      评分: ${Number(stall.avg_rating || 0).toFixed(1)} (${stall.review_count || 0} 条)<br/>
      营业状态: ${escapeHtml(businessStatusText(stall))}<br/>
      ${stall.distance_km !== null && stall.distance_km !== undefined ? `距离: ${stall.distance_km} km<br/>` : ""}
      营业时间: ${escapeHtml(stall.open_time)}<br/>
      商户: ${escapeHtml(stall.merchant_name || "未知")}<br/>
      简介: ${escapeHtml(stall.description || "")}
      <div class="panel-actions" style="margin-top:6px;">
        <button type="button" onclick="window.userOpenReview(${stall.id})">我要评价</button>
      </div>
    </div>
  `;
}

function renderDiscoverList(items) {
  const list = document.getElementById("discoverList");
  list.innerHTML = "";
  if (items.length === 0) {
    list.innerHTML = "<li>暂无符合条件的摊位</li>";
    return;
  }

  items.forEach((s) => {
    const li = document.createElement("li");
    li.className = "list-item";
    li.setAttribute("data-stall-id", String(s.id));
    li.innerHTML = `
      <div><strong>#${s.id} ${escapeHtml(s.name)}</strong> (${escapeHtml(s.category)})</div>
      <div>营业状态: ${escapeHtml(businessStatusText(s))}</div>
      <div>评分: ${Number(s.avg_rating || 0).toFixed(1)} (${s.review_count || 0} 条)</div>
      ${s.distance_km !== null && s.distance_km !== undefined ? `<div>距离: ${s.distance_km} km</div>` : ""}
      <div class="hint">${escapeHtml(s.open_time)}</div>
    `;
    li.addEventListener("click", async () => {
      const marker = markerById.get(Number(s.id));
      if (marker) {
        map.setView([s.lat, s.lng], 16);
        marker.openPopup();
      }
      setSelectedStall(s.id);
      await loadReviews(s.id);
    });
    list.appendChild(li);
  });
  highlightSelectedDiscoverItem();
}

function renderCategoryFilter(items) {
  const select = document.getElementById("discoverCategoryFilter");
  const previous = select.value;
  const categories = Array.from(new Set(items.map((x) => x.category))).sort((a, b) => String(a).localeCompare(String(b)));
  select.innerHTML = '<option value="">全部类别</option>';
  categories.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  });
  if (categories.includes(previous)) select.value = previous;
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
        return renderReplyLine(rp, 0) + children.map((c) => renderReplyLine(c, 16)).join("");
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
        reviewMsg.textContent = result.message || "回复已提交";
        await loadReviews();
      } catch (error) {
        reviewMsg.textContent = error.message;
      }
    });
  });
}

function buildDiscoverParams(options = {}) {
  const includePage = options.includePage !== false;
  const page = options.page ?? discoverPage;
  const pageSize = options.pageSize ?? DISCOVER_PAGE_SIZE;
  const params = new URLSearchParams();
  if (includePage) {
    params.set("page", String(page));
    params.set("page_size", String(pageSize));
  }
  const q = document.getElementById("discoverSearchInput").value.trim();
  const category = document.getElementById("discoverCategoryFilter").value;
  const minRating = document.getElementById("discoverMinRatingFilter").value;
  const sort = document.getElementById("discoverSortSelect").value;
  const maxDistance = document.getElementById("discoverDistanceInput").value;

  if (q) params.set("q", q);
  if (category) params.set("category", category);
  if (minRating) params.set("min_rating", minRating);
  if (sort) params.set("sort", sort);
  if (maxDistance) {
    const center = map.getCenter();
    params.set("max_distance_km", maxDistance);
    params.set("center_lat", String(center.lat));
    params.set("center_lng", String(center.lng));
  }
  if (sort === "distance_asc" && !maxDistance) {
    const center = map.getCenter();
    params.set("center_lat", String(center.lat));
    params.set("center_lng", String(center.lng));
  }
  return params;
}

async function fetchAllFilteredStalls() {
  const all = [];
  let page = 1;
  let totalPages = 1;
  const baseParams = buildDiscoverParams({ includePage: false });

  do {
    const params = new URLSearchParams(baseParams.toString());
    params.set("page", String(page));
    params.set("page_size", String(MAP_FETCH_PAGE_SIZE));
    const data = await apiFetch(`/api/stalls?${params.toString()}`);
    const { items, pagination } = unwrapItems(data);
    all.push(...items);
    totalPages = pagination?.total_pages || 1;
    page += 1;
  } while (page <= totalPages);

  return all;
}

async function loadStalls() {
  stalls = await fetchAllFilteredStalls();
  discoverTotalPages = Math.max(1, Math.ceil(stalls.length / DISCOVER_PAGE_SIZE));
  if (discoverPage > discoverTotalPages) discoverPage = discoverTotalPages;
  const start = (discoverPage - 1) * DISCOVER_PAGE_SIZE;
  const pageItems = stalls.slice(start, start + DISCOVER_PAGE_SIZE);
  discoverPageInfo.textContent = `第 ${discoverPage} / ${discoverTotalPages} 页，共 ${stalls.length} 条`;

  markersLayer.clearLayers();
  markerById.clear();
  stalls.forEach((stall) => {
    const marker = L.marker([stall.lat, stall.lng]).bindPopup(popupHtml(stall));
    marker.on("click", async () => {
      setSelectedStall(stall.id);
      await loadReviews(stall.id);
    });
    marker.addTo(markersLayer);
    markerById.set(Number(stall.id), marker);
  });

  renderCategoryFilter(stalls);
  renderDiscoverList(pageItems);
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
  const data = await apiFetch(`/api/reviews?stall_id=${encodeURIComponent(stallId)}&page=1&page_size=100`);
  const { items } = unwrapItems(data);
  renderReviews(items);
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
    await updateNotificationDot();
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

document.getElementById("refreshBtn").addEventListener("click", async () => {
  await loadStalls();
  await loadHeatmap();
  await loadReviews();
  await updateNotificationDot();
  updateMarkerVisibility();
});

document.getElementById("applyDiscoverBtn").addEventListener("click", async () => {
  discoverPage = 1;
  await loadStalls();
  if (stalls.length > 0) {
    await loadReviews(stalls[0].id);
  }
});
document.getElementById("clearDiscoverBtn").addEventListener("click", async () => {
  document.getElementById("discoverSearchInput").value = "";
  document.getElementById("discoverCategoryFilter").value = "";
  document.getElementById("discoverMinRatingFilter").value = "";
  document.getElementById("discoverSortSelect").value = "id_asc";
  document.getElementById("discoverDistanceInput").value = "";
  discoverPage = 1;
  await loadStalls();
});
document.getElementById("discoverPrevPageBtn").addEventListener("click", async () => {
  if (discoverPage <= 1) return;
  discoverPage -= 1;
  await loadStalls();
});
document.getElementById("discoverNextPageBtn").addEventListener("click", async () => {
  if (discoverPage >= discoverTotalPages) return;
  discoverPage += 1;
  await loadStalls();
});

map.on("zoomend", updateMarkerVisibility);

(async function init() {
  await loadStalls();
  await loadHeatmap();
  await updateNotificationDot();
  setInterval(() => {
    updateNotificationDot().catch(() => {});
  }, 30000);
  updateMarkerVisibility();
  if (stalls.length > 0) {
    await loadReviews(stalls[0].id);
  } else {
    selectedStallDetail.textContent = "暂无摊位详情";
    reviewSummary.textContent = "总评分：暂无（0 条评价）";
    reviewList.innerHTML = "<li>暂无摊位数据</li>";
  }
})();
