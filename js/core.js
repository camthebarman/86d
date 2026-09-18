/* core.js — helpers every tool shares: DOM building, the one modal, the one
   toast. Each tool keeps its own state and its own storage key; all they
   borrow from here is plumbing. */

const Core = (function () {
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === "class") node.className = v;
      // Deliberately no `html:` escape hatch. Every value that reaches the DOM
      // through this builder goes in as a text node, so a guest name, a table
      // note or an imported product description can never become markup.
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    (children || []).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  // ---------- modal ----------
  // One modal element serves all three tools; whichever one opens it owns the
  // body until it closes.
  function openModal(title, renderFn) {
    document.getElementById("modal-title").textContent = title;
    const body = document.getElementById("modal-body");
    body.innerHTML = "";
    renderFn(body, closeModal);
    document.getElementById("modal-overlay").hidden = false;
  }
  function closeModal() {
    document.getElementById("modal-overlay").hidden = true;
  }

  // ---------- toast ----------
  let toastTimer = null;
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }

  // Hands the browser a file to save. The only thing that uses it is the
  // kitchen's printable prep sheet — plain text, not a data export.
  function downloadText(text, filename, mime) {
    const blob = new Blob([text], { type: mime || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Kept as a thin alias so existing callers keep working; the strategy and
  // the format live in platform/ids.js.
  const uid = Ids.prefixed;

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  function init() {
    document.getElementById("modal-close").addEventListener("click", closeModal);
    document.getElementById("modal-overlay").addEventListener("click", (e) => {
      if (e.target.id === "modal-overlay") closeModal();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  }

  return { el, openModal, closeModal, toast, downloadText, uid, ready, init };
})();
