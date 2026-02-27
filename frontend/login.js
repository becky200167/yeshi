const params = new URLSearchParams(window.location.search);
const role = params.get("role");
const roleLabel = { user: "用户端", merchant: "商户端", admin: "管理员端" };

if (!roleLabel[role]) window.location.href = "./index.html";

document.getElementById("loginTitle").textContent = `${roleLabel[role]}登录`;

document.getElementById("loginForm").addEventListener("submit", async (e) => {
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
    document.getElementById("loginMsg").textContent = error.message;
  }
});
