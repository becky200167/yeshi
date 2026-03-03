const API_BASE = "http://127.0.0.1:5000";
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

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
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
