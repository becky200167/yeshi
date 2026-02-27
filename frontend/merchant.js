const auth = requireRole("merchant");
bindLogout();

const map = L.map("merchantMap").setView([28.21, 113.0], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap",
}).addTo(map);

const allLayer = L.layerGroup().addTo(map);
const ownLayer = L.layerGroup().addTo(map);
let heatLayer = null;
let heatVisible = false;
let pickMarker = null;
let myStalls = [];
const HIDE_MARKERS_ZOOM = 14;

const modeSelect = document.getElementById("modeSelect");
const targetWrap = document.getElementById("targetWrap");
const targetStallSelect = document.getElementById("targetStallSelect");
const reviewStallFilter = document.getElementById("reviewStallFilter");
const merchantMsg = document.getElementById("merchantMsg");

function setPickedPoint(lat, lng) {
  document.getElementById("latInput").value = Number(lat).toFixed(6);
  document.getElementById("lngInput").value = Number(lng).toFixed(6);
  if (pickMarker) map.removeLayer(pickMarker);
  pickMarker = L.marker([lat, lng]).addTo(map).bindPopup("当前选点").openPopup();
}

function toggleModeUI() {
  const isUpdate = modeSelect.value === "update";
  targetWrap.classList.toggle("hidden", !isUpdate);
}

function fillStallSelect(stalls) {
  targetStallSelect.innerHTML = "";
  stalls.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = String(s.id);
    opt.textContent = `#${s.id} ${s.name}`;
    targetStallSelect.appendChild(opt);
  });
}

function fillReviewFilter(stalls) {
  reviewStallFilter.innerHTML = '<option value="">全部摊位</option>';
  stalls.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = String(s.id);
    opt.textContent = `#${s.id} ${s.name}`;
    reviewStallFilter.appendChild(opt);
  });
}

function startEditStall(stallId) {
  const stall = myStalls.find((s) => s.id === Number(stallId));
  if (!stall) return;

  modeSelect.value = "update";
  toggleModeUI();
  targetStallSelect.value = String(stall.id);

  const form = document.getElementById("merchantForm");
  form.elements.name.value = stall.name || "";
  form.elements.category.value = stall.category || "";
  form.elements.open_time.value = stall.open_time || "";
  form.elements.image_url.value = stall.image_url || "";
  form.elements.description.value = stall.description || "";
  document.getElementById("lngInput").value = Number(stall.lng).toFixed(6);
  document.getElementById("latInput").value = Number(stall.lat).toFixed(6);

  setPickedPoint(stall.lat, stall.lng);
  map.setView([stall.lat, stall.lng], 16);
  merchantMsg.textContent = `已载入 #${stall.id}，可修改后提交审核`;
}

function renderMyStalls(stalls) {
  const list = document.getElementById("myStallsList");
  list.innerHTML = "";
  if (stalls.length === 0) {
    list.innerHTML = "<li>暂无已审核摊位</li>";
    return;
  }

  stalls.forEach((s) => {
    const li = document.createElement("li");
    li.className = "list-item";
    li.innerHTML = `
      <div><strong>#${s.id} ${escapeHtml(s.name)}</strong> (${escapeHtml(s.category)})</div>
      <div>${escapeHtml(s.open_time)}</div>
      ${s.image_url ? `<img src="${escapeHtml(s.image_url)}" alt="摊位图片" class="stall-thumb" />` : ""}
    `;
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "编辑该摊位";
    editBtn.addEventListener("click", () => startEditStall(s.id));
    li.appendChild(editBtn);
    list.appendChild(li);
  });
}

function renderSubmissions(rows) {
  const list = document.getElementById("mySubmissionsList");
  list.innerHTML = "";
  if (rows.length === 0) {
    list.innerHTML = "<li>暂无提交记录</li>";
    return;
  }

  rows.forEach((s) => {
    const li = document.createElement("li");
    li.className = "list-item";
    li.innerHTML = `
      <div><strong>#${s.id}</strong> ${escapeHtml(s.name)} (${escapeHtml(s.action)})</div>
      <div>状态: ${escapeHtml(s.status)}</div>
      ${s.reject_reason ? `<div class="hint">驳回原因: ${escapeHtml(s.reject_reason)}</div>` : ""}
    `;
    list.appendChild(li);
  });
}

function renderMerchantReviews(rows) {
  const list = document.getElementById("merchantReviewsList");
  list.innerHTML = "";
  if (rows.length === 0) {
    list.innerHTML = "<li>暂无评价</li>";
    return;
  }

  rows.forEach((r) => {
    const li = document.createElement("li");
    li.className = "list-item";
    li.innerHTML = `
      <div><strong>${escapeHtml(r.stall_name)}</strong> | ${escapeHtml(r.user_name)} | ${stars(r.rating)} (${r.rating})</div>
      <div>${escapeHtml(r.content)}</div>
      <div class="hint">状态: ${escapeHtml(r.status)}</div>
      ${r.merchant_reply ? `<div class="reply-box">已回复：${escapeHtml(r.merchant_reply)}</div>` : ""}
      <div class="inline-form">
        <input type="text" id="replyInput_${r.id}" placeholder="输入回复" />
        <button type="button" data-review-id="${r.id}">保存回复</button>
      </div>
    `;
    list.appendChild(li);
  });

  list.querySelectorAll("button[data-review-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const reviewId = Number(btn.getAttribute("data-review-id"));
      const input = document.getElementById(`replyInput_${reviewId}`);
      const reply = input.value.trim();
      if (!reply) {
        merchantMsg.textContent = "回复内容不能为空";
        return;
      }
      try {
        const result = await apiFetch(
          `/api/merchant/reviews/${reviewId}/reply`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reply }),
          },
          auth.token,
        );
        merchantMsg.textContent = result.message;
        await loadMerchantReviews();
      } catch (error) {
        merchantMsg.textContent = error.message;
      }
    });
  });
}

async function loadMapStalls() {
  const stalls = await apiFetch("/api/stalls");
  allLayer.clearLayers();
  ownLayer.clearLayers();

  stalls.forEach((s) => {
    L.circleMarker([s.lat, s.lng], {
      radius: 5,
      color: "#94a3b8",
      fillColor: "#cbd5e1",
      fillOpacity: 0.8,
      weight: 1,
    })
      .bindPopup(`#${s.id} ${escapeHtml(s.name)}`)
      .addTo(allLayer);
  });

  myStalls.forEach((s) => {
    const ownMarker = L.circleMarker([s.lat, s.lng], {
      radius: 7,
      color: "#b91c1c",
      fillColor: "#f97316",
      fillOpacity: 0.9,
      weight: 1,
    })
      .bindPopup(
        `
          我的摊位 #${s.id} ${escapeHtml(s.name)}<br/>
          ${s.image_url ? `<img src="${escapeHtml(s.image_url)}" alt="摊位图片" class="popup-thumb" /><br/>` : ""}
          <button type="button" onclick="window.merchantEditStall(${s.id})">编辑该摊位</button>
        `,
      )
      .addTo(ownLayer);
    ownMarker.on("click", () => startEditStall(s.id));
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
  [allLayer, ownLayer].forEach((layer) => {
    if (hideMarkers && map.hasLayer(layer)) map.removeLayer(layer);
    if (!hideMarkers && !map.hasLayer(layer)) layer.addTo(map);
  });
}

async function loadMyStalls() {
  myStalls = await apiFetch("/api/merchant/stalls", {}, auth.token);
  fillStallSelect(myStalls);
  fillReviewFilter(myStalls);
  renderMyStalls(myStalls);
}

async function loadMySubmissions() {
  const rows = await apiFetch("/api/merchant/submissions", {}, auth.token);
  renderSubmissions(rows);
}

async function loadMerchantReviews() {
  const stallId = reviewStallFilter.value;
  const qs = stallId ? `?stall_id=${encodeURIComponent(stallId)}` : "";
  const rows = await apiFetch(`/api/merchant/reviews${qs}`, {}, auth.token);
  renderMerchantReviews(rows);
}

modeSelect.addEventListener("change", toggleModeUI);

targetStallSelect.addEventListener("change", () => {
  const id = Number(targetStallSelect.value);
  const stall = myStalls.find((s) => s.id === id);
  if (!stall) return;
  setPickedPoint(stall.lat, stall.lng);
  map.setView([stall.lat, stall.lng], 16);
});

map.on("click", (e) => {
  setPickedPoint(e.latlng.lat, e.latlng.lng);
});

document.getElementById("searchBtn").addEventListener("click", async () => {
  const keyword = document.getElementById("searchInput").value.trim();
  if (!keyword) {
    merchantMsg.textContent = "请输入搜索关键词";
    return;
  }
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(keyword)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      merchantMsg.textContent = "未找到该地点，请尝试更具体关键词";
      return;
    }
    const lat = Number(data[0].lat);
    const lon = Number(data[0].lon);
    map.setView([lat, lon], 16);
    setPickedPoint(lat, lon);
    merchantMsg.textContent = "已定位，请确认或点击地图微调位置";
  } catch (error) {
    merchantMsg.textContent = `地图搜索失败: ${error.message}`;
  }
});

document.getElementById("merchantForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const mode = String(form.get("mode"));

  const payload = {
    name: String(form.get("name") || "").trim(),
    category: String(form.get("category") || "").trim(),
    open_time: String(form.get("open_time") || "").trim(),
    image_url: String(form.get("image_url") || "").trim(),
    lng: Number(form.get("lng")),
    lat: Number(form.get("lat")),
    description: String(form.get("description") || "").trim(),
  };

  try {
    let result;
    if (mode === "update") {
      const targetId = Number(form.get("target_stall_id"));
      if (!targetId) throw new Error("请选择要修改的摊位");
      result = await apiFetch(
        `/api/merchant/stalls/${targetId}/update`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        auth.token,
      );
    } else {
      result = await apiFetch(
        "/api/merchant/stalls",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        auth.token,
      );
    }

    merchantMsg.textContent = result.message;
    await refreshAll();
  } catch (error) {
    merchantMsg.textContent = error.message;
  }
});

document.getElementById("loadMerchantReviewsBtn").addEventListener("click", loadMerchantReviews);
reviewStallFilter.addEventListener("change", loadMerchantReviews);
document.getElementById("refreshBtn").addEventListener("click", refreshAll);
document.getElementById("toggleHeatBtn").addEventListener("click", () => {
  heatVisible = !heatVisible;
  if (!heatLayer) return;
  if (heatVisible) heatLayer.addTo(map);
  else map.removeLayer(heatLayer);
  updateMarkerVisibility();
});
map.on("zoomend", updateMarkerVisibility);
window.merchantEditStall = (stallId) => startEditStall(stallId);

async function refreshAll() {
  await loadMyStalls();
  await loadMapStalls();
  await loadHeatmap();
  await loadMySubmissions();
  await loadMerchantReviews();
  updateMarkerVisibility();
}

(async function init() {
  toggleModeUI();
  await refreshAll();
})();
