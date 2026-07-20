(() => {
  "use strict";
  const rooms = [...document.querySelectorAll(".room, .chapter-room")];
  const dots = [...document.querySelectorAll(".progress-dot")];
  const menuButton = document.querySelector(".menu-button");
  const mobileNav = document.querySelector(".mobile-nav");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let current = Math.max(0, rooms.findIndex(r => r.classList.contains("active")));
  let locked = false, touchStartY = 0;

  rooms.forEach((room, i) => {
    const active = i === current;
    room.hidden = !active;
    room.classList.toggle("active", active);
    room.setAttribute("aria-hidden", String(!active));
  });

  dots.forEach((dot, i) => dot.setAttribute("aria-current", i === current ? "true" : "false"));

  function finish(outgoing, incoming, next) {
    outgoing.hidden = true;
    outgoing.classList.remove("leaving");
    outgoing.setAttribute("aria-hidden", "true");
    incoming.hidden = false;
    incoming.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => {
      incoming.classList.add("active");
      dots[next]?.classList.add("active");
      dots[next]?.setAttribute("aria-current", "true");
      current = next;
      locked = false;
    });
  }

  function goTo(next) {
    next = Math.max(0, Math.min(rooms.length - 1, next));
    if (next === current || locked) return;
    locked = true;
    const outgoing = rooms[current], incoming = rooms[next];
    outgoing.classList.remove("active");
    outgoing.classList.add("leaving");
    dots[current]?.classList.remove("active");
    dots[current]?.setAttribute("aria-current", "false");
    reducedMotion ? finish(outgoing, incoming, next) : setTimeout(() => finish(outgoing, incoming, next), 260);
  }

  const advance = d => d > 0 ? current < rooms.length - 1 && goTo(current + 1) : current > 0 && goTo(current - 1);

  addEventListener("wheel", e => {
    if (Math.abs(e.deltaY) < 12) return;
    e.preventDefault();
    advance(e.deltaY > 0 ? 1 : -1);
  }, {passive:false});

  addEventListener("keydown", e => {
    if (["ArrowDown","PageDown"," "].includes(e.key)) { e.preventDefault(); advance(1); }
    else if (["ArrowUp","PageUp"].includes(e.key)) { e.preventDefault(); advance(-1); }
    else if (e.key === "Home") { e.preventDefault(); goTo(0); }
    else if (e.key === "End") { e.preventDefault(); goTo(rooms.length - 1); }
    else if (e.key === "Escape" && mobileNav?.classList.contains("open")) {
      mobileNav.classList.remove("open");
      menuButton?.setAttribute("aria-expanded","false");
      menuButton?.focus();
    }
  });

  addEventListener("touchstart", e => touchStartY = e.changedTouches[0].clientY, {passive:true});
  addEventListener("touchend", e => {
    const delta = touchStartY - e.changedTouches[0].clientY;
    if (Math.abs(delta) > 45) advance(delta > 0 ? 1 : -1);
  }, {passive:true});

  dots.forEach(dot => dot.addEventListener("click", () => goTo(Number(dot.dataset.target))));
  menuButton?.addEventListener("click", () => {
    const open = mobileNav?.classList.toggle("open") ?? false;
    menuButton.setAttribute("aria-expanded", String(open));
  });
})();