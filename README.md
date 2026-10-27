# Chitragatha Photos & Films

A static photography studio portfolio built with semantic HTML, CSS, and browser JavaScript. It is framework-free, deployable on any static host, and uses the existing local photo collection.

## Structure

```text
index.html              Single-page portfolio, team, and contact form
assets/images/          Logos, banners, gallery, and team photography
style.css               Shared visual system and responsive component styles
index.js                Navigation, filters, lightbox, and contact behavior
```

## Run locally

Open `index.html` directly in a browser, or serve the folder with any static server:

```bash
npx serve .
```

The contact form opens a pre-filled WhatsApp message because a static website has no server-side form endpoint. Replace the phone number in `index.html` and `index.js` before publishing if needed.

## Image performance

For production, export the gallery as WebP or AVIF in a few responsive sizes. Keep the current eager load only for the first hero-visible gallery image and lazy-load the rest, as the page already does.