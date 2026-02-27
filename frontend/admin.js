const auth = requireRole("admin");
bindLogout();

const map = L.map("adminMap").setView([28.21, 113.0], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap",
}).addTo(map);

const stallLayer = L.layerGroup().addTo(map);
let heatLayer = null;
let heatVisible = false;
const HIDE_MARKERS_ZOOM = 14;

const adminMsg = document.getElementById("adminMsg");

function setMsg(text) {
  adminMsg.textContent = text;
}

async function loadMapStalls() {
  const stalls = await apiFetch("/api/stalls");
  stallLayer.clearLayers();
  stalls.forEach((s) => {
    L.circleMarker([s.lat, s.lng], {
      radius: 6,
      color: "#0f766e",
      fillColor: "#14b8a6",
      fillOpacity: 0.8,
      weight: 1,
    })
      .bindPopup(
        `#${s.id} ${escapeHtml(s.name)}<br/>
        ${s.image_url ? `<img src="${escapeHtml(s.image_url)}" alt="摊位图片" class="popup-thumb" /><br/>` : ""}
        商户: ${escapeHtml(s.merchant_name || "system")}`,
      )
      .addTo(stallLayer);
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
  if (hideMarkers && map.hasLayer(stallLayer)) map.removeLayer(stallLayer);
  if (!hideMarkers && !map.hasLayer(stallLayer)) stallLayer.addTo(map);
}

document.getElementById("refreshMapBtn").addEventListener("click", refreshMap);
document.getElementById("toggleHeatBtn").addEventListener("click", () => {
  heatVisible = !heatVisible;
  if (!heatLayer) return;
  if (heatVisible) heatLayer.addTo(map);
  else map.removeLayer(heatLayer);
  updateMarkerVisibility();
});
map.on("zoomend", updateMarkerVisibility);

async function refreshMap() {
  try {
    await loadMapStalls();
    await loadHeatmap();
    updateMarkerVisibility();
    setMsg("地图已刷新");
  } catch (error) {
    setMsg(error.message);
  }
}

refreshMap();
