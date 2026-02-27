const auth = requireRole("admin");
bindLogout();

const adminMsg = document.getElementById("adminMsg");

function setMsg(text) {
  adminMsg.textContent = text;
}

async function loadUsers() {
  const role = document.getElementById("userRoleFilter").value;
  const status = document.getElementById("userStatusFilter").value;
  const q = document.getElementById("userSearchInput").value.trim();
  const list = document.getElementById("adminUsersList");
  list.innerHTML = "";

  const params = new URLSearchParams();
  if (role) params.set("role", role);
  if (status) params.set("status", status);
  if (q) params.set("q", q);
  const qs = params.toString() ? `?${params.toString()}` : "";

  const rows = await apiFetch(`/api/admin/users${qs}`, {}, auth.token);
  if (rows.length === 0) {
    list.innerHTML = "<li>暂无账号</li>";
    return;
  }

  rows.forEach((u) => {
    const li = document.createElement("li");
    li.className = "list-item";
    li.innerHTML = `
      <div><strong>#${u.id} ${escapeHtml(u.username)}</strong> (${escapeHtml(u.role)})</div>
      <div class="hint">状态: ${escapeHtml(u.status)}</div>
    `;

    if (u.role !== "admin") {
      const box = document.createElement("div");
      box.className = "panel-actions";

      if (u.status === "active") {
        const freezeBtn = document.createElement("button");
        freezeBtn.textContent = "冻结";
        freezeBtn.addEventListener("click", async () => {
          try {
            const result = await apiFetch(`/api/admin/users/${u.id}/freeze`, { method: "POST" }, auth.token);
            setMsg(result.message);
            await loadUsers();
          } catch (error) {
            setMsg(error.message);
          }
        });
        box.appendChild(freezeBtn);
      } else {
        const unfreezeBtn = document.createElement("button");
        unfreezeBtn.textContent = "解冻";
        unfreezeBtn.addEventListener("click", async () => {
          try {
            const result = await apiFetch(`/api/admin/users/${u.id}/unfreeze`, { method: "POST" }, auth.token);
            setMsg(result.message);
            await loadUsers();
          } catch (error) {
            setMsg(error.message);
          }
        });
        box.appendChild(unfreezeBtn);
      }
      li.appendChild(box);
    }

    list.appendChild(li);
  });
}

document.getElementById("createUserForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  try {
    const result = await apiFetch(
      "/api/admin/users",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: String(form.get("username") || "").trim(),
          password: String(form.get("password") || "").trim(),
          role: String(form.get("role") || ""),
        }),
      },
      auth.token,
    );
    setMsg(result.message);
    e.target.reset();
    await loadUsers();
  } catch (error) {
    setMsg(error.message);
  }
});

document.getElementById("loadUsersBtn").addEventListener("click", () => {
  loadUsers().catch((error) => setMsg(error.message));
});
document.getElementById("userRoleFilter").addEventListener("change", () => {
  loadUsers().catch((error) => setMsg(error.message));
});
document.getElementById("userStatusFilter").addEventListener("change", () => {
  loadUsers().catch((error) => setMsg(error.message));
});

loadUsers().catch((error) => setMsg(error.message));
