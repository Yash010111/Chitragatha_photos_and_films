const openMenuButton = document.querySelector("[data-menu-open]");
const closeMenuButton = document.querySelector("[data-menu-close]");
const menu = document.querySelector(".menubar");

const setMenuState = (isOpen) => {
    if (!menu) return;
    menu.classList.toggle("is-open", isOpen);
    document.body.classList.toggle("menu-is-open", isOpen);
    openMenuButton?.setAttribute("aria-expanded", String(isOpen));
};

openMenuButton?.addEventListener("click", () => setMenuState(true));
closeMenuButton?.addEventListener("click", () => setMenuState(false));
menu?.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setMenuState(false));
});

const filterButtons = document.querySelectorAll("[data-filter]");
const galleryItems = document.querySelectorAll("[data-category]");

filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
        const filter = button.dataset.filter;

        filterButtons.forEach((item) => {
            const isActive = item === button;
            item.classList.toggle("active", isActive);
            item.setAttribute("aria-selected", String(isActive));
        });

        galleryItems.forEach((item) => {
            const shouldShow = filter === "all" || item.dataset.category === filter;
            item.hidden = !shouldShow;
            if (shouldShow) item.classList.remove("animate");
            if (shouldShow) requestAnimationFrame(() => item.classList.add("animate"));
        });
    });
});

const lightbox = document.querySelector("[data-lightbox]");
const lightboxImage = lightbox?.querySelector("img");
const lightboxCaption = lightbox?.querySelector("[data-lightbox-caption]");

const closeLightbox = () => {
    lightbox?.classList.remove("is-visible");
    lightbox?.setAttribute("aria-hidden", "true");
    document.body.classList.remove("lightbox-is-open");
};

galleryItems.forEach((item) => {
    item.addEventListener("click", () => {
        if (!lightbox || !lightboxImage) return;
        lightboxImage.src = item.currentSrc || item.src;
        lightboxImage.alt = item.alt;
        if (lightboxCaption) lightboxCaption.textContent = item.alt;
        lightbox.classList.add("is-visible");
        lightbox.setAttribute("aria-hidden", "false");
        document.body.classList.add("lightbox-is-open");
    });
});

lightbox?.querySelector("[data-lightbox-close]")?.addEventListener("click", closeLightbox);
lightbox?.addEventListener("click", (event) => {
    if (event.target === lightbox) closeLightbox();
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        setMenuState(false);
        closeLightbox();
    }
});

const contactForm = document.querySelector("[data-contact-form]");
contactForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(contactForm);
    const message = `Hello Chitragatha, my name is ${formData.get("name")}. Email: ${formData.get("email")}. ${formData.get("message")}`;
    const whatsappUrl = `https://wa.me/919970008737?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
    const status = contactForm.querySelector("[data-form-status]");
    if (status) status.textContent = "WhatsApp opened in a new tab with your message ready to send.";
});
