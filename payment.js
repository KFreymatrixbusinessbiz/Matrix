(() => {
  "use strict";

  const setupMobileNavigation = () => {
    const header = document.querySelector(".site-header");
    const desktopNav = header?.querySelector(".desktop-nav");
    let menuButton = header?.querySelector(".menu-button");
    let mobileNav = document.querySelector(".mobile-nav");

    // Detail pages retain their compact, horizontally scrollable navigation.
    if (!header || !desktopNav || document.body.classList.contains("solution-page")) return;

    if (!menuButton) {
      menuButton = document.createElement("button");
      menuButton.className = "menu-button";
      menuButton.type = "button";
      menuButton.setAttribute("aria-label", "Open menu");
      menuButton.setAttribute("aria-expanded", "false");
      menuButton.setAttribute("aria-controls", "mobile-nav");
      menuButton.innerHTML = "<span></span><span></span><span></span>";
      header.append(menuButton);
    }

    if (!mobileNav) {
      mobileNav = document.createElement("nav");
      mobileNav.className = "mobile-nav";
      mobileNav.setAttribute("aria-label", "Mobile");
      [...desktopNav.querySelectorAll("a")].forEach(link => mobileNav.append(link.cloneNode(true)));
      header.insertAdjacentElement("afterend", mobileNav);
    }

    mobileNav.id ||= "mobile-nav";
    menuButton.setAttribute("aria-controls", mobileNav.id);

    const setOpen = open => {
      mobileNav.classList.toggle("open", open);
      menuButton.setAttribute("aria-expanded", String(open));
      menuButton.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    };

    menuButton.addEventListener("click", () => setOpen(!mobileNav.classList.contains("open")));
    mobileNav.addEventListener("click", event => {
      if (event.target.closest("a")) setOpen(false);
    });
    addEventListener("keydown", event => {
      if (event.key === "Escape" && mobileNav.classList.contains("open")) {
        setOpen(false);
        menuButton.focus();
      }
    });
  };

  setupMobileNavigation();

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
