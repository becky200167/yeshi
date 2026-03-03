const params = new URLSearchParams(window.location.search);
const role = params.get("role");
const roleLabel = { user: "用户端", merchant: "商户端", admin: "管理员端" };

if (!roleLabel[role]) window.location.href = "./index.html";

document.getElementById("loginTitle").textContent = `${roleLabel[role]}登录`;

const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const showLoginBtn = document.getElementById("showLoginBtn");
const showRegisterBtn = document.getElementById("showRegisterBtn");
const loginMsg = document.getElementById("loginMsg");

function showLogin() {
  loginForm.classList.remove("hidden");
  registerForm.classList.add("hidden");
  loginMsg.textContent = "";
}

function showRegister() {
  loginForm.classList.add("hidden");
  registerForm.classList.remove("hidden");
  loginMsg.textContent = "";
}

if (role === "admin") {
  showRegisterBtn.classList.add("hidden");
} else {
  showLoginBtn.addEventListener("click", showLogin);
  showRegisterBtn.addEventListener("click", showRegister);
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const payload = {
    role,
    username: form.get("username"),
    password: form.get("password"),
  };

  try {
    const result = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    saveAuth({ token: result.token, role: result.user.role, username: result.user.username });
    const nextPage = { user: "user.html", merchant: "merchant.html", admin: "admin.html" }[role];
    window.location.href = `./${nextPage}`;
  } catch (error) {
    loginMsg.textContent = error.message;
  }
});

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (role === "admin") {
    loginMsg.textContent = "管理员不支持自助注册";
    return;
  }
  const form = new FormData(e.target);
  const payload = {
    role,
    username: String(form.get("username") || "").trim(),
    password: String(form.get("password") || "").trim(),
  };

  try {
    await apiFetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const loginResult = await apiFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    saveAuth({
      token: loginResult.token,
      role: loginResult.user.role,
      username: loginResult.user.username,
    });
    const nextPage = { user: "user.html", merchant: "merchant.html" }[role];
    window.location.href = `./${nextPage}`;
  } catch (error) {
    loginMsg.textContent = error.message;
  }
});
