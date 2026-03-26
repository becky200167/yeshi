const auth = requireRole("admin");
bindLogout();

const adminMsg = document.getElementById("adminMsg");
const pageInfo = document.getElementById("stallPageInfo");
let currentPage = 1;
let totalPages = 1;

const preview = createAdminStallPreview({
  auth,
  setPageMessage: setMsg,
  onMutated: async () => {
    await loadAdminStalls();
  },
});

function setMsg(text) {
  adminMsg.textContent = text;
}

async function loadAdminStalls() {
  const status = document.getElementById("stallStatusFilter").value;
  const q = document.getElementById("stallSearchInput").value.trim();
  const params = new URLSearchParams({
    page: String(currentPage),
    page_size: "10",
  });
  if (status) params.set("status", status);
  if (q) params.set("q", q);

  const data = await apiFetch(`/api/admin/stalls?${params.toString()}`, {}, auth.token);
  const { items, pagination } = unwrapItems(data);
  totalPages = pagination?.total_pages || 1;
  pageInfo.textContent = `第 ${pagination?.page || 1} / ${totalPages} 页，共 ${pagination?.total || items.length} 条`;

  const list = document.getElementById("adminStallsList");
  list.innerHTML = "";
  if (items.length === 0) {
    list.innerHTML = "<li>暂无摊位</li>";
    return;
  }

  items.forEach((stall) => {
    const li = document.createElement("li");
    li.className = "list-item";
    li.innerHTML = `
      <div>
        <button type="button" class="inline-link-btn" data-preview-stall="${stall.id}">#${stall.id} ${escapeHtml(stall.name)}</button>
        (${escapeHtml(stall.category)})
      </div>
      <div>商户: ${escapeHtml(stall.merchant_name || "")} | 状态: ${escapeHtml(stall.status || "")}</div>
      <div class="hint">位置: ${stall.lat}, ${stall.lng} | 营业时间: ${escapeHtml(stall.open_time || "")}</div>
    `;

    li.querySelector(`[data-preview-stall="${stall.id}"]`)?.addEventListener("click", () => {
      preview.openStall(stall.id).catch((error) => setMsg(error.message));
    });

    const box = document.createElement("div");
    box.className = "panel-actions";

    const viewBtn = document.createElement("button");
    viewBtn.type = "button";
    viewBtn.textContent = "查看";
    viewBtn.addEventListener("click", () => {
      preview.openStall(stall.id).catch((error) => setMsg(error.message));
    });

    const offlineBtn = document.createElement("button");
    offlineBtn.type = "button";
    offlineBtn.textContent = "下架";
    offlineBtn.disabled = stall.status === "offline";
    offlineBtn.addEventListener("click", async () => {
      try {
        const result = await apiFetch(`/api/admin/stalls/${stall.id}/offline`, { method: "POST" }, auth.token);
        setMsg(result.message);
        await loadAdminStalls();
      } catch (error) {
        setMsg(error.message);
      }
    });

    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.textContent = "恢复上架";
    restoreBtn.disabled = stall.status === "approved";
    restoreBtn.addEventListener("click", async () => {
      try {
        const result = await apiFetch(`/api/admin/stalls/${stall.id}/restore`, { method: "POST" }, auth.token);
        setMsg(result.message);
        await loadAdminStalls();
      } catch (error) {
        setMsg(error.message);
      }
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "删除";
    delBtn.className = "danger-btn";
    delBtn.addEventListener("click", async () => {
      if (!window.confirm(`确认删除摊位 #${stall.id} ${stall.name}？`)) return;
      try {
        const result = await apiFetch(`/api/admin/stalls/${stall.id}`, { method: "DELETE" }, auth.token);
        setMsg(result.message);
        await loadAdminStalls();
      } catch (error) {
        setMsg(error.message);
      }
    });

    box.appendChild(viewBtn);
    box.appendChild(offlineBtn);
    box.appendChild(restoreBtn);
    box.appendChild(delBtn);
    li.appendChild(box);
    list.appendChild(li);
  });
}

document.getElementById("loadStallsBtn").addEventListener("click", () => {
  currentPage = 1;
  loadAdminStalls().catch((error) => setMsg(error.message));
});
document.getElementById("stallSearchBtn").addEventListener("click", () => {
  currentPage = 1;
  loadAdminStalls().catch((error) => setMsg(error.message));
});
document.getElementById("stallStatusFilter").addEventListener("change", () => {
  currentPage = 1;
  loadAdminStalls().catch((error) => setMsg(error.message));
});
document.getElementById("stallPrevPageBtn").addEventListener("click", () => {
  if (currentPage <= 1) return;
  currentPage -= 1;
  loadAdminStalls().catch((error) => setMsg(error.message));
});
document.getElementById("stallNextPageBtn").addEventListener("click", () => {
  if (currentPage >= totalPages) return;
  currentPage += 1;
  loadAdminStalls().catch((error) => setMsg(error.message));
});

loadAdminStalls().catch((error) => setMsg(error.message));
