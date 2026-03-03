const auth = requireRole("merchant");
bindLogout();

const map = L.map("createMap").setView([28.21, 113.0], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap",
}).addTo(map);

const createMsg = document.getElementById("createMsg");
const notificationDot = document.getElementById("notificationDot");
let pickMarker = null;
const MAX_IMAGE_COUNT = 8;

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

function setMsg(text) {
  createMsg.textContent = text;
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

function setPickedPoint(lat, lng) {
  document.getElementById("latInput").value = Number(lat).toFixed(6);
  document.getElementById("lngInput").value = Number(lng).toFixed(6);
  if (pickMarker) map.removeLayer(pickMarker);
  pickMarker = L.marker([lat, lng]).addTo(map).bindPopup("褰撳墠閫夌偣").openPopup();
}

map.on("click", (e) => {
  setPickedPoint(e.latlng.lat, e.latlng.lng);
});

document.getElementById("searchBtn").addEventListener("click", async () => {
  const keyword = document.getElementById("searchInput").value.trim();
  if (!keyword) {
    setMsg("璇疯緭鍏ユ悳绱㈠叧閿瘝");
    return;
  }
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(keyword)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      setMsg("鏈壘鍒拌鍦扮偣锛岃灏濊瘯鏇村叿浣撳叧閿瘝");
      return;
    }
    const lat = Number(data[0].lat);
    const lng = Number(data[0].lon);
    map.setView([lat, lng], 16);
    setPickedPoint(lat, lng);
    setMsg("宸插畾浣嶏紝璇风‘璁ゆ垨鐐瑰嚮鍦板浘寰皟浣嶇疆");
  } catch (error) {
    setMsg(`鍦板浘鎼滅储澶辫触: ${error.message}`);
  }
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
    if (pickMarker) {
      map.removeLayer(pickMarker);
      pickMarker = null;
    }
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
