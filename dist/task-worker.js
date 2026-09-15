// Shared lifecycle for finite analysis jobs. Cancellation rejects the caller's
// existing result promise, so its normal finally block clears busy state.
export class TaskWorker {
  constructor(url, options) {
    this.worker = new Worker(url, options);
    this.label = String(url)
      .split("/")
      .pop()
      .replace("-worker.js", "")
      .replaceAll("-", " ");
    this.started = Date.now();
    this.panel = document.createElement("aside");
    this.panel.className = "task-progress";
    this.panel.setAttribute("role", "status");
    this.text = document.createElement("span");
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel analysis";
    cancel.onclick = () => this.cancel();
    this.panel.append(this.text, cancel);
    document.body.append(this.panel);
    this.update();
    this.timer = setInterval(() => this.update(), 1000);
    this.deadline = setTimeout(
      () =>
        this.cancel(
          "Analysis timed out after 120 seconds. Inputs are retained; reduce the workload and retry.",
        ),
      120000,
    );
    this.worker.onmessage = (e) => {
      if (e.data?.progress) {
        this.progress = e.data.progress;
        this.update();
        return;
      }
      this.terminate();
      this.onmessage?.(e);
    };
    this.worker.onerror = (e) => {
      this.terminate();
      this.onerror?.(e);
    };
  }
  update() {
    this.text.textContent = `${this.label} · ${Math.floor((Date.now() - this.started) / 1000)} s${this.progress ? " · " + this.progress : ""}`;
  }
  postMessage(data) {
    this.worker.postMessage(data);
  }
  cancel(message = "Analysis cancelled. Inputs retained; run again to retry.") {
    this.onmessage?.({ data: { error: message } });
    this.terminate();
  }
  terminate() {
    this.worker.terminate();
    clearInterval(this.timer);
    clearTimeout(this.deadline);
    this.panel.remove();
  }
}
