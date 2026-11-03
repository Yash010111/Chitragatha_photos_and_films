# Chitragatha Photos & Films

A static photography studio portfolio built with semantic HTML, CSS, and browser JavaScript. It is framework-free, deployable on any static host, and uses the existing local photo collection.

## Structure

```text
index.html         Single-page portfolio, team, and contact form
assets/images/     Logos, banners, gallery, and team photography
style.css          Shared visual system and component styles
media-queries.css  Responsive and reduced-motion styles
index.js           Navigation, filters, lightbox, and contact behavior
cinematic-scene.js Scroll-driven Three.js camera journey
```

## Run locally

Serve the folder with any static server (the Three.js scene loads its renderer as an ES module):

```bash
npx serve .
```

The contact form opens a pre-filled WhatsApp message because a static website has no server-side form endpoint. Replace the phone number in `index.html` and `index.js` before publishing if needed.

The camera journey uses Three.js from jsDelivr and the existing photo collection. If WebGL or the CDN is unavailable, the page content and portfolio remain usable without the 3D scene.

## Image performance

For production, export the gallery as WebP or AVIF in a few responsive sizes. Keep the current eager load only for the first hero-visible gallery image and lazy-load the rest, as the page already does.