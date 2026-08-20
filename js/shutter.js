import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.178.0/build/three.module.js";

const canvas = document.querySelector("[data-shutter-canvas]");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (canvas && !reduceMotion) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-3, 3, 3, -3, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  const shutter = new THREE.Group();
  const blades = 7;

  camera.position.z = 10;
  scene.add(shutter);

  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0, 0);
  bladeShape.lineTo(2.2, 0.22);
  bladeShape.lineTo(2.45, 0.72);
  bladeShape.lineTo(0.72, 0.47);
  bladeShape.lineTo(0, 0);

  const bladeGeometry = new THREE.ShapeGeometry(bladeShape);
  const bladeMaterial = new THREE.MeshBasicMaterial({
    color: 0xf5e9dc,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  for (let index = 0; index < blades; index += 1) {
    const blade = new THREE.Mesh(bladeGeometry, bladeMaterial.clone());
    blade.rotation.z = (Math.PI * 2 * index) / blades;
    blade.position.set(-1.2, -0.35, index * 0.01);
    shutter.add(blade);
  }

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.5, 64),
    new THREE.MeshBasicMaterial({ color: 0xf5e9dc, transparent: true, opacity: 0.35 })
  );
  ring.position.z = 0.1;
  shutter.add(ring);

  const resize = () => {
    const { width, height } = canvas.getBoundingClientRect();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(width, height, false);
    camera.left = -width / height * 3;
    camera.right = width / height * 3;
    camera.top = 3;
    camera.bottom = -3;
    camera.updateProjectionMatrix();
  };

  let pointerX = 0;
  let pointerY = 0;
  window.addEventListener("pointermove", (event) => {
    pointerX = (event.clientX / window.innerWidth - 0.5) * 0.25;
    pointerY = (event.clientY / window.innerHeight - 0.5) * 0.18;
  }, { passive: true });
  window.addEventListener("resize", resize);
  resize();

  const animate = (time) => {
    shutter.rotation.z = time * 0.00008;
    shutter.rotation.x += (pointerY - shutter.rotation.x) * 0.02;
    shutter.rotation.y += (pointerX - shutter.rotation.y) * 0.02;
    shutter.scale.setScalar(1 + Math.sin(time * 0.0006) * 0.035);
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  };

  canvas.classList.add("is-ready");
  requestAnimationFrame(animate);
}

const revealItems = document.querySelectorAll(".reveal, .section-intro, .gallery-grid img, .team-copy, .team-images");
const revealObserver = new IntersectionObserver((entries, observer) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add("is-visible");
    observer.unobserve(entry.target);
  });
}, { threshold: 0.12 });

revealItems.forEach((item) => revealObserver.observe(item));
