const form = document.querySelector("#discussion-form");
const status = document.querySelector("#form-status");

if (form) {
  form.elements.startedAt.value = Date.now();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    status.dataset.state = "";
    status.textContent = "Sending…";

    try {
      const payload = Object.fromEntries(new FormData(form).entries());
      const response = await fetch("/api/inquiry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "We could not send your message.");
      }

      form.reset();
      form.elements.startedAt.value = Date.now();
      status.dataset.state = "success";
      status.textContent = "Thank you. Matrix received your message and will follow up.";
    } catch (error) {
      status.dataset.state = "error";
      status.textContent =
        error.message ||
        "We could not send your message. Please email contact@matrixbusiness.biz.";
    } finally {
      button.disabled = false;
    }
  });
}
