const ids = [
  "imaging-workspace",
  "nonsequential-workspace",
  "optimization-workspace",
  "runbook-workspace",
  "profiler-workspace",
  "power-workspace",
  "instrument-workspace",
  "practice-workspace",
  "guided-workspace",
  "acceptance-workspace",
  "measurement-workspace",
  "simulation-workspace",
  "alignment-study-workspace",
  "project-navigator",
  "validation-center",
];
export function showWorkspace(root) {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && el !== root) el.hidden = true;
  }
  root.hidden = false;
  const app = document.getElementById("app");
  if (app) app.inert = true;
}
export function closeWorkspace(root) {
  root.hidden = true;
  const app = document.getElementById("app");
  if (app) app.inert = false;
}
