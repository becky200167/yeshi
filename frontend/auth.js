const API_BASE = "http://127.0.0.1:5000";

function saveAuth(auth) {
  localStorage.setItem("night_market_auth", JSON.stringify(auth));
}

function getAuth() {
  const raw = localStorage.getItem("night_market_auth");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearAuth() {
  localStorage.removeItem("night_market_auth");
}

function requireRole(expectedRole) {
  const auth = getAuth();
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
    clearAuth();
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
