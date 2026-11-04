(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = document.documentElement;
  const WA = "919970008737";
  const FORM_ENDPOINT = ""; // e.g. Formspree / Cloudflare Worker URL; leads are POSTed here too when set
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mobileMQ = matchMedia("(max-width:760px)");

  // Header: solid background after scrolling
  const header = $("[data-header]");
  const onScroll = () => header.classList.toggle("solid", window.scrollY > 40);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  // Scroll-spy: mark the nav link of the section in view
  const navLinks = $$("#menu li a");
  const spy = new Map(navLinks.map((a) => [a.getAttribute("href").slice(1), a]));
  if ("IntersectionObserver" in window) {
    const so = new IntersectionObserver((entries) => entries.forEach((e) => {
      const a = spy.get(e.target.id);
      if (!a) return;
      if (e.isIntersecting) {
        navLinks.forEach((l) => l.removeAttribute("aria-current"));
        a.setAttribute("aria-current", "true");
      } else a.removeAttribute("aria-current");
    }), { rootMargin: "-45% 0px -50% 0px" });
    spy.forEach((_, id) => { const s = document.getElementById(id); if (s) so.observe(s); });
  }

  // Mobile menu (focus managed; closed menu is inert so it can't be tabbed into)
  const menu = $("#menu");
  const openBtn = $("[data-menu-open]");
  const closeBtn = $("[data-menu-close]");
  const syncInert = () => { menu.inert = mobileMQ.matches && !menu.classList.contains("open"); };
  const setMenu = (open, restoreFocus = true) => {
    if (open === menu.classList.contains("open")) return;
    menu.classList.toggle("open", open);
    document.body.classList.toggle("lock", open);
    openBtn.setAttribute("aria-expanded", String(open));
    syncInert();
    if (open) closeBtn.focus();
    else if (restoreFocus && mobileMQ.matches) openBtn.focus({ preventScroll: true });
  };
  syncInert();
  mobileMQ.addEventListener("change", () => { if (!mobileMQ.matches) setMenu(false, false); syncInert(); });
  openBtn.addEventListener("click", () => setMenu(true));
  closeBtn.addEventListener("click", () => setMenu(false));
  $$("#menu a").forEach((a) => a.addEventListener("click", () => setMenu(false, false)));

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

  // Portfolio. If every <img> has width/height attributes, aspect ratios are known up front, so images can
  // stay lazy and the carousel builds instantly. Otherwise we fall back to loading everything (the old behaviour).
  const chips = $$(".chip");
  const imgs = $$(".grid img");
  const gallery = $(".gallery");
  const carousel = $("[data-carousel]");
  const knownRatio = (i) => {
    const w = Number(i.getAttribute("width")), h = Number(i.getAttribute("height"));
    return w && h ? w / h : 0;
  };
  const allSized = imgs.every((i) => knownRatio(i) > 0);
  imgs.forEach((i) => {
    i.decoding = "async";
    const known = knownRatio(i);
    if (known) i.style.setProperty("--r", known.toFixed(3));
    if (!allSized) i.loading = "eager";
    const set = () => {
      if (!known && i.naturalWidth) i.style.setProperty("--r", (i.naturalWidth / i.naturalHeight).toFixed(3));
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

  // Carousel: brick-offset rows, built once and cloned (no per-image listeners; one delegated click handler)
  const loaded = (i) => new Promise((r) => {
    if (i.complete && i.naturalWidth) r();
    else { i.addEventListener("load", r, { once: true }); i.addEventListener("error", r, { once: true }); }
  });
  const setSpeed = () => $$(".track", carousel).forEach((t) => {
    const w = t.scrollWidth;
    if (w) t.style.setProperty("--dur", `${Math.round(w / 2 / 45)}s`); // constant ~45px/s
  });
  let rt;
  addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(setSpeed, 250); });

  const buildCarousel = () => {
    if (carousel.childElementCount) return;
    const rows = mobileMQ.matches ? 3 : 4; // fewer rows on phones: far less decoding/memory
    const frag = document.createDocumentFragment();
    for (let r = 0; r < rows; r++) {
      const row = document.createElement("div");
      row.className = "row";
      const track = document.createElement("div");
      track.className = "track";
      track.style.setProperty("--delay", `${-(r * 11 + 4)}s`);
      const shift = (r * 4) % imgs.length;
      const order = [...imgs.keys()].map((_, k) => (k + shift) % imgs.length);
      const set = order.map((idx) => {
        const src = imgs[idx];
        const c = document.createElement("img");
        c.src = src.currentSrc || src.src;
        c.alt = "";
        c.decoding = "async";
        c.dataset.i = idx;
        c.style.setProperty("--r", src.style.getPropertyValue("--r") || "1.5");
        return c;
      });
      set.forEach((n) => track.appendChild(n));
      set.forEach((n) => track.appendChild(n.cloneNode(true))); // second identical set = seamless loop
      row.appendChild(track);
      frag.appendChild(row);
    }
    carousel.appendChild(frag);
    setSpeed();
  };
  carousel.addEventListener("click", (e) => {
    const t = e.target.closest("img[data-i]");
    if (t) openLb(imgs[Number(t.dataset.i)], t);
  });
  (allSized ? Promise.resolve() : Promise.race([Promise.all(imgs.map(loaded)), new Promise((r) => setTimeout(r, 5000))])).then(buildCarousel);
  mobileMQ.addEventListener("change", () => { carousel.replaceChildren(); buildCarousel(); });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => carousel.classList.toggle("is-off", !e.isIntersecting), { rootMargin: "100px" }).observe(carousel);
  }

  // Lightbox: keyboard, buttons, swipe, neighbour preloading, focus return and focus trap
  const lb = $("[data-lightbox]");
  const lbImg = $("img", lb);
  const lbCount = $("[data-lb-count]", lb);
  const lbBtns = $$("button", lb);
  let current = 0, opener = null, touchX = null;
  lb.inert = true;
  const visible = () => imgs.filter((i) => !i.hidden);
  const urlOf = (i) => i.currentSrc || i.src;
  const show = (i) => {
    const list = visible();
    if (!list.length) return;
    current = (i + list.length) % list.length;
    lbImg.src = urlOf(list[current]);
    lbImg.alt = list[current].alt;
    lbCount.textContent = `${current + 1} / ${list.length}`;
    [current + 1, current - 1].forEach((k) => { new Image().src = urlOf(list[(k + list.length) % list.length]); });
  };
  const closeLb = () => {
    if (!lb.classList.contains("open")) return;
    lb.classList.remove("open");
    lb.setAttribute("aria-hidden", "true");
    lb.inert = true;
    document.body.classList.remove("lock");
    if (opener && opener.isConnected && opener.offsetParent !== null) {
      if (!opener.hasAttribute("tabindex")) opener.tabIndex = -1;
      opener.focus({ preventScroll: true });
    }
  };
  const openLb = (img, from) => {
    opener = from;
    show(visible().indexOf(img));
    lb.inert = false;
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
  const trap = (e, scope) => {
    const f = $$("a[href],button", scope).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeLb(); setMenu(false); }
    if (lb.classList.contains("open")) {
      if (e.key === "ArrowLeft") show(current - 1);
      if (e.key === "ArrowRight") show(current + 1);
      if (e.key === "Tab") trap(e, lb);
    } else if (e.key === "Tab" && menu.classList.contains("open")) trap(e, menu);
  });

  // Contact form -> WhatsApp (+ optional server copy so leads are never lost)
  const form = $("[data-form]");
  const status = $("[data-status]");
  const dateField = form.elements.date;
  if (dateField) dateField.min = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const phoneField = form.elements.phone;
  const checkPhone = () => phoneField.setCustomValidity(phoneField.value.replace(/\D/g, "").length >= 10 ? "" : "Enter a phone number with at least 10 digits");
  phoneField.addEventListener("input", checkPhone);
  $$("input,select,textarea", form).forEach((f) => f.addEventListener("input", () => {
    if (f.checkValidity()) { f.classList.remove("invalid"); f.setAttribute("aria-invalid", "false"); }
  }));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    checkPhone();
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
    if (d.get("bot-field")) return; // honeypot tripped: silently drop
    const date = d.get("date");
    const text = `Hello Chitragatha, I would like to enquire about: ${serviceSelect.selectedOptions[0].textContent}.\nName: ${d.get("name")}\nPhone: ${d.get("phone")}${date ? `\nEvent date: ${date}` : ""}\nDetails: ${d.get("message")}`;
    const url = `https://wa.me/${WA}?text=${encodeURIComponent(text)}`;
    if (FORM_ENDPOINT) {
      fetch(FORM_ENDPOINT, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(d)) }).catch(() => {});
    }
    const w = window.open(url, "_blank");
    if (w) w.opener = null;
    // Pop-up blockers can swallow window.open, so always leave a one-tap fallback link.
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "Open WhatsApp";
    status.replaceChildren(document.createTextNode(`${w ? "WhatsApp has opened with your message. Press send to complete your enquiry. " : "Your message is ready. "}`), link);
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
})();(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(pointer:fine)").matches;
  const chapters = $$("[data-journey-chapter]");

  // Counter total derived from the DOM instead of a hard-coded "/ 06"
  const cnt = $("[data-journey-count]");
  if (cnt && cnt.nextElementSibling) cnt.nextElementSibling.textContent = ` / ${String(chapters.length).padStart(2, "0")}`;

  // Split headlines into masked words (text content unchanged for screen readers)
  if (!reduced) $$(".journey-copy h2").forEach((h) => {
    let n = 0;
    const walk = (node) => [...node.childNodes].forEach((c) => {
      if (c.nodeType === 3) {
        const f = document.createDocumentFragment();
        c.textContent.split(/(\s+)/).forEach((t) => {
          if (!t.trim()) { f.append(t); return; }
          const o = document.createElement("span"), i = document.createElement("span");
          o.className = "w"; i.textContent = t; i.style.setProperty("--n", n++);
          o.append(i); f.append(o);
        });
        c.replaceWith(f);
      } else if (c.nodeType === 1) walk(c);
    });
    walk(h);
  });

  // Page progress + per-chapter scroll offset (-1..1) for parallax drift
  const bar = document.createElement("div");
  bar.className = "page-progress"; bar.setAttribute("aria-hidden", "true");
  document.body.append(bar);
  let ticking = false;
  const update = () => {
    ticking = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
    chapters.forEach((ch) => {
      const r = ch.getBoundingClientRect();
      if (r.bottom < -innerHeight || r.top > 2 * innerHeight) return;
      const off = Math.max(-1, Math.min(1, (r.top + r.height / 2 - innerHeight / 2) / innerHeight));
      ch.style.setProperty("--off", off.toFixed(3));
    });
  };
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  addEventListener("resize", update);
  update();

  if (!fine || reduced) return;

  // Lens cursor: rAF loop runs only while the ring is still catching up
  const c = document.createElement("div");
  c.className = "lens-cursor"; c.setAttribute("aria-hidden", "true");
  document.body.append(c);
  let x = 0, y = 0, tx = 0, ty = 0, run = false;
  const loop = () => {
    x += (tx - x) * 0.18; y += (ty - y) * 0.18;
    c.style.transform = `translate3d(${x}px,${y}px,0)`;
    if (Math.abs(tx - x) + Math.abs(ty - y) > 0.3) requestAnimationFrame(loop); else run = false;
  };
  addEventListener("pointermove", (e) => {
    tx = e.clientX; ty = e.clientY;
    c.classList.add("on");
    c.classList.toggle("view", !!e.target.closest(".grid img,.carousel img"));
    c.classList.toggle("link", !!e.target.closest("a,button,.chip"));
    if (!run) { run = true; requestAnimationFrame(loop); }
  }, { passive: true });
  document.documentElement.addEventListener("pointerleave", () => c.classList.remove("on"));

  // Magnetic buttons
  $$(".btn").forEach((b) => {
    b.addEventListener("pointermove", (e) => {
      const r = b.getBoundingClientRect();
      b.style.translate = `${(e.clientX - r.left - r.width / 2) * 0.16}px ${(e.clientY - r.top - r.height / 2) * 0.26}px`;
    });
    b.addEventListener("pointerleave", () => { b.style.translate = ""; });
  });
})();
