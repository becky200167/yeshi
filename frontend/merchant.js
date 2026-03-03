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
const MAX_IMAGE_COUNT = 8;

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
  const urls = parseImageUrls(imageValue);
  if (urls.length === 0) return "";
  return `
    <div class="image-grid">
      ${urls.map((u) => `<img src="${escapeHtml(u)}" alt="鎽婁綅鍥剧墖" class="stall-thumb" />`).join("")}
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
    managedStallHint.textContent = "鏆傛棤鍙鐞嗘憡浣嶏紝璇峰厛鏂板骞堕€氳繃瀹℃牳";
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
  managedStallHint.textContent = stall ? `褰撳墠绠＄悊锛?${stall.id} ${stall.name}` : "璇峰厛閫夋嫨涓€涓凡涓婁紶鎽婁綅";
}

function renderSelectedStallDetail() {
  const stall = getCurrentStall();
  if (!stall) {
    selectedStallTitle.textContent = "璇烽€夋嫨鎽婁綅";
    selectedStallDetail.textContent = "鍙充晶鏄剧ず鎽婁綅绠＄悊淇℃伅";
    return;
  }

  selectedStallTitle.textContent = `#${stall.id} ${stall.name}`;
  selectedStallDetail.innerHTML = `
    <div><strong>钀ヤ笟鐘舵€侊細</strong>${escapeHtml(businessStatusText(stall))}</div>
    <div><strong>缁忚惀绫诲埆锛?/strong>${escapeHtml(stall.category)}</div>
    <div><strong>钀ヤ笟鏃堕棿锛?/strong>${escapeHtml(stall.open_time)}</div>
    <div><strong>浣嶇疆锛?/strong>${stall.lat}, ${stall.lng}</div>
    ${stall.live_updated_at ? `<div><strong>鏈€杩戞洿鏂帮細</strong>${escapeHtml(stall.live_updated_at)}</div>` : ""}
    <div><strong>绠€浠嬶細</strong>${escapeHtml(stall.description || "鏆傛棤")}</div>
    ${renderImageGallery(stall.image_url)}
  `;
}

function renderMySubmissions(rows) {
  const list = document.getElementById("mySubmissionsList");
  list.innerHTML = "";
  if (rows.length === 0) {
    list.innerHTML = "<li>鏆傛棤鎻愪氦璁板綍</li>";
    return;
  }
  rows.forEach((s) => {
    const li = document.createElement("li");
    li.className = "list-item";
    li.innerHTML = `
      <div><strong>#${s.id}</strong> ${escapeHtml(s.name)} (${escapeHtml(s.action)})</div>
      <div class="hint">绫诲埆: ${escapeHtml(s.category || "")} | 钀ヤ笟鏃堕棿: ${escapeHtml(s.open_time || "")}</div>
      <div class="hint">浣嶇疆: ${s.lat}, ${s.lng}</div>
      <div class="hint">绠€浠? ${escapeHtml(s.description || "鏆傛棤")}</div>
      ${renderImageGallery(s.image_url)}
      <div>鐘舵€? ${escapeHtml(s.status)}</div>
      ${s.reject_reason ? `<div class="hint">椹冲洖鍘熷洜: ${escapeHtml(s.reject_reason)}</div>` : ""}
    `;
    list.appendChild(li);
  });
}

function renderReviews(rows) {
  const list = document.getElementById("merchantReviewsList");
  list.innerHTML = "";
  if (rows.length === 0) {
    list.innerHTML = "<li>褰撳墠鎽婁綅鏆傛棤璇勪环</li>";
    return;
  }

  rows.forEach((r) => {
    const li = document.createElement("li");
    li.className = "list-item";
    li.innerHTML = `
      <div><strong>${escapeHtml(r.user_name)}</strong> ${stars(r.rating)} (${r.rating})</div>
      <div>${escapeHtml(r.content)}</div>
      <div class="hint">鐘舵€? ${escapeHtml(r.status)} | ${escapeHtml(r.created_at || "")}</div>
      ${r.merchant_reply ? `<div class="reply-box">宸插洖澶嶏細${escapeHtml(r.merchant_reply)}</div>` : ""}
      <div class="inline-form">
        <input type="text" id="replyInput_${r.id}" placeholder="杈撳叆鍥炲" />
        <button type="button" data-review-id="${r.id}">淇濆瓨鍥炲</button>
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
        setMsg("鍥炲鍐呭涓嶈兘涓虹┖");
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
      .bindPopup(`#${s.id} ${escapeHtml(s.name)}<br/>鐘舵€侊細${escapeHtml(businessStatusText(s))}`)
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
      .bindPopup(`#${s.id} ${escapeHtml(s.name)}<br/>鐘舵€侊細${escapeHtml(businessStatusText(s))}`)
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
    setMsg("璇峰厛閫夋嫨鎽婁綅");
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
  editStallModal.classList.add("hidden");
}

async function openStallNow() {
  const stall = getCurrentStall();
  if (!stall) {
    setMsg("璇峰厛閫夋嫨鎽婁綅");
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
    setMsg("璇峰厛閫夋嫨鎽婁綅");
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
  managedStallHint.textContent = stall ? `褰撳墠绠＄悊锛?${stall.id} ${stall.name}` : "璇峰厛閫夋嫨涓€涓凡涓婁紶鎽婁綅";
});

document.getElementById("switchManagedStallBtn").addEventListener("click", async () => {
  await loadReviewsForManagedStall();
  const stall = getCurrentStall();
  if (stall) {
    map.setView([stall.lat, stall.lng], 16);
    setMsg(`宸茶繘鍏?#${stall.id} 绠＄悊`);
  }
});

document.getElementById("loadMerchantReviewsBtn").addEventListener("click", () => {
  loadReviewsForManagedStall().catch((error) => setMsg(error.message));
});
document.getElementById("refreshBtn").addEventListener("click", () => {
  refreshAll().catch((error) => setMsg(error.message));
});
document.getElementById("editStallBtn").addEventListener("click", openEditModal);
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
    setMsg("璇峰厛閫夋嫨鎽婁綅");
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


