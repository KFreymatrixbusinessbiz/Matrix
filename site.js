(() => {
  "use strict";
  const rooms = [...document.querySelectorAll(".room, .chapter-room")];
  const dots = [...document.querySelectorAll(".progress-dot")];
  const menuButton = document.querySelector(".menu-button");
  const mobileNav = document.querySelector(".mobile-nav");

  rooms.forEach(room => {
    room.hidden = false;
    room.classList.remove("leaving");
    room.setAttribute("aria-hidden", "false");
  });

  const selectRoom = index => {
    dots.forEach((dot, i) => {
      const active = i === index;
      dot.classList.toggle("active", active);
      dot.setAttribute("aria-current", active ? "true" : "false");
    });
  };

  dots.forEach((dot, index) => {
    dot.addEventListener("click", () => rooms[index]?.scrollIntoView({behavior:"smooth", block:"start"}));
  });

  if (rooms.length && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver(entries => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) selectRoom(rooms.indexOf(visible.target));
    }, {threshold:[.25,.5,.75]});
    rooms.forEach(room => observer.observe(room));
  } else if (rooms.length) {
    selectRoom(0);
  }

  addEventListener("keydown", e => {
    if (e.key === "Escape" && mobileNav?.classList.contains("open")) {
      mobileNav.classList.remove("open");
      menuButton?.setAttribute("aria-expanded","false");
      menuButton?.focus();
    }
  });

  menuButton?.addEventListener("click", () => {
    const open = mobileNav?.classList.toggle("open") ?? false;
    menuButton.setAttribute("aria-expanded", String(open));
  });
})();
