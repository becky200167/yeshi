(function () {
  function escapeAttr(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function parseViewerImageUrls(imageValue) {
    if (!imageValue) return [];
    if (Array.isArray(imageValue)) return imageValue.filter(Boolean).map((item) => String(item));
    const raw = String(imageValue).trim();
    if (!raw) return [];
    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.filter(Boolean).map((item) => String(item));
      } catch {
        // fallback to single url
      }
    }
    return [raw];
  }

  function buildImageTrigger(urls, index, cls, alt) {
    const payload = escapeAttr(JSON.stringify(urls));
    return `
      <button
        type="button"
        class="image-zoom-trigger"
        data-image-viewer-trigger="1"
        data-image-viewer-index="${index}"
        data-image-viewer-urls="${payload}"
      >
        <img src="${escapeAttr(urls[index])}" alt="${escapeAttr(alt)}" class="${escapeAttr(cls)}" />
      </button>
    `;
  }

  function renderZoomableImageGallery(imageValue, cls = "stall-thumb", options = {}) {
    const urls = parseViewerImageUrls(imageValue);
    const emptyText = options.emptyText ?? "";
    const alt = options.alt || "摊位图片";
    if (urls.length === 0) {
      return emptyText ? `<div class="hint">${escapeAttr(emptyText)}</div>` : "";
    }
    return `
      <div class="image-grid">
        ${urls.map((_, index) => buildImageTrigger(urls, index, cls, alt)).join("")}
      </div>
    `;
  }

  function renderZoomableCoverImage(imageValue, cls = "discover-thumb", options = {}) {
    const urls = parseViewerImageUrls(imageValue);
    const emptyText = options.emptyText || "暂无配图";
    const alt = options.alt || "摊位图片";
    if (urls.length === 0) {
      return `<div class="discover-thumb-empty">${escapeAttr(emptyText)}</div>`;
    }
    return buildImageTrigger(urls, 0, cls, alt);
  }

  function ensureImageViewerModal() {
    let modal = document.getElementById("sharedImageViewerModal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "sharedImageViewerModal";
    modal.className = "modal hidden";
    modal.innerHTML = `
      <div class="modal-card modal-card-image-viewer">
        <div class="image-viewer-toolbar">
          <span id="sharedImageViewerCounter" class="hint"></span>
          <div class="panel-actions">
            <button id="sharedImageViewerPrevBtn" type="button">上一张</button>
            <button id="sharedImageViewerNextBtn" type="button">下一张</button>
            <button id="sharedImageViewerCloseBtn" type="button">关闭</button>
          </div>
        </div>
        <div class="image-viewer-stage">
          <img id="sharedImageViewerImg" class="image-viewer-img" alt="原图预览" />
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  const state = {
    urls: [],
    index: 0,
  };

  function syncViewer() {
    const modal = ensureImageViewerModal();
    const img = modal.querySelector("#sharedImageViewerImg");
    const counter = modal.querySelector("#sharedImageViewerCounter");
    const prevBtn = modal.querySelector("#sharedImageViewerPrevBtn");
    const nextBtn = modal.querySelector("#sharedImageViewerNextBtn");

    if (!state.urls.length) return;
    img.src = state.urls[state.index];
    counter.textContent = `${state.index + 1} / ${state.urls.length}`;
    prevBtn.disabled = state.urls.length <= 1;
    nextBtn.disabled = state.urls.length <= 1;
  }

  function openImageViewer(urls, startIndex = 0) {
    state.urls = Array.isArray(urls) ? urls.filter(Boolean).map((item) => String(item)) : [];
    if (state.urls.length === 0) return;
    state.index = Math.max(0, Math.min(state.urls.length - 1, Number(startIndex) || 0));
    const modal = ensureImageViewerModal();
    modal.classList.remove("hidden");
    syncViewer();
  }

  function closeImageViewer() {
    const modal = ensureImageViewerModal();
    modal.classList.add("hidden");
  }

  function stepImageViewer(delta) {
    if (state.urls.length <= 1) return;
    state.index = (state.index + delta + state.urls.length) % state.urls.length;
    syncViewer();
  }

  document.addEventListener(
    "click",
    (event) => {
      const trigger = event.target.closest("[data-image-viewer-trigger]");
      if (!trigger) return;
      event.preventDefault();
      event.stopPropagation();
      let urls = [];
      try {
        urls = JSON.parse(trigger.getAttribute("data-image-viewer-urls") || "[]");
      } catch {
        urls = [];
      }
      openImageViewer(urls, Number(trigger.getAttribute("data-image-viewer-index") || 0));
    },
    true,
  );

  document.addEventListener("click", (event) => {
    const modal = document.getElementById("sharedImageViewerModal");
    if (!modal) return;
    if (event.target === modal) closeImageViewer();
  });

  document.addEventListener("keydown", (event) => {
    const modal = document.getElementById("sharedImageViewerModal");
    if (!modal || modal.classList.contains("hidden")) return;
    if (event.key === "Escape") closeImageViewer();
    if (event.key === "ArrowLeft") stepImageViewer(-1);
    if (event.key === "ArrowRight") stepImageViewer(1);
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.id === "sharedImageViewerCloseBtn") closeImageViewer();
    if (target.id === "sharedImageViewerPrevBtn") stepImageViewer(-1);
    if (target.id === "sharedImageViewerNextBtn") stepImageViewer(1);
  });

  window.parseViewerImageUrls = parseViewerImageUrls;
  window.renderZoomableImageGallery = renderZoomableImageGallery;
  window.renderZoomableCoverImage = renderZoomableCoverImage;
  window.openImageViewer = openImageViewer;
})();
