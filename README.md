# Chitragatha Photos & Films

A static photography studio portfolio built with semantic HTML, CSS, and browser JavaScript. It is framework-free, deployable on any static host, and uses the existing local photo collection.

## Structure

```text
index.html              Portfolio homepage
contact.html            Contact page with WhatsApp handoff
assets/images/          Logos, banners, gallery, and team photography
css/style.css           Shared visual system and component styles
css/media-queries.css   Mobile layout rules
css/utils.css           Small shared utility classes
js/index.js             Navigation, filters, lightbox, and contact behavior
```

## Run locally

Open `index.html` directly in a browser, or serve the folder with any static server:

```bash
npx serve .
```

The contact form opens a pre-filled WhatsApp message because a static website has no server-side form endpoint. Replace the phone number in `contact.html` and `js/index.js` before publishing if needed.

## Image performance

For production, export the gallery as WebP or AVIF in a few responsive sizes. Keep the current eager load only for the first hero-visible gallery image and lazy-load the rest, as the page already does.