const AUTH_KEY = "night_market_auth";
const KNOWN_ROLES = ["user", "merchant", "admin"];

function roleAuthKey(role) {
  return `${AUTH_KEY}_${role}`;
}

function parseAuth(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveAuth(auth) {
  if (!auth || !auth.role) return;
  localStorage.setItem(roleAuthKey(auth.role), JSON.stringify(auth));
  // Keep legacy key for compatibility with old pages/sessions.
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

function getAuth(role = "") {
  const finalRole = role || inferRoleFromContext();
  if (finalRole) {
    const scoped = parseAuth(localStorage.getItem(roleAuthKey(finalRole)));
    if (scoped) return scoped;
  }
  return parseAuth(localStorage.getItem(AUTH_KEY));
}

function inferRoleFromContext() {
  try {
    const fromQuery = new URLSearchParams(window.location.search).get("role");
    if (KNOWN_ROLES.includes(fromQuery)) return fromQuery;
    const path = String(window.location.pathname || "").toLowerCase();
    if (path.endsWith("/user.html")) return "user";
    if (path.endsWith("/merchant.html") || path.endsWith("/merchant-create.html")) return "merchant";
    if (path.includes("/admin")) return "admin";
  } catch {
    // ignore inference errors
  }
  return "";
}

function clearAuth(role = "") {
  if (role) {
    localStorage.removeItem(roleAuthKey(role));
    const legacy = parseAuth(localStorage.getItem(AUTH_KEY));
    if (legacy && legacy.role === role) {
      localStorage.removeItem(AUTH_KEY);
    }
    return;
  }
  localStorage.removeItem(AUTH_KEY);
}

function requireRole(expectedRole) {
  const auth = getAuth(expectedRole);
  if (!auth || auth.role !== expectedRole || !auth.token) {
    window.location.href = "./index.html";
    throw new Error("未登录或角色不匹配");
  }
  return auth;
}

async function apiFetch(path, options = {}, token = "") {
  const headers = Object.assign({}, options.headers || {});
  if (token) headers.Authorization = `Bearer ${token}`;

  const apiBase = typeof globalThis.API_BASE === "string" && globalThis.API_BASE.trim()
    ? globalThis.API_BASE.trim()
    : "http://127.0.0.1:5000";
  const res = await fetch(`${apiBase}${path}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "请求失败");
  return data;
}

function bindLogout() {
  const btn = document.getElementById("logoutBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const auth = getAuth();
    clearAuth(auth?.role || "");
    window.location.href = "./index.html";
  });
}

function escapeHtml(input) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stars(n) {
  const count = Number(n) || 0;
  return "★".repeat(Math.max(0, Math.min(5, count))) + "☆".repeat(Math.max(0, 5 - count));
}

function unwrapItems(data) {
  if (Array.isArray(data)) {
    return { items: data, pagination: null };
  }
  return { items: Array.isArray(data.items) ? data.items : [], pagination: data.pagination || null };
}

function createLocationPicker(options = {}) {
  const map = options.map;
  if (!map) throw new Error("createLocationPicker requires map");

  const onPointSelected = typeof options.onPointSelected === "function" ? options.onPointSelected : () => {};
  const onMessage = typeof options.onMessage === "function" ? options.onMessage : () => {};
  const zoom = Number(options.zoom) || 16;
  const markerPopupText = String(options.markerPopupText || "当前选点");
  const withMarker = options.withMarker !== false;

  let marker = null;
  let mapClickBound = false;

  function formatGeoError(err) {
    const code = Number(err?.code || 0);
    if (code === 1) return "定位失败：定位权限被拒绝";
    if (code === 2) return "定位失败：无法获取当前位置";
    if (code === 3) return "定位失败：请求超时";
    return `定位失败：${err?.message || "未知错误"}`;
  }

  function setPoint(lat, lng, source = "manual", opts = {}) {
    const finalLat = Number(lat);
    const finalLng = Number(lng);
    if (!Number.isFinite(finalLat) || !Number.isFinite(finalLng)) {
      onMessage("位置坐标不合法");
      return false;
    }

    onPointSelected(Number(finalLat.toFixed(6)), Number(finalLng.toFixed(6)), source);
    if (opts.panTo !== false) {
      map.setView([finalLat, finalLng], zoom);
    }
    if (withMarker) {
      if (marker) map.removeLayer(marker);
      marker = L.marker([finalLat, finalLng]).addTo(map);
      if (markerPopupText) marker.bindPopup(markerPopupText).openPopup();
    }
    if (opts.showMessage) {
      onMessage(opts.showMessage);
    }
    return true;
  }

  async function search(keyword) {
    const q = String(keyword || "").trim();
    if (!q) {
      onMessage("请输入搜索关键词");
      return false;
    }
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        onMessage("未找到位置，请尝试更具体关键词");
        return false;
      }
      const lat = Number(data[0].lat);
      const lng = Number(data[0].lon);
      return setPoint(lat, lng, "search", { showMessage: "已根据搜索结果定位" });
    } catch (error) {
      onMessage(`搜索定位失败：${error.message}`);
      return false;
    }
  }

  async function useCurrentLocation() {
    if (!navigator.geolocation) {
      onMessage("当前浏览器不支持定位");
      return false;
    }
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 6000,
          maximumAge: 0,
        });
      });
      return setPoint(pos.coords.latitude, pos.coords.longitude, "gps", { showMessage: "已使用当前定位" });
    } catch (error) {
      onMessage(formatGeoError(error));
      return false;
    }
  }

  function handleMapClick(e) {
    setPoint(e.latlng.lat, e.latlng.lng, "map", { showMessage: "已通过地图选点填充坐标", panTo: false });
  }

  function bindMapClick() {
    if (mapClickBound) return;
    map.on("click", handleMapClick);
    mapClickBound = true;
  }

  function unbindMapClick() {
    if (!mapClickBound) return;
    map.off("click", handleMapClick);
    mapClickBound = false;
  }

  function clearMarker() {
    if (!marker) return;
    map.removeLayer(marker);
    marker = null;
  }

  return {
    setPoint,
    search,
    useCurrentLocation,
    bindMapClick,
    unbindMapClick,
    clearMarker,
  };
}
