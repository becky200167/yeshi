const auth = requireRole("merchant");
bindLogout();

const map = L.map("merchantMap").setView([28.21, 113.0], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap",
}).addTo(map);

const allLayer = L.layerGroup().addTo(map);
const ownLayer = L.layerGroup().addTo(map);

let myStalls = [];
let currentManagedStallId = null;

const managedStallSelect = document.getElementById("managedStallSelect");
const managedStallHint = document.getElementById("managedStallHint");
const selectedStallTitle = document.getElementById("selectedStallTitle");
const selectedStallDetail = document.getElementById("selectedStallDetail");
const merchantMsg = document.getElementById("merchantMsg");
const notificationDot = document.getElementById("notificationDot");
const editStallModal = document.getElementById("editStallModal");
const openEditLocationPickerBtn = document.getElementById("openEditLocationPickerBtn");
const editLocationPickerModal = document.getElementById("editLocationPickerModal");
const editLocationPickerMsg = document.getElementById("editLocationPickerMsg");
const editLocationPickerSearchInput = document.getElementById("editLocationPickerSearchInput");
const editLocationPickerSearchBtn = document.getElementById("editLocationPickerSearchBtn");
const editLocationPickerLocateBtn = document.getElementById("editLocationPickerLocateBtn");
const editLocationPickerConfirmBtn = document.getElementById("editLocationPickerConfirmBtn");
const editLocationPickerCancelBtn = document.getElementById("editLocationPickerCancelBtn");
const MAX_IMAGE_COUNT = 8;
let editPickerMap = null;
let editPopupLocationPicker = null;
let editPendingPoint = null;

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

function renderImageGallery(imageValue) {
  if (typeof renderZoomableImageGallery === "function") {
    return renderZoomableImageGallery(imageValue, "stall-thumb", { emptyText: "" });
  }
  const urls = parseImageUrls(imageValue);
  if (urls.length === 0) return "";
  return `
    <div class="image-grid">
      ${urls.map((u) => `<img src="${escapeHtml(u)}" alt="摊位图片" class="stall-thumb" />`).join("")}
    </div>
  `;
}

async function uploadImages(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return [];
  if (files.length > MAX_IMAGE_COUNT) {
    throw new Error(`最多可上传 ${MAX_IMAGE_COUNT} 张图片`);
  }

  const formData = new FormData();
  files.forEach((file) => formData.append("images", file));
  const data = await apiFetch(
    "/api/uploads/images",
    {
      method: "POST",
      body: formData,
    },
    auth.token,
  );
  return Array.isArray(data.urls) ? data.urls : [];
}

function setMsg(text) {
  merchantMsg.textContent = text;
}

function setEditLocationPickerMsg(text) {
  editLocationPickerMsg.textContent = text;
}

function ensureEditLocationPicker() {
  if (editPopupLocationPicker) return;
  editPickerMap = L.map("editLocationPickerMap").setView([28.21, 113.0], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(editPickerMap);

  editPopupLocationPicker = createLocationPicker({
    map: editPickerMap,
    markerPopupText: "当前选点",
    onPointSelected(lat, lng) {
      editPendingPoint = { lat, lng };
    },
    onMessage(text) {
      setEditLocationPickerMsg(text);
    },
  });
  editPopupLocationPicker.bindMapClick();
}

function openEditLocationPicker() {
  ensureEditLocationPicker();
  editLocationPickerModal.classList.remove("hidden");
  const form = document.getElementById("editStallForm");
  const lat = Number(form.elements.lat.value);
  const lng = Number(form.elements.lng.value);
  const center = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : map.getCenter();
  editPendingPoint = { lat: Number(center.lat), lng: Number(center.lng) };
  editPopupLocationPicker.setPoint(center.lat, center.lng, "init", { showMessage: "", panTo: true });
  setEditLocationPickerMsg("可点击地图、搜索定位或使用当前定位");
  setTimeout(() => {
    editPickerMap.invalidateSize();
  }, 0);
}

function closeEditLocationPicker() {
  editLocationPickerModal.classList.add("hidden");
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

function getCurrentStall() {
  return myStalls.find((s) => s.id === Number(currentManagedStallId)) || null;
}

function renderManagedSelect() {
  managedStallSelect.innerHTML = "";
  if (myStalls.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "暂无已上传摊位";
    managedStallSelect.appendChild(opt);
    managedStallSelect.disabled = true;
    managedStallHint.textContent = "暂无可管理摊位，请先新增并通过审核";
    return;
  }

  managedStallSelect.disabled = false;
  myStalls.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = String(s.id);
    opt.textContent = `#${s.id} ${s.name}`;
    managedStallSelect.appendChild(opt);
  });

  if (!currentManagedStallId || !myStalls.some((s) => s.id === Number(currentManagedStallId))) {
    currentManagedStallId = myStalls[0].id;
  }
  managedStallSelect.value = String(currentManagedStallId);
  const stall = getCurrentStall();
  managedStallHint.textContent = stall ? `当前管理：#${stall.id} ${stall.name}` : "请先选择一个已上传摊位";
}

function renderSelectedStallDetail() {
  const stall = getCurrentStall();
  if (!stall) {
    selectedStallTitle.textContent = "请选择摊位";
    selectedStallDetail.textContent = "右侧显示摊位管理信息";
    return;
  }

  selectedStallTitle.textContent = `#${stall.id} ${stall.name}`;
  selectedStallDetail.innerHTML = `
    <div><strong>营业状态：</strong>${escapeHtml(businessStatusText(stall))}</div>
    <div><strong>经营类别：</strong>${escapeHtml(stall.category)}</div>
    <div><strong>营业时间：</strong>${escapeHtml(stall.open_time)}</div>
    <div><strong>位置：</strong>${stall.lat}, ${stall.lng}</div>
    ${stall.live_updated_at ? `<div><strong>最近更新：</strong>${escapeHtml(stall.live_updated_at)}</div>` : ""}
    <div><strong>简介：</strong>${escapeHtml(stall.description || "暂无")}</div>
    ${renderImageGallery(stall.image_url)}
  `;
}

function renderMySubmissions(rows) {
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
      <div class="hint">类别: ${escapeHtml(s.category || "")} | 营业时间: ${escapeHtml(s.open_time || "")}</div>
      <div class="hint">位置: ${s.lat}, ${s.lng}</div>
      <div class="hint">简介: ${escapeHtml(s.description || "暂无")}</div>
      ${renderImageGallery(s.image_url)}
      <div>状态: ${escapeHtml(s.status)}</div>
      ${s.reject_reason ? `<div class="hint">驳回原因: ${escapeHtml(s.reject_reason)}</div>` : ""}
    `;
    list.appendChild(li);
  });
}

function renderReviews(rows) {
  const list = document.getElementById("merchantReviewsList");
  list.innerHTML = "";
  if (rows.length === 0) {
    list.innerHTML = "<li>当前摊位暂无评价</li>";
    return;
  }

  rows.forEach((r) => {
    const li = document.createElement("li");
    li.className = "list-item";
    li.innerHTML = `
      <div><strong>${escapeHtml(r.user_name)}</strong> ${stars(r.rating)} (${r.rating})</div>
      <div>${escapeHtml(r.content)}</div>
      <div class="hint">状态: ${escapeHtml(r.status)} | ${escapeHtml(r.created_at || "")}</div>
      ${r.merchant_reply ? `<div class="reply-box">已回复：${escapeHtml(r.merchant_reply)}</div>` : ""}
      <div class="inline-form">
        <input type="text" id="replyInput_${r.id}" placeholder="输入回复内容" />
        <button type="button" data-review-id="${r.id}">保存回复</button>
      </div>
    `;
    list.appendChild(li);
  });

  list.querySelectorAll("button[data-review-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const reviewId = Number(btn.getAttribute("data-review-id"));
      const input = document.getElementById(`replyInput_${reviewId}`);
      const reply = String(input.value || "").trim();
      if (!reply) {
        setMsg("回复内容不能为空");
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
        setMsg(result.message);
        await loadReviewsForManagedStall();
        await updateNotificationDot();
      } catch (error) {
        setMsg(error.message);
      }
    });
  });
}

async function loadMyStalls() {
  const data = await apiFetch("/api/merchant/stalls?page=1&page_size=200", {}, auth.token);
  const { items } = unwrapItems(data);
  myStalls = items;
  renderManagedSelect();
  renderSelectedStallDetail();
}

async function loadMySubmissions() {
  const data = await apiFetch("/api/merchant/submissions?page=1&page_size=20", {}, auth.token);
  const { items } = unwrapItems(data);
  renderMySubmissions(items);
}

async function loadMapStalls() {
  const data = await apiFetch("/api/stalls?page=1&page_size=500");
  const { items } = unwrapItems(data);
  allLayer.clearLayers();
  ownLayer.clearLayers();

  items.forEach((s) => {
    L.circleMarker([s.lat, s.lng], {
      radius: 5,
      color: "#94a3b8",
      fillColor: "#cbd5e1",
      fillOpacity: 0.8,
      weight: 1,
    })
      .bindPopup(`#${s.id} ${escapeHtml(s.name)}<br/>状态：${escapeHtml(businessStatusText(s))}`)
      .addTo(allLayer);
  });

  myStalls.forEach((s) => {
    L.circleMarker([s.lat, s.lng], {
      radius: 7,
      color: "#b91c1c",
      fillColor: "#f97316",
      fillOpacity: 0.9,
      weight: 1,
    })
      .bindPopup(`#${s.id} ${escapeHtml(s.name)}<br/>状态：${escapeHtml(businessStatusText(s))}`)
      .addTo(ownLayer)
      .on("click", async () => {
        currentManagedStallId = s.id;
        renderManagedSelect();
        renderSelectedStallDetail();
        map.setView([s.lat, s.lng], 16);
        await loadReviewsForManagedStall();
      });
  });
}

async function loadReviewsForManagedStall() {
  const stall = getCurrentStall();
  if (!stall) {
    renderReviews([]);
    return;
  }
  const data = await apiFetch(`/api/merchant/reviews?stall_id=${stall.id}&page=1&page_size=20`, {}, auth.token);
  const { items } = unwrapItems(data);
  renderReviews(items);
}

function openEditModal() {
  const stall = getCurrentStall();
  if (!stall) {
    setMsg("请先选择摊位");
    return;
  }
  const form = document.getElementById("editStallForm");
  form.elements.name.value = stall.name || "";
  form.elements.category.value = stall.category || "";
  form.elements.open_time.value = stall.open_time || "";
  form.elements.lng.value = stall.lng;
  form.elements.lat.value = stall.lat;
  form.elements.description.value = stall.description || "";
  if (form.elements.image_files) form.elements.image_files.value = "";
  editStallModal.classList.remove("hidden");
}

function closeEditModal() {
  closeEditLocationPicker();
  editStallModal.classList.add("hidden");
}

async function openStallNow() {
  const stall = getCurrentStall();
  if (!stall) {
    setMsg("请先选择摊位");
    return;
  }

  let lng = Number(stall.lng);
  let lat = Number(stall.lat);
  if (navigator.geolocation) {
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 6000,
          maximumAge: 0,
        });
      });
      lat = Number(pos.coords.latitude);
      lng = Number(pos.coords.longitude);
    } catch {
      // fallback to stall coordinates
    }
  }

  const result = await apiFetch(
    `/api/merchant/stalls/${stall.id}/open`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lng, lat }),
    },
    auth.token,
  );
  setMsg(result.message);
  await refreshAll();
}

async function closeStallNow() {
  const stall = getCurrentStall();
  if (!stall) {
    setMsg("请先选择摊位");
    return;
  }
  const result = await apiFetch(`/api/merchant/stalls/${stall.id}/close`, { method: "POST" }, auth.token);
  setMsg(result.message);
  await refreshAll();
}

async function refreshAll() {
  await loadMyStalls();
  await loadMapStalls();
  await loadMySubmissions();
  await loadReviewsForManagedStall();
  await updateNotificationDot();
}

managedStallSelect.addEventListener("change", () => {
  const id = Number(managedStallSelect.value);
  currentManagedStallId = id || null;
  renderSelectedStallDetail();
  const stall = getCurrentStall();
  managedStallHint.textContent = stall ? `当前管理：#${stall.id} ${stall.name}` : "请先选择一个已上传摊位";
});

document.getElementById("switchManagedStallBtn").addEventListener("click", async () => {
  await loadReviewsForManagedStall();
  const stall = getCurrentStall();
  if (stall) {
    map.setView([stall.lat, stall.lng], 16);
    setMsg(`已进入 #${stall.id} 管理`);
  }
});

document.getElementById("loadMerchantReviewsBtn").addEventListener("click", () => {
  loadReviewsForManagedStall().catch((error) => setMsg(error.message));
});
document.getElementById("refreshBtn").addEventListener("click", () => {
  refreshAll().catch((error) => setMsg(error.message));
});
document.getElementById("editStallBtn").addEventListener("click", openEditModal);
openEditLocationPickerBtn.addEventListener("click", () => {
  openEditLocationPicker();
});
editLocationPickerSearchBtn.addEventListener("click", async () => {
  await editPopupLocationPicker.search(editLocationPickerSearchInput.value);
});
editLocationPickerLocateBtn.addEventListener("click", async () => {
  await editPopupLocationPicker.useCurrentLocation();
});
editLocationPickerConfirmBtn.addEventListener("click", () => {
  if (!editPendingPoint) {
    setEditLocationPickerMsg("请先在地图上选择位置");
    return;
  }
  const form = document.getElementById("editStallForm");
  form.elements.lng.value = Number(editPendingPoint.lng).toFixed(6);
  form.elements.lat.value = Number(editPendingPoint.lat).toFixed(6);
  closeEditLocationPicker();
  setMsg("已填充经纬度");
});
editLocationPickerCancelBtn.addEventListener("click", () => {
  closeEditLocationPicker();
});
editLocationPickerModal.addEventListener("click", (e) => {
  if (e.target === editLocationPickerModal) closeEditLocationPicker();
});
document.getElementById("openStallBtn").addEventListener("click", () => {
  openStallNow().catch((error) => setMsg(error.message));
});
document.getElementById("closeStallBtn").addEventListener("click", () => {
  closeStallNow().catch((error) => setMsg(error.message));
});
document.getElementById("closeEditModalBtn").addEventListener("click", closeEditModal);
editStallModal.addEventListener("click", (e) => {
  if (e.target === editStallModal) closeEditModal();
});

document.getElementById("editStallForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const stall = getCurrentStall();
  if (!stall) {
    setMsg("请先选择摊位");
    return;
  }

  const form = new FormData(e.target);
  try {
    const imageFiles = Array.from(document.getElementById("editImageFilesInput")?.files || []);
    const uploadedUrls = imageFiles.length > 0
      ? await uploadImages(imageFiles)
      : parseImageUrls(stall.image_url);
    const payload = {
      name: String(form.get("name") || "").trim(),
      category: String(form.get("category") || "").trim(),
      open_time: String(form.get("open_time") || "").trim(),
      image_url: uploadedUrls.length > 0 ? JSON.stringify(uploadedUrls) : "",
      lng: Number(form.get("lng")),
      lat: Number(form.get("lat")),
      description: String(form.get("description") || "").trim(),
    };

    const result = await apiFetch(
      `/api/merchant/stalls/${stall.id}/update`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      auth.token,
    );
    setMsg(result.message);
    closeEditModal();
    await refreshAll();
  } catch (error) {
    setMsg(error.message);
  }
});

(async function init() {
  await refreshAll();
  setInterval(() => {
    updateNotificationDot().catch(() => {});
  }, 30000);
})();


