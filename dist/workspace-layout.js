export const layoutDefaults = {
  Design: { inventory: 286, inspector: 294, results: 220 },
  Alignment: { inventory: 230, inspector: 320, results: 340 },
  Measurement: { inventory: 220, inspector: 250, results: 440 },
};
export function validLayout(value) {
  return (
    value &&
    Number.isFinite(value.inventory) &&
    value.inventory >= 220 &&
    value.inventory <= 460 &&
    Number.isFinite(value.inspector) &&
    value.inspector >= 220 &&
    value.inspector <= 500 &&
    Number.isFinite(value.results) &&
    value.results >= 130 &&
    value.results <= 2000
  );
}
export function bindWorkspaceLayout({ root, workspace, panel, expand }) {
  const key = "optibench-workspace-layouts";
  let selected = "Design",
    profiles = structuredClone(layoutDefaults),
    current = { ...profiles.Design },
    focus = "normal";
  try {
    const data = JSON.parse(localStorage.getItem(key));
    if (data) {
      for (const name of Object.keys(profiles))
        if (validLayout(data.profiles?.[name]))
          profiles[name] = data.profiles[name];
      if (profiles[data.selected]) selected = data.selected;
      if (validLayout(data.current)) current = data.current;
      else current = { ...profiles[selected] };
    }
  } catch {}
  const toolbar = document.createElement("div");
  toolbar.className = "workspace-layout-tools";
  toolbar.innerHTML =
    '<label>Workspace <select aria-label="Workspace layout">' +
    Object.keys(profiles)
      .map((name) => `<option>${name}</option>`)
      .join("") +
    '</select></label><button data-layout="save">Save layout</button><button data-layout="bench">Maximize bench</button><button data-layout="detector">Maximize detector</button><button data-layout="reset">Reset layout</button><span role="status" class="layout-status"></span>';
  workspace.prepend(toolbar);
  toolbar.querySelector("select").value = selected;
  const status = (message) => {
    toolbar.querySelector('[role="status"]').textContent = message;
  };
  const persist = () => {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ selected, profiles, current }),
      );
    } catch {
      status("Layout could not be saved in this browser.");
    }
  };
  const handles = [];
  function applyWidths() {
    const width = root.clientWidth,
      budget = Math.max(440, width - 67 - 400);
    const inspector = Math.max(220, Math.min(current.inspector, budget - 220));
    const inventory = Math.max(
      220,
      Math.min(
        current.inventory,
        width >= 1280 ? budget - inspector : Math.max(220, width - 62 - 350),
      ),
    );
    root.style.setProperty("--inventory-width", inventory + "px");
    root.style.setProperty("--inspector-width", inspector + "px");
    for (const { el, name } of handles) {
      el.setAttribute(
        "aria-valuenow",
        String(Math.round(name === "inventory" ? inventory : inspector)),
      );
    }
  }
  function applyHeight() {
    panel.dispatchEvent(
      new panel.ownerDocument.defaultView.CustomEvent("set-results-height", { detail: current.results }),
    );
  }
  function setFocus(next) {
    focus = next;
    root.dataset.focus = focus;
    if (focus === "detector") expand();
    toolbar.querySelector('[data-layout="bench"]').textContent =
      focus === "bench" ? "Restore workspace" : "Maximize bench";
    toolbar.querySelector('[data-layout="detector"]').textContent =
      focus === "detector" ? "Restore workspace" : "Maximize detector";
    toolbar
      .querySelector('[data-layout="bench"]')
      .setAttribute("aria-pressed", String(focus === "bench"));
    toolbar
      .querySelector('[data-layout="detector"]')
      .setAttribute("aria-pressed", String(focus === "detector"));
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
  toolbar.onchange = () => {
    selected = toolbar.querySelector("select").value;
    current = { ...profiles[selected] };
    setFocus("normal");
    expand();
    applyWidths();
    applyHeight();
    persist();
    status(selected + " layout loaded.");
  };
  toolbar.onclick = (e) => {
    const action = e.target.closest("[data-layout]")?.dataset.layout;
    if (!action) return;
    if (action === "save") {
      current.results =
        Number(
          panel.style.getPropertyValue("--results-height").replace("px", ""),
        ) || current.results;
      profiles[selected] = { ...current };
      persist();
      status(selected + " layout saved.");
    }
    if (action === "bench" || action === "detector")
      setFocus(focus === action ? "normal" : action);
    if (action === "reset") {
      current = { ...layoutDefaults[selected] };
      profiles[selected] = { ...current };
      setFocus("normal");
      expand();
      applyWidths();
      applyHeight();
      persist();
      status(selected + " layout reset.");
    }
  };
  panel.addEventListener("results-height-changed", (e) => {
    current.results = e.detail;
    persist();
  });
  const observer = new ResizeObserver(applyWidths);
  observer.observe(root);
  window.addEventListener("pagehide", () => observer.disconnect(), {
    once: true,
  });
  applyWidths();
  applyHeight();
  setFocus("normal");
  return { toolbar };
}
