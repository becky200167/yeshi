const role = new URLSearchParams(window.location.search).get("role");
const auth = getAuth(role || "");
if (!auth || !auth.token || !["user", "merchant"].includes(auth.role) || (role && auth.role !== role)) {
  window.location.href = "./index.html";
}
bindLogout();

const roleLabel = { user: "用户", merchant: "商户" };
const backPage = { user: "user.html", merchant: "merchant.html" };

document.getElementById("notificationsTitle").textContent = `${roleLabel[auth.role]}消息中心`;
document.getElementById("backBtn").href = `./${backPage[auth.role]}?role=${auth.role}`;

const notificationsList = document.getElementById("notificationsList");
const notificationsMsg = document.getElementById("notificationsMsg");
const pageInfo = document.getElementById("notificationsPageInfo");

let currentPage = 1;
let totalPages = 1;

function setMsg(text) {
  notificationsMsg.textContent = text;
}

function renderNotifications(items) {
  notificationsList.innerHTML = "";
  if (items.length === 0) {
    notificationsList.innerHTML = "<li>暂无消息</li>";
    return;
  }

  items.forEach((n) => {
    const li = document.createElement("li");
    li.className = "list-item";
    li.innerHTML = `
      <div><strong>${escapeHtml(n.title)}</strong> ${Number(n.is_read) ? "" : "<span class=\"badge\">未读</span>"}</div>
      <div>${escapeHtml(n.content)}</div>
      <div class="hint">${escapeHtml(n.created_at || "")}</div>
    `;

    if (!Number(n.is_read)) {
      const readBtn = document.createElement("button");
      readBtn.type = "button";
      readBtn.textContent = "标记已读";
      readBtn.addEventListener("click", async () => {
        try {
          await apiFetch(`/api/notifications/${n.id}/read`, { method: "POST" }, auth.token);
          await loadNotifications();
        } catch (error) {
          setMsg(error.message);
        }
      });
      li.appendChild(readBtn);
    }

    notificationsList.appendChild(li);
  });
}

async function loadNotifications() {
  const unreadOnly = document.getElementById("unreadFilter").value;
  const params = new URLSearchParams({
    page: String(currentPage),
    page_size: "20",
  });
  if (unreadOnly) params.set("unread_only", "1");

  const data = await apiFetch(`/api/notifications?${params.toString()}`, {}, auth.token);
  const { items, pagination } = unwrapItems(data);
  totalPages = pagination?.total_pages || 1;
  pageInfo.textContent = `第 ${pagination?.page || 1} / ${totalPages} 页，共 ${pagination?.total || items.length} 条`;
  renderNotifications(items);
}

document.getElementById("loadNotificationsBtn").addEventListener("click", () => {
  currentPage = 1;
  loadNotifications().catch((error) => setMsg(error.message));
});
document.getElementById("unreadFilter").addEventListener("change", () => {
  currentPage = 1;
  loadNotifications().catch((error) => setMsg(error.message));
});
document.getElementById("readAllNotificationsBtn").addEventListener("click", async () => {
  try {
    const result = await apiFetch("/api/notifications/read-all", { method: "POST" }, auth.token);
    setMsg(result.message);
    currentPage = 1;
    await loadNotifications();
  } catch (error) {
    setMsg(error.message);
  }
});
document.getElementById("notificationsPrevBtn").addEventListener("click", () => {
  if (currentPage <= 1) return;
  currentPage -= 1;
  loadNotifications().catch((error) => setMsg(error.message));
});
document.getElementById("notificationsNextBtn").addEventListener("click", () => {
  if (currentPage >= totalPages) return;
  currentPage += 1;
  loadNotifications().catch((error) => setMsg(error.message));
});

loadNotifications().catch((error) => setMsg(error.message));
