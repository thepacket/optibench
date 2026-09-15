export function bindWorkspaceLayout({ root, panel }) {
  const key = "optibench-workspace-layouts";
  let current = { inventory: 286, inspector: 294, results: 261 };
  let collapsed = { inventory: false, inspector: false };
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    for (const [name, min, max] of [
      ["inventory", 220, 460],
      ["inspector", 220, 500],
      ["results", 130, 2000],
    ]) {
      if (
        Number.isFinite(saved?.current?.[name]) &&
        saved.current[name] >= min &&
        saved.current[name] <= max
      )
        current[name] = saved.current[name];
    }
    for (const name of ["inventory", "inspector"])
      collapsed[name] = saved?.collapsed?.[name] === true;
  } catch {}
  const persist = () => {
    try {
      localStorage.setItem(key, JSON.stringify({ current, collapsed }));
    } catch {}
  };
  const handles = [];
  function applyWidths() {
    const width = root.clientWidth;
    const budget = Math.max(440, width - 67 - 400);
    const inspector = collapsed.inspector
      ? 0
      : Math.max(
          220,
          Math.min(current.inspector, budget - (collapsed.inventory ? 0 : 220)),
        );
    const inventory = collapsed.inventory
      ? 0
      : Math.max(
          220,
          Math.min(
            current.inventory,
            width >= 1280
              ? budget - inspector
              : Math.max(220, width - 62 - 350),
          ),
        );
    root.style.setProperty("--inventory-width", inventory + "px");
    root.style.setProperty("--inspector-width", inspector + "px");
    root.dataset.inventoryCollapsed = String(collapsed.inventory);
    root.dataset.inspectorCollapsed = String(collapsed.inspector);
    for (const { el, name } of handles)
      el.setAttribute(
        "aria-valuenow",
        String(Math.round(name === "inventory" ? inventory : inspector)),
      );
  }
  for (const [name, id, sign, max] of [
    ["inventory", "library-panel", 1, 460],
    ["inspector", "inspector-panel", -1, 500],
  ]) {
    const target = document.getElementById(id),
      el = document.createElement("div");
    el.className = "side-splitter " + name + "-splitter";
    el.tabIndex = 0;
    el.role = "separator";
    el.setAttribute("aria-label", "Resize " + name + " panel");
    el.setAttribute("aria-orientation", "vertical");
    el.setAttribute("aria-controls", id);
    el.setAttribute("aria-valuemin", "220");
    el.setAttribute("aria-valuemax", String(max));
    el.title = "Drag or use Left/Right arrows to resize";
    target.append(el);
    handles.push({ el, name });
    let drag;
    const change = (value) => {
      current[name] = Math.max(220, Math.min(max, value));
      applyWidths();
    };
    el.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      drag = {
        id: e.pointerId,
        x: e.clientX,
        width: Number(el.getAttribute("aria-valuenow")),
      };
      el.setPointerCapture(e.pointerId);
    };
    el.onpointermove = (e) => {
      if (drag?.id === e.pointerId)
        change(drag.width + sign * (e.clientX - drag.x));
    };
    const end = (e) => {
      if (drag?.id === e.pointerId) {
        drag = null;
        persist();
      }
    };
    el.onpointerup = end;
    el.onpointercancel = end;
    el.onlostpointercapture = end;
    el.onkeydown = (e) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      change(
        e.key === "Home"
          ? 220
          : e.key === "End"
            ? max
            : Number(el.getAttribute("aria-valuenow")) +
              (e.key === "ArrowRight" ? 1 : -1) * sign * (e.shiftKey ? 50 : 10),
      );
      persist();
    };
  }
  root.addEventListener("set-panel-open", (e) => {
    const { name, open } = e.detail || {};
    if (!["inventory", "inspector"].includes(name) || typeof open !== "boolean")
      return;
    collapsed[name] = !open;
    applyWidths();
    persist();
  });
  panel.addEventListener("results-height-changed", (e) => {
    current.results = e.detail;
    persist();
  });
  const observer = new ResizeObserver(applyWidths);
  observer.observe(root);
  window.addEventListener("pagehide", () => observer.disconnect(), {
    once: true,
  });
  delete root.dataset.focus;
  applyWidths();
  panel.dispatchEvent(
    new panel.ownerDocument.defaultView.CustomEvent("set-results-height", {
      detail: current.results,
    }),
  );
}
