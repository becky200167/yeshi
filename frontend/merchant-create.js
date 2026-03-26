const auth = requireRole("merchant");
bindLogout();

const createMsg = document.getElementById("createMsg");
const notificationDot = document.getElementById("notificationDot");
const MAX_IMAGE_COUNT = 8;

const createLocationPickerModal = document.getElementById("createLocationPickerModal");
const createLocationPickerMsg = document.getElementById("createLocationPickerMsg");
const createLocationSearchInput = document.getElementById("createLocationSearchInput");
const createLocationSearchBtn = document.getElementById("createLocationSearchBtn");
const createLocationLocateBtn = document.getElementById("createLocationLocateBtn");
const createLocationConfirmBtn = document.getElementById("createLocationConfirmBtn");
const createLocationCancelBtn = document.getElementById("createLocationCancelBtn");

let pickerMap = null;
let picker = null;
let pendingPoint = null;

function setMsg(text) {
  createMsg.textContent = text;
}

function setPickerMsg(text) {
  createLocationPickerMsg.textContent = text;
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

function ensurePicker() {
  if (picker) return;
  pickerMap = L.map("createLocationMap").setView([28.21, 113.0], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(pickerMap);

  picker = createLocationPicker({
    map: pickerMap,
    markerPopupText: "当前选点",
    onPointSelected(lat, lng) {
      pendingPoint = { lat, lng };
    },
    onMessage(text) {
      setPickerMsg(text);
    },
  });
  picker.bindMapClick();
}

function openLocationPicker() {
  ensurePicker();
  createLocationPickerModal.classList.remove("hidden");

  const latRaw = Number(document.getElementById("latInput").value);
  const lngRaw = Number(document.getElementById("lngInput").value);
  const center = Number.isFinite(latRaw) && Number.isFinite(lngRaw)
    ? { lat: latRaw, lng: lngRaw }
    : { lat: 28.21, lng: 113.0 };
  pendingPoint = { lat: center.lat, lng: center.lng };
  picker.setPoint(center.lat, center.lng, "init", { showMessage: "", panTo: true });
  setPickerMsg("可点击地图、搜索定位或使用当前定位");
  setTimeout(() => {
    pickerMap.invalidateSize();
  }, 0);
}

function closeLocationPicker() {
  createLocationPickerModal.classList.add("hidden");
}

async function uploadImages(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return "";
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
  const urls = Array.isArray(data.urls) ? data.urls : [];
  return urls.length > 0 ? JSON.stringify(urls) : "";
}

document.getElementById("openCreateLocationPickerBtn").addEventListener("click", () => {
  openLocationPicker();
});
createLocationSearchBtn.addEventListener("click", async () => {
  await picker.search(createLocationSearchInput.value);
});
createLocationLocateBtn.addEventListener("click", async () => {
  await picker.useCurrentLocation();
});
createLocationConfirmBtn.addEventListener("click", () => {
  if (!pendingPoint) {
    setPickerMsg("请先在地图上选择位置");
    return;
  }
  document.getElementById("latInput").value = Number(pendingPoint.lat).toFixed(6);
  document.getElementById("lngInput").value = Number(pendingPoint.lng).toFixed(6);
  closeLocationPicker();
  setMsg("已填充经纬度");
});
createLocationCancelBtn.addEventListener("click", () => {
  closeLocationPicker();
});
createLocationPickerModal.addEventListener("click", (e) => {
  if (e.target === createLocationPickerModal) closeLocationPicker();
});

document.getElementById("createStallForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const form = new FormData(e.target);
    const imagePayload = await uploadImages(document.getElementById("imageFilesInput")?.files);
    const payload = {
      name: String(form.get("name") || "").trim(),
      category: String(form.get("category") || "").trim(),
      open_time: String(form.get("open_time") || "").trim(),
      image_url: imagePayload,
      lng: Number(form.get("lng")),
      lat: Number(form.get("lat")),
      description: String(form.get("description") || "").trim(),
    };

    const result = await apiFetch(
      "/api/merchant/stalls",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      auth.token,
    );
    setMsg(result.message);
    e.target.reset();
    if (picker) picker.clearMarker();
  } catch (error) {
    setMsg(error.message);
  }
});

(async function init() {
  await updateNotificationDot();
  setInterval(() => {
    updateNotificationDot().catch(() => {});
  }, 30000);
})();
