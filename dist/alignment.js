export const mountModels = {
  none: { name: "Unspecified mount", base: 0 },
  post: { name: "Post + adjustable holder", base: 0 },
  kinematic: { name: "Kinematic mirror mount + post", base: 0 },
  xyz: { name: "XYZ translation stage + post", base: 15 },
};
export function mechanicalChecks(project) {
  const checks = [];
  for (const c of project.items.filter((c) => c.enabled !== false)) {
    const z = c.z ?? project.table.heightAbove ?? 100,
      model = mountModels[c.mountType || "none"];
    if (z - c.diameter / 2 < 0)
      checks.push({
        id: c.id,
        level: "error",
        text: `${c.label}: optic envelope intersects the table surface.`,
      });
    if (!model || c.mountType === "none" || !c.mountType) continue;
    const extension = z - model.base - (c.postLength ?? 75);
    if (extension < 0 || extension > 50)
      checks.push({
        id: c.id,
        level: "error",
        text: `${c.label}: holder extension ${extension.toFixed(2)} mm exceeds the modeled 0–50 mm range.`,
      });
    if (
      c.mountThread &&
      c.mountThread.replace("1/4-20", "¼″–20") !==
        project.table.thread.replace("1/4-20", "¼″–20")
    )
      checks.push({
        id: c.id,
        level: "warning",
        text: `${c.label}: mount base thread ${c.mountThread} differs from table ${project.table.thread}; an adapter is required.`,
      });
    if (c.mountType === "kinematic" && !["mirror", "splitter"].includes(c.type))
      checks.push({
        id: c.id,
        level: "warning",
        text: `${c.label}: the selected kinematic mount is intended for a mirror or splitter.`,
      });
    if (c.mountType === "kinematic" && (c.diameter < 6 || c.diameter > 50.8))
      checks.push({
        id: c.id,
        level: "error",
        text: `${c.label}: optic diameter is outside this parametric mount’s 6–50.8 mm capacity.`,
      });
    if (c.mountType === "xyz")
      for (const axis of ["x", "y", "z"]) {
        const offset =
          c[axis] - (c["stageOrigin" + axis.toUpperCase()] ?? c[axis]);
        if (Math.abs(offset) > (c.stageTravel ?? 12.5) + 1e-8)
          checks.push({
            id: c.id,
            level: "error",
            text: `${c.label}: ${axis.toUpperCase()} travel ${offset.toFixed(2)} mm exceeds ±${c.stageTravel ?? 12.5} mm.`,
          });
      }
  }
  return checks;
}
export function stageMove(c, axis, delta) {
  if (c.locked) throw Error("Unlock the component before adjusting it.");
  const next = { ...c, [axis]: c[axis] + delta };
  if (
    c.mountType === "xyz" &&
    Math.abs(next[axis] - (c["stageOrigin" + axis.toUpperCase()] ?? c[axis])) >
      (c.stageTravel ?? 12.5) + 1e-8
  )
    throw Error(
      `Stage ${axis.toUpperCase()} adjustment exceeds its travel limit.`,
    );
  return next;
}
export function alignmentTargets(project, result) {
  return project.items
    .filter(
      (c) =>
        c.enabled !== false &&
        ["aperture", "screen", "camera"].includes(c.type),
    )
    .map((c) => {
      const arrivals = result.hits.filter((h) => h.id === c.id),
        h = arrivals[0],
        radius =
          c.type === "camera"
            ? (Math.min(c.pixelsX, c.pixelsY) * c.pixelPitch) / 2000
            : (c.type === "aperture" ? c.aperture : c.diameter) / 2;
      return {
        component: c,
        radius,
        arrivals,
        h,
        dx: h?.offset ?? null,
        dz: h?.verticalOffset ?? null,
        error: h ? Math.hypot(h.offset, h.verticalOffset || 0) : null,
        clearance: h
          ? radius -
            Math.hypot(h.offset, h.verticalOffset || 0) -
            (h.radius || 0)
          : null,
        status: !h
          ? "No arrival"
          : h.missed
            ? "Missed optic"
            : Math.hypot(h.offset, h.verticalOffset || 0) < 0.05
              ? "Centred"
              : Math.hypot(h.offset, h.verticalOffset || 0) > radius
                ? "Blocked"
                : "Adjust",
      };
    });
}
export function pairAlignment(targets) {
  const pair = targets
    .filter((t) => t.component.type === "aperture" && t.h && !t.h.missed)
    .sort((a, b) => a.h.distance - b.h.distance)
    .slice(0, 2);
  if (pair.length !== 2) return null;
  const [a, b] = pair;
  if (
    a.h.source !== b.h.source ||
    a.h.branch !== b.h.branch ||
    Math.abs(a.component.angle - b.component.angle) > 1e-6
  )
    return null;
  const between = b.h.path.slice(a.h.path.length, -1);
  if (between.length || a.arrivals.length > 1 || b.arrivals.length > 1)
    return null;
  const separation = b.h.distance - a.h.distance;
  if (separation <= 0) return null;
  return {
    ids: pair.map((t) => t.component.id),
    separation,
    horizontalMrad: ((b.dx - a.dx) / separation) * 1000,
    verticalMrad: ((b.dz - a.dz) / separation) * 1000,
    centred: pair.every((t) => t.status === "Centred"),
  };
}
