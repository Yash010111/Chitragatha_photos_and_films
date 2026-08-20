const pageLoader = document.getElementById("pageLoader");

if (pageLoader) {
    const namespace = "http://www.w3.org/2000/svg";
    const center = 230;
    const radius = 190;
    const bladeCount = 15;
    const slot = 360 / bladeCount;
    const overlap = slot * 1.02;
    const bladeGroup = pageLoader.querySelector("[data-blade-group]");

    const toRadians = (degrees) => degrees * Math.PI / 180;
    const point = (distance, degrees) => [
        center + distance * Math.cos(toRadians(degrees)),
        center + distance * Math.sin(toRadians(degrees)),
    ];

    for (let index = 0; index < bladeCount; index += 1) {
        const angle = slot * index - 90;
        const startAngle = angle - overlap;
        const endAngle = angle + overlap;
        const outerStart = point(radius, startAngle);
        const outerEnd = point(radius, endAngle);
        const tipStart = point(15, angle - 8);
        const tipEnd = point(15, angle + 8);
        const curveStart = point(radius * .55, startAngle + 5);
        const curveEnd = point(radius * .55, endAngle - 5);
        const pathData = [
            `M ${tipStart[0].toFixed(2)} ${tipStart[1].toFixed(2)}`,
            `Q ${curveStart[0].toFixed(2)} ${curveStart[1].toFixed(2)} ${outerStart[0].toFixed(2)} ${outerStart[1].toFixed(2)}`,
            `A ${radius} ${radius} 0 0 1 ${outerEnd[0].toFixed(2)} ${outerEnd[1].toFixed(2)}`,
            `Q ${curveEnd[0].toFixed(2)} ${curveEnd[1].toFixed(2)} ${tipEnd[0].toFixed(2)} ${tipEnd[1].toFixed(2)}`,
            `A 15 15 0 0 0 ${tipStart[0].toFixed(2)} ${tipStart[1].toFixed(2)} Z`,
        ].join(" ");
        const blade = document.createElementNS(namespace, "path");
        blade.setAttribute("d", pathData);
        blade.setAttribute("class", "blade");
        blade.setAttribute("fill", `hsl(220, 5%, ${16 + (index % 2 ? 0 : 6) + index * .6}%)`);
        const pivot = point(radius, angle);
        blade.style.transformOrigin = `${pivot[0].toFixed(2)}px ${pivot[1].toFixed(2)}px`;
        blade.dataset.openDelay = `${index * 26}ms`;
        blade.dataset.openTransform = "rotate(-44deg) scale(.86)";
        bladeGroup?.appendChild(blade);
    }

    const blades = pageLoader.querySelectorAll(".blade");
    const reveal = () => {
        document.documentElement.classList.remove("is-loading");
        document.body.classList.remove("is-loading");
        pageLoader.classList.add("open");
        blades.forEach((blade) => {
            blade.style.transitionDelay = blade.dataset.openDelay;
            blade.style.transform = blade.dataset.openTransform;
        });

        // Hold the open aperture briefly, then close it like a camera capture.
        window.setTimeout(() => {
            blades.forEach((blade, index) => {
                blade.style.transitionDelay = `${(blades.length - 1 - index) * 18}ms`;
                blade.style.transform = "none";
            });

            window.setTimeout(() => {
                pageLoader.classList.add("loader-hide");
                pageLoader.addEventListener("transitionend", () => pageLoader.remove(), { once: true });
                window.setTimeout(() => pageLoader.remove(), 800);
            }, 720);
        }, 750);
    };

    const loadStart = Date.now();
    const revealWhenReady = () => window.setTimeout(reveal, Math.max(0, 500 - (Date.now() - loadStart)));
    window.addEventListener("load", revealWhenReady, { once: true });
    window.setTimeout(reveal, 6000);
}

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
