(() => {
  "use strict";

  const setupMobileNavigation = () => {
    const header = document.querySelector(".site-header");
    const desktopNav = header?.querySelector(".desktop-nav");
    let menuButton = header?.querySelector(".menu-button");
    let mobileNav = document.querySelector(".mobile-nav");

    if (!header || !desktopNav) return;

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
})();
