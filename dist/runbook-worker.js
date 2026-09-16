import { importRunbookData } from "./runbook-review.js";
import { preflightRunbook, executeRunbook } from "./runbook.js";
self.onmessage = async ({ data: d }) => {
  try {
    const result =
      d.mode === "import"
        ? importRunbookData(d.text)
        : d.mode === "preflight"
          ? preflightRunbook(d.recipe)
          : await executeRunbook(d.recipe, {
              onEvent: (event) => self.postMessage({ event }),
            });
    self.postMessage({ result });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
