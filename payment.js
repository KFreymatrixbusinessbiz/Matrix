(() => {
  "use strict";
  const trigger = document.querySelector(".payment-utility");
  if (!trigger || typeof HTMLDialogElement === "undefined" || !HTMLDialogElement.prototype.showModal) return;
  trigger.setAttribute("aria-haspopup", "dialog");
  let dialog;
  let pending = false;
  trigger.addEventListener("click", async event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (pending) return;
    try {
      if (!dialog) {
        pending = true;
        const response = await fetch(trigger.href);
        if (!response.ok) throw new Error("Payment instructions unavailable");
        const page = new DOMParser().parseFromString(await response.text(), "text/html");
        const content = page.querySelector(".payment-content");
        if (!content) throw new Error("Payment instructions unavailable");
        content.querySelector("h1").id = "payment-dialog-title";
        content.setAttribute("aria-labelledby", "payment-dialog-title");
        dialog = document.createElement("dialog");
        dialog.className = "payment-dialog";
        dialog.setAttribute("aria-labelledby", "payment-dialog-title");
        const close = document.createElement("button");
        close.type = "button";
        close.className = "payment-close";
        close.textContent = "Close";
        close.addEventListener("click", () => dialog.close());
        dialog.append(close, content);
        dialog.addEventListener("close", () => trigger.focus());
        dialog.addEventListener("keydown", e => { if (e.key === "Escape") e.stopPropagation(); });
        document.body.append(dialog);
      }
      dialog.showModal();
      dialog.querySelector("h1").focus();
    } catch {
      window.location.assign(trigger.href);
    } finally {
      pending = false;
    }
  });
})();
