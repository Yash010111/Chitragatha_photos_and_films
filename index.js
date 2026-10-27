(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = document.documentElement;
  const WA = "919970008737";
  const FORM_ENDPOINT = ""; // e.g. Formspree / Cloudflare Worker URL; leads are POSTed here too when set
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Header: solid background after scrolling
  const header = $("[data-header]");
  const onScroll = () => header.classList.toggle("solid", window.scrollY > 40);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  // Mobile menu
  const menu = $("#menu");
  const openBtn = $("[data-menu-open]");
  const setMenu = (open) => {
    menu.classList.toggle("open", open);
    document.body.classList.toggle("lock", open);
    openBtn.setAttribute("aria-expanded", String(open));
  };
  openBtn.addEventListener("click", () => setMenu(true));
  $("[data-menu-close]").addEventListener("click", () => setMenu(false));
  $$("#menu a").forEach((a) => a.addEventListener("click", () => setMenu(false)));

  // Scroll reveal (content stays visible without JS; reduced-motion handled in CSS)
  const targets = $$(".svc li,.split>div,.split>form,.center .wrap>*,.steps li,.about>div:first-child,.team figure");
  targets.forEach((el) => {
    el.classList.add("reveal");
    el.style.setProperty("--i", [...el.parentElement.children].indexOf(el) % 4);
  });
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }), { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    targets.forEach((el) => io.observe(el));
  } else targets.forEach((el) => el.classList.add("in"));

  // Portfolio: real aspect ratios drive the justified layout
  const chips = $$(".chip");
  const imgs = $$(".grid img");
  const gallery = $(".gallery");
  const carousel = $("[data-carousel]");
  imgs.forEach((i) => { i.loading = "eager"; }); // the carousel needs every image
  imgs.forEach((i) => {
    const set = () => {
      if (i.naturalWidth) i.style.setProperty("--r", (i.naturalWidth / i.naturalHeight).toFixed(3));
      i.classList.add("ld");
    };
    i.complete ? set() : (i.addEventListener("load", set, { once: true }), i.addEventListener("error", set, { once: true }));
  });
  chips.forEach((c) => {
    const f = c.dataset.filter;
    if (f !== "all" && !imgs.some((i) => i.dataset.category === f)) c.hidden = true;
  });
  const applyFilter = (f) => {
    gallery.classList.toggle("bricks", f !== "all");
    if (f === "all") requestAnimationFrame(setSpeed);
    chips.forEach((c) => {
      const on = c.dataset.filter === f;
      c.classList.toggle("active", on);
      c.setAttribute("aria-pressed", String(on));
    });
    imgs.forEach((i) => { i.hidden = !(f === "all" || i.dataset.category === f); if (!i.hidden) i.loading = "eager"; });
  };
  chips.forEach((c) => c.addEventListener("click", () => applyFilter(c.dataset.filter)));
  $$("[data-go]").forEach((a) => a.addEventListener("click", () => {
    const f = a.dataset.go;
    applyFilter(chips.some((c) => c.dataset.filter === f && !c.hidden) ? f : "all");
  }));

  const serviceSelect = $("[name='service']");
  $$("[data-service]").forEach((link) => link.addEventListener("click", () => { serviceSelect.value = link.dataset.service; }));

  // Carousel: 4 rows, each starting at a different image and phase (brick offset)
  const ROWS = 4;
  const loaded = (i) => new Promise((r) => {
    if (i.complete) r();
    else { i.addEventListener("load", r, { once: true }); i.addEventListener("error", r, { once: true }); }
  });
  // constant scroll speed (~45px/s) whatever the row height
  const setSpeed = () => $$(".track", carousel).forEach((t) => {
    const w = t.scrollWidth;
    if (w) t.style.setProperty("--dur", `${Math.round(w / 2 / 45)}s`);
  });
  let rt;
  addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(setSpeed, 250); });
  const buildCarousel = () => {
    if (carousel.childElementCount) return;
    for (let r = 0; r < ROWS; r++) {
      const row = document.createElement("div");
      row.className = "row";
      const track = document.createElement("div");
      track.className = "track";
      track.style.setProperty("--delay", `${-(r * 11 + 4)}s`);
      const shift = (r * 4) % imgs.length;
      const order = [...imgs.slice(shift), ...imgs.slice(0, shift)];
      for (let pass = 0; pass < 2; pass++) { // two identical sets = seamless loop
        order.forEach((src) => {
          const c = document.createElement("img");
          c.src = src.currentSrc || src.src;
          c.alt = "";
          c.decoding = "async";
          c.style.setProperty("--r", src.style.getPropertyValue("--r") || "1.5");
          c.addEventListener("click", () => openLb(src, src));
          track.appendChild(c);
        });
      }
      row.appendChild(track);
      carousel.appendChild(row);
    }
    setSpeed();
  };
  Promise.race([Promise.all(imgs.map(loaded)), new Promise((r) => setTimeout(r, 5000))]).then(buildCarousel);

  // Lightbox: keyboard, buttons, swipe, focus return and focus trap
  const lb = $("[data-lightbox]");
  const lbImg = $("img", lb);
  const lbBtns = $$("button", lb);
  let current = 0, opener = null, touchX = null;
  const visible = () => imgs.filter((i) => !i.hidden);
  const show = (i) => {
    const list = visible();
    if (!list.length) return;
    current = (i + list.length) % list.length;
    lbImg.src = list[current].currentSrc || list[current].src;
    lbImg.alt = list[current].alt;
  };
  const closeLb = () => {
    if (!lb.classList.contains("open")) return;
    lb.classList.remove("open");
    lb.setAttribute("aria-hidden", "true");
    document.body.classList.remove("lock");
    opener?.focus();
  };
  const openLb = (img, from) => {
    opener = from;
    show(visible().indexOf(img));
    lb.classList.add("open");
    lb.setAttribute("aria-hidden", "false");
    document.body.classList.add("lock");
    $("[data-lb-close]").focus();
  };
  imgs.forEach((img) => {
    img.tabIndex = 0;
    img.setAttribute("role", "button");
    const open = () => openLb(img, img);
    img.addEventListener("click", open);
    img.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  });
  $("[data-lb-close]").addEventListener("click", closeLb);
  $("[data-lb-prev]").addEventListener("click", () => show(current - 1));
  $("[data-lb-next]").addEventListener("click", () => show(current + 1));
  lb.addEventListener("click", (e) => { if (e.target === lb) closeLb(); });
  lb.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) show(current + (dx < 0 ? 1 : -1));
    touchX = null;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeLb(); setMenu(false); }
    if (!lb.classList.contains("open")) return;
    if (e.key === "ArrowLeft") show(current - 1);
    if (e.key === "ArrowRight") show(current + 1);
    if (e.key === "Tab") {
      const first = lbBtns[0], last = lbBtns[lbBtns.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // Contact form -> WhatsApp (+ optional server copy so leads are never lost)
  const form = $("[data-form]");
  const status = $("[data-status]");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    let ok = true;
    $$("input,select,textarea", form).forEach((f) => {
      const bad = !f.checkValidity();
      f.classList.toggle("invalid", bad);
      f.setAttribute("aria-invalid", String(bad));
      if (bad) ok = false;
    });
    if (!ok) {
      status.textContent = "Please complete the required fields with valid details.";
      $(":invalid", form)?.focus();
      return;
    }
    const d = new FormData(form);
    if (d.get("bot-field")) return;
    const date = d.get("date"), location = d.get("location"), email = d.get("email");
    const text = `Hello Chitragatha, I would like to enquire about: ${serviceSelect.selectedOptions[0].textContent}.\nName: ${d.get("name")}\nPhone: ${d.get("phone")}${email ? `\nEmail: ${email}` : ""}${date ? `\nEvent date: ${date}` : ""}${location ? `\nEvent location: ${location}` : ""}\nDetails: ${d.get("message")}`;
    if (FORM_ENDPOINT) {
      fetch(FORM_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(d)) }).catch(() => {});
    }
    window.open(`https://wa.me/${WA}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    status.textContent = "WhatsApp has opened with your message. Please press send to complete your enquiry.";
  });

  // Loader (camera shutter): once per session, skipped for reduced motion
  const pageLoader = $("#pageLoader");
  if (pageLoader && (root.classList.contains("seen") || reduced)) {
    pageLoader.remove();
    root.classList.add("seen");
  } else if (pageLoader) {
    const ns = "http://www.w3.org/2000/svg";
    const center = 230, radius = 250, pivotRadius = 178, bladeCount = 13;
    const slot = 360 / bladeCount, overlap = slot * 0.72;
    const bladeGroup = $("[data-blade-group]", pageLoader);
    const rad = (d) => (d * Math.PI) / 180;
    const pt = (dist, deg) => [center + dist * Math.cos(rad(deg)), center + dist * Math.sin(rad(deg))];
    const f = (p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`;

    for (let i = 0; i < bladeCount; i++) {
      const a = slot * i - 90;
      const oS = pt(radius, a - overlap), oE = pt(radius, a + overlap);
      const tS = pt(15, a - 8), tE = pt(15, a + 8);
      const cS = pt(radius * 0.55, a - overlap + 5), cE = pt(radius * 0.55, a + overlap - 5);
      const blade = document.createElementNS(ns, "path");
      blade.setAttribute("d", `M ${f(tS)} Q ${f(cS)} ${f(oS)} A ${radius} ${radius} 0 0 1 ${f(oE)} Q ${f(cE)} ${f(tE)} A 15 15 0 0 0 ${f(tS)} Z`);
      blade.setAttribute("class", "blade");
      blade.setAttribute("fill", `hsl(220, 5%, ${16 + (i % 2 ? 0 : 6) + i * 0.6}%)`);
      const pv = pt(pivotRadius, a);
      blade.style.transformOrigin = `${pv[0].toFixed(2)}px ${pv[1].toFixed(2)}px`;
      bladeGroup.appendChild(blade);
    }
    bladeGroup.appendChild(bladeGroup.firstElementChild);

    const blades = $$(".blade", pageLoader);
    const done = () => {
      try { sessionStorage.cg = 1; } catch (e) {}
      root.classList.add("seen");
      pageLoader.remove();
    };
    const reveal = () => {
      pageLoader.classList.add("open");
      blades.forEach((b, i) => {
        b.style.transitionDelay = `${i * 26}ms`;
        b.style.transform = "rotate(-44deg) scale(.86)";
      });
      setTimeout(() => { // close like a capture, then fade out
        blades.forEach((b, i) => {
          b.style.transitionDelay = `${(blades.length - 1 - i) * 18}ms`;
          b.style.transform = "none";
        });
        setTimeout(() => { pageLoader.classList.add("loader-hide"); setTimeout(done, 520); }, 620);
      }, 650);
    };
    const hero = new Promise((r) => { const im = new Image(); im.onload = im.onerror = r; im.src = "assets/images/banner1.jpg"; });
    Promise.race([hero, new Promise((r) => setTimeout(r, 2500))]).then(() => setTimeout(reveal, 200));
    setTimeout(done, 7000); // hard fail-safe so the site can never stay covered
  }
})();