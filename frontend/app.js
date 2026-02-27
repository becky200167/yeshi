const API_BASE = "http://127.0.0.1:5000";

const map = L.map("map").setView([28.2284, 112.9388], 15);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap",
}).addTo(map);

let markersLayer = L.layerGroup().addTo(map);
let heatLayer = null;
let heatVisible = false;

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || "请求失败");
  }
  return data;
}

function stallPopup(stall) {
  return `
    <strong>${stall.name}</strong><br/>
    类别: ${stall.category}<br/>
    营业时间: ${stall.open_time}<br/>
    简介: ${stall.description || "无"}
  `;
}

async function loadStalls() {
  const stalls = await fetchJSON(`${API_BASE}/api/stalls`);
  markersLayer.clearLayers();

  stalls.forEach((stall) => {
    L.marker([stall.lat, stall.lng]).bindPopup(stallPopup(stall)).addTo(markersLayer);
  });
}

async function loadHeatmap() {
  const points = await fetchJSON(`${API_BASE}/api/heatmap`);
  const latlngs = points.map((p) => [p.lat, p.lng, p.weight]);

  if (heatLayer) {
    map.removeLayer(heatLayer);
  }

  heatLayer = L.heatLayer(latlngs, {
    radius: 32,
    blur: 20,
    maxZoom: 18,
  });

  if (heatVisible) {
    heatLayer.addTo(map);
  }
}

document.getElementById("refreshBtn").addEventListener("click", async () => {
  await loadStalls();
  await loadHeatmap();
});

document.getElementById("toggleHeatBtn").addEventListener("click", () => {
  heatVisible = !heatVisible;
  if (!heatLayer) {
    return;
  }
  if (heatVisible) {
    heatLayer.addTo(map);
  } else {
    map.removeLayer(heatLayer);
  }
});

document.getElementById("merchantForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("merchantMsg");
  const form = new FormData(e.target);

  const payload = {
    merchant_name: form.get("merchant_name"),
    name: form.get("name"),
    category: form.get("category"),
    open_time: form.get("open_time"),
    lng: Number(form.get("lng")),
    lat: Number(form.get("lat")),
    description: form.get("description"),
    action: "create",
  };

  try {
    const result = await fetchJSON(`${API_BASE}/api/merchant/submissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    msg.textContent = result.message;
    e.target.reset();
  } catch (error) {
    msg.textContent = error.message;
  }
});

async function loadPending() {
  const list = document.getElementById("pendingList");
  list.innerHTML = "";

  const pending = await fetchJSON(`${API_BASE}/api/admin/submissions?status=pending`);
  pending.forEach((item) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.textContent = "通过";
    btn.addEventListener("click", async () => {
      const adminMsg = document.getElementById("adminMsg");
      try {
        const result = await fetchJSON(`${API_BASE}/api/admin/submissions/${item.id}/approve`, {
          method: "POST",
        });
        adminMsg.textContent = `#${item.id} ${result.message}`;
        await loadPending();
        await loadStalls();
        await loadHeatmap();
      } catch (error) {
        adminMsg.textContent = error.message;
      }
    });

    li.textContent = `#${item.id} ${item.name} (${item.category}) - ${item.merchant_name} `;
    li.appendChild(btn);
    list.appendChild(li);
  });

  if (pending.length === 0) {
    list.innerHTML = "<li>暂无待审核记录</li>";
  }
}

document.getElementById("loadPendingBtn").addEventListener("click", async () => {
  try {
    await loadPending();
  } catch (error) {
    document.getElementById("adminMsg").textContent = error.message;
  }
});

(async function init() {
  try {
    await loadStalls();
    await loadHeatmap();
  } catch (error) {
    alert(`初始化失败: ${error.message}`);
  }
})();
