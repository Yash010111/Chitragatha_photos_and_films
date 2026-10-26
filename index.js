(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const WA = "919970008737";

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

  // Portfolio filters (categories with no images are hidden automatically)
  const chips = $$(".chip");
  const imgs = $$(".grid img");
  chips.forEach((c) => {
    const f = c.dataset.filter;
    if (f !== "all" && !imgs.some((i) => i.dataset.category === f)) c.hidden = true;
  });
  const applyFilter = (f) => {
    chips.forEach((c) => {
      const on = c.dataset.filter === f;
      c.classList.toggle("active", on);
      c.setAttribute("aria-pressed", String(on));
    });
    imgs.forEach((i) => (i.hidden = !(f === "all" || i.dataset.category === f)));
  };
  chips.forEach((c) => c.addEventListener("click", () => applyFilter(c.dataset.filter)));
  $$("[data-go]").forEach((a) =>
    a.addEventListener("click", () => {
      const f = a.dataset.go;
      applyFilter(chips.some((c) => c.dataset.filter === f && !c.hidden) ? f : "all");
    })
  );

  const serviceSelect = $("[name='service']");
  $$("[data-service]").forEach((link) => {
    link.addEventListener("click", () => {
      serviceSelect.value = link.dataset.service;
    });
  });

  // Lightbox with keyboard and button navigation
  const lb = $("[data-lightbox]");
  const lbImg = $("img", lb);
  let current = 0;
  const visible = () => imgs.filter((i) => !i.hidden);
  const show = (i) => {
    const list = visible();
    if (!list.length) return;
    current = (i + list.length) % list.length;
    lbImg.src = list[current].currentSrc || list[current].src;
    lbImg.alt = list[current].alt;
  };
  const closeLb = () => {
    lb.classList.remove("open");
    lb.setAttribute("aria-hidden", "true");
    document.body.classList.remove("lock");
  };
  imgs.forEach((img) =>
    img.addEventListener("click", () => {
      show(visible().indexOf(img));
      lb.classList.add("open");
      lb.setAttribute("aria-hidden", "false");
      document.body.classList.add("lock");
    })
  );
  $("[data-lb-close]").addEventListener("click", closeLb);
  $("[data-lb-prev]").addEventListener("click", () => show(current - 1));
  $("[data-lb-next]").addEventListener("click", () => show(current + 1));
  lb.addEventListener("click", (e) => { if (e.target === lb) closeLb(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeLb(); setMenu(false); }
    if (lb.classList.contains("open")) {
      if (e.key === "ArrowLeft") show(current - 1);
      if (e.key === "ArrowRight") show(current + 1);
    }
  });

  // Contact form -> WhatsApp, with basic validation
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
    const date = d.get("date");
    const location = d.get("location");
    const text = `Hello Chitragatha, I would like to enquire about: ${serviceSelect.selectedOptions[0].textContent}.\nName: ${d.get("name")}\nEmail: ${d.get("email")}${date ? `\nEvent date: ${date}` : ""}${location ? `\nEvent location: ${location}` : ""}\nDetails: ${d.get("message")}`;
    window.open(`https://wa.me/${WA}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    status.textContent = "WhatsApp has opened with your message. Please press send to complete your enquiry.";
  });
})();