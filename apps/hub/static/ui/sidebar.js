(() => {
  function normalizeNavKey(page) {
    if (!page) return "";
    if (page === "setting" || page === "settings" || page.startsWith("settings-")) return "settings";
    return page;
  }

  function applyActiveState(scope) {
    const page = normalizeNavKey(document.body.getAttribute("data-page") || "");
    const active = scope.querySelector(`[data-nav-key="${page}"]`);
    if (!active) return;

    active.classList.remove("text-slate-400");
    active.classList.add("bg-primary/20", "text-primary", "border", "border-primary/30");
  }

  async function mountSidebar() {
    const root = document.getElementById("sidebar-root");
    if (!root) {
      applyActiveState(document);
      return;
    }

    try {
      const res = await fetch("/ui/partials/sidebar.html", { cache: "no-store" });
      if (!res.ok) throw new Error("sidebar fetch failed");
      root.innerHTML = await res.text();
      applyActiveState(root);
    } catch (error) {
      root.innerHTML = "";
      console.error("Failed to mount sidebar", error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountSidebar);
    return;
  }
  mountSidebar();
})();
