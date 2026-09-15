export function bindResultsSplitter({ workspace, panel, handle, expand }) {
  const key = "optibench-results-height";
  let preferred = panel.getBoundingClientRect().height || 261;
  try {
    const saved = Number(localStorage.getItem(key));
    if (Number.isFinite(saved) && saved >= 130) preferred = saved;
  } catch {}
  let drag = null;
  function bounds() {
    const reserved = [...workspace.children]
      .filter(
        (el) =>
          ![panel, handle].includes(el) &&
          !el.classList.contains("bench-stage"),
      )
      .reduce((sum, el) => sum + el.getBoundingClientRect().height, 0);
    return {
      min: 130,
      max: Math.max(
        130,
        workspace.clientHeight -
          reserved -
          handle.getBoundingClientRect().height -
          180,
      ),
    };
  }
  function apply(value, persist = false) {
    const { min, max } = bounds();
    const height = Math.round(Math.max(min, Math.min(max, value)));
    panel.style.setProperty("--results-height", height + "px");
    handle.setAttribute("aria-valuemin", String(min));
    handle.setAttribute("aria-valuemax", String(max));
    handle.setAttribute("aria-valuenow", String(height));
    handle.setAttribute(
      "aria-valuetext",
      `Results panel height ${height} pixels`,
    );
    if (persist) {
      panel.dispatchEvent(
        new panel.ownerDocument.defaultView.CustomEvent("results-height-changed", { detail: height }),
      );
      preferred = height;
      try {
        localStorage.setItem(key, String(height));
      } catch {}
    }
    return height;
  }
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    expand();
    drag = { id: e.pointerId, y: e.clientY, height: apply(preferred) };
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("dragging");
    e.preventDefault();
  });
  handle.addEventListener("pointermove", (e) => {
    if (drag?.id === e.pointerId) apply(drag.height + drag.y - e.clientY);
  });
  const finish = (e) => {
    if (drag?.id !== e.pointerId) return;
    apply(Number(handle.getAttribute("aria-valuenow")), true);
    drag = null;
    handle.classList.remove("dragging");
  };
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
  handle.addEventListener("keydown", (e) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    expand();
    const { min, max } = bounds(),
      now = apply(preferred);
    apply(
      e.key === "Home"
        ? min
        : e.key === "End"
          ? max
          : now + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 50 : 10),
      true,
    );
  });
  handle.addEventListener("dblclick", () => {
    expand();
    apply(261, true);
  });
  panel.addEventListener("set-results-height", (e) => {
    if (Number.isFinite(e.detail)) {
      preferred = e.detail;
      apply(preferred);
    }
  });
  const observer = new ResizeObserver(() => {
    if (!drag) apply(preferred);
  });
  observer.observe(workspace);
  apply(preferred);
  window.addEventListener("pagehide", () => observer.disconnect(), {
    once: true,
  });
}
