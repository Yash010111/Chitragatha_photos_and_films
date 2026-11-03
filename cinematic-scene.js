const story = document.querySelector("[data-cinematic-story]");
const canvas = document.querySelector("[data-cinematic-canvas]");
const chapters = [...document.querySelectorAll("[data-journey-chapter]")];
const progressFill = document.querySelector("[data-journey-progress]");
const counter = document.querySelector("[data-journey-count]");

if (story && canvas && chapters.length) {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
        story.classList.add("is-static");
    } else {
        import("https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js").then((THREE) => {
        let renderer;
        try {
            renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
        } catch (error) {
            story.classList.add("is-static");
            console.error("The cinematic scene could not start WebGL; the photo story remains available.", error);
        }

        if (renderer) {
            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
            const clock = new THREE.Clock();
            const textures = new THREE.TextureLoader();
            const lens = new THREE.Group();
            const cards = new THREE.Group();
            const dustMaterial = new THREE.PointsMaterial({
                color: 0xd5b66e,
                size: 0.045,
                transparent: true,
                opacity: 0.72,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
            let targetProgress = 0;
            let sceneProgress = 0;
            let visible = false;
            let frame = 0;
            let currentChapter = -1;

            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 760 ? 1.35 : 1.75));
            renderer.setSize(window.innerWidth, window.innerHeight, false);
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.15;
            renderer.setClearColor(0x080807, 0);

            const atmosphere = new THREE.Mesh(
                new THREE.SphereGeometry(70, 40, 28),
                new THREE.ShaderMaterial({
                    side: THREE.BackSide,
                    depthWrite: false,
                    uniforms: { uTime: { value: 0 } },
                    vertexShader: `
                        varying vec3 vPosition;
                        void main() {
                            vPosition = position;
                            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                        }
                    `,
                    fragmentShader: `
                        varying vec3 vPosition;
                        uniform float uTime;
                        void main() {
                            vec3 p = normalize(vPosition);
                            float clouds = sin(p.x * 8.0 + uTime * 0.035) * cos(p.y * 7.0 - p.z * 5.0);
                            clouds += sin(p.z * 11.0 + p.y * 4.0 + uTime * 0.025) * 0.45;
                            float glow = 1.0 - smoothstep(0.1, 0.82, length(p.xy - vec2(0.34, -0.12)));
                            vec3 night = vec3(0.018, 0.016, 0.014);
                            vec3 amber = vec3(0.25, 0.13, 0.045) * max(clouds, 0.0) * 0.28;
                            vec3 haze = vec3(0.34, 0.20, 0.075) * glow * 0.32;
                            gl_FragColor = vec4(night + amber + haze, 1.0);
                        }
                    `,
                }),
            );
            scene.add(atmosphere);

            scene.add(new THREE.AmbientLight(0xffdfad, 1.4));
            const keyLight = new THREE.PointLight(0xffc66f, 90, 32);
            keyLight.position.set(1, 4, 7);
            scene.add(keyLight);
            const rimLight = new THREE.PointLight(0x9b5430, 70, 28);
            rimLight.position.set(-5, -2, -3);
            scene.add(rimLight);

            const metal = new THREE.MeshStandardMaterial({ color: 0x8c7049, metalness: 0.88, roughness: 0.24 });
            const darkMetal = new THREE.MeshStandardMaterial({ color: 0x191816, metalness: 0.94, roughness: 0.3 });
            const glass = new THREE.MeshPhysicalMaterial({
                color: 0x332619,
                emissive: 0x5b3512,
                emissiveIntensity: 0.75,
                metalness: 0.72,
                roughness: 0.11,
                clearcoat: 1,
                clearcoatRoughness: 0.08,
            });

            const addRing = (radius, tube, z, material, segments = 144) => {
                const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 12, segments), material);
                ring.position.z = z;
                lens.add(ring);
                return ring;
            };

            addRing(2.52, 0.17, 0, darkMetal);
            addRing(2.32, 0.055, 0.16, metal);
            addRing(2.08, 0.12, 0.1, darkMetal);
            addRing(1.92, 0.035, 0.24, metal);
            addRing(1.55, 0.08, 0.3, metal);
            addRing(1.35, 0.035, 0.38, glass);
            const lensGlass = new THREE.Mesh(new THREE.CircleGeometry(1.32, 96), glass);
            lensGlass.position.z = 0.31;
            lens.add(lensGlass);

            const aperture = new THREE.Group();
            aperture.position.z = 0.43;
            lens.add(aperture);
            const bladeMaterial = new THREE.MeshStandardMaterial({
                color: 0x28251f,
                metalness: 0.8,
                roughness: 0.34,
                side: THREE.DoubleSide,
            });
            const bladeCount = 9;
            for (let index = 0; index < bladeCount; index += 1) {
                const start = (index / bladeCount) * Math.PI * 2;
                const end = start + (Math.PI * 2 / bladeCount) * 1.3;
                const shape = new THREE.Shape();
                shape.absarc(0, 0, 0.62, start, end, false);
                shape.lineTo(Math.cos(end) * 2.08, Math.sin(end) * 2.08);
                shape.absarc(0, 0, 2.08, end, start, true);
                shape.lineTo(Math.cos(start) * 0.62, Math.sin(start) * 0.62);
                const blade = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), bladeMaterial);
                blade.position.z = index * 0.001;
                aperture.add(blade);
            }

            const tickMaterial = new THREE.MeshBasicMaterial({ color: 0xd0ad67 });
            for (let index = 0; index < 60; index += 1) {
                const angle = (index / 60) * Math.PI * 2;
                const major = index % 5 === 0;
                const tick = new THREE.Mesh(
                    new THREE.BoxGeometry(major ? 0.045 : 0.022, major ? 0.18 : 0.09, 0.025),
                    tickMaterial,
                );
                tick.position.set(Math.sin(angle) * 2.83, Math.cos(angle) * 2.83, 0.07);
                tick.rotation.z = -angle;
                lens.add(tick);
            }
            scene.add(lens);

            const photos = [
                ["assets/images/p5.jpg", 1.55, 0.1, -14, -0.04],
                ["assets/images/p7.jpg", -1.7, 1.5, -17, -0.16],
                ["assets/images/p4.jpg", 4.1, -0.8, -19, 0.14],
                ["assets/images/p9.jpg", -2.2, -1.8, -21, 0.11],
                ["assets/images/p3.jpg", 2.8, 1.8, -24, -0.13],
                ["assets/images/p8.jpg", 0.3, -2.5, -27, 0.08],
                ["assets/images/s1.jpg", 4.6, 1.2, -29, -0.19],
                ["assets/images/p1.jpg", -1.6, 1.4, -32, 0.12],
            ];
            const cardWidth = 3.8;
            const cardHeight = 2.55;
            const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x171512, metalness: 0.72, roughness: 0.32 });
            const photoGeometry = new THREE.PlaneGeometry(cardWidth - 0.16, cardHeight - 0.16);

            photos.forEach(([src, x, y, z, rotation], index) => {
                const card = new THREE.Group();
                const backing = new THREE.Mesh(new THREE.BoxGeometry(cardWidth, cardHeight, 0.12), frameMaterial);
                card.add(backing);
                const photo = new THREE.Mesh(
                    photoGeometry,
                    new THREE.MeshBasicMaterial({ color: 0x2a2119, side: THREE.DoubleSide }),
                );
                photo.position.z = 0.066;
                card.add(photo);
                const outline = new THREE.LineSegments(
                    new THREE.EdgesGeometry(new THREE.BoxGeometry(cardWidth, cardHeight, 0.12)),
                    new THREE.LineBasicMaterial({ color: 0xb38a4a, transparent: true, opacity: 0.8 }),
                );
                card.add(outline);
                card.position.set(x, y, z);
                card.rotation.set(index % 2 ? 0.035 : -0.025, rotation, rotation * 0.55);
                card.userData.floatOffset = index * 0.8;
                card.userData.baseY = y;
                card.userData.baseRotationY = rotation;
                cards.add(card);

                textures.load(
                    src,
                    (texture) => {
                        texture.colorSpace = THREE.SRGBColorSpace;
                        photo.material.map = texture;
                        photo.material.color.set(0xffffff);
                        photo.material.needsUpdate = true;
                    },
                    undefined,
                    (error) => console.error(`Could not load cinematic photo: ${src}`, error),
                );
            });
            scene.add(cards);

            const dustPositions = new Float32Array(1700 * 3);
            for (let index = 0; index < dustPositions.length; index += 3) {
                dustPositions[index] = (Math.random() - 0.5) * 24;
                dustPositions[index + 1] = (Math.random() - 0.5) * 15;
                dustPositions[index + 2] = 8 - Math.random() * 48;
            }
            const dustGeometry = new THREE.BufferGeometry();
            dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
            const dust = new THREE.Points(dustGeometry, dustMaterial);
            scene.add(dust);

            const keyframes = [
                { at: 0, x: 1.7, y: 0, z: 17, tx: 1.7, ty: 0, tz: 0 },
                { at: 0.18, x: 1.7, y: 0, z: 10, tx: 1.7, ty: 0, tz: 0 },
                { at: 0.34, x: 1.7, y: 0, z: 2, tx: 1.7, ty: 0, tz: -6 },
                { at: 0.52, x: 1.2, y: 0.3, z: -7, tx: 1.7, ty: 0, tz: -17 },
                { at: 0.72, x: 0.1, y: -0.2, z: -11, tx: 1.5, ty: 0, tz: -20 },
                { at: 0.9, x: 2.3, y: 0.2, z: -16, tx: 1.5, ty: 0, tz: -26 },
                { at: 1, x: 1.5, y: 0, z: -19, tx: 1.5, ty: 0, tz: -28 },
            ];

            const smooth = (value) => value * value * (3 - 2 * value);
            const samplePath = (progress) => {
                let nextIndex = keyframes.findIndex((keyframe) => keyframe.at >= progress);
                if (nextIndex < 1) nextIndex = 1;
                const from = keyframes[nextIndex - 1];
                const to = keyframes[nextIndex];
                const amount = smooth(THREE.MathUtils.clamp((progress - from.at) / (to.at - from.at), 0, 1));
                const value = {};
                Object.keys(from).forEach((key) => {
                    if (key !== "at") value[key] = THREE.MathUtils.lerp(from[key], to[key], amount);
                });
                return value;
            };

            const updateScroll = () => {
                const distance = story.offsetHeight - window.innerHeight;
                targetProgress = distance > 0
                    ? THREE.MathUtils.clamp(-story.getBoundingClientRect().top / distance, 0, 1)
                    : 0;
                const chapterIndex = Math.min(chapters.length - 1, Math.floor(targetProgress * chapters.length));
                if (chapterIndex !== currentChapter) {
                    chapters.forEach((chapter, index) => {
                        const active = index === chapterIndex;
                        chapter.classList.toggle("is-active", active);
                        if (active) chapter.setAttribute("aria-current", "step");
                        else chapter.removeAttribute("aria-current");
                    });
                    currentChapter = chapterIndex;
                    if (counter) counter.textContent = String(chapterIndex + 1).padStart(2, "0");
                }
                if (progressFill) progressFill.style.height = `${targetProgress * 100}%`;
            };

            const resize = () => {
                const width = window.innerWidth;
                const height = window.innerHeight;
                camera.aspect = width / height;
                camera.fov = width < 760 ? 48 : 42;
                camera.updateProjectionMatrix();
                renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 760 ? 1.35 : 1.75));
                renderer.setSize(width, height, false);
            };

            const render = () => {
                if (!visible) {
                    frame = 0;
                    return;
                }
                frame = window.requestAnimationFrame(render);
                const elapsed = clock.getElapsedTime();
                sceneProgress += (targetProgress - sceneProgress) * 0.075;
                const path = samplePath(sceneProgress);
                camera.position.set(path.x, path.y, path.z);
                camera.lookAt(path.tx, path.ty, path.tz);
                lens.rotation.z = sceneProgress * 0.28 + Math.sin(elapsed * 0.12) * 0.025;
                lens.rotation.y = Math.sin(elapsed * 0.16) * 0.035;
                aperture.rotation.z = -sceneProgress * 0.72;
                aperture.scale.setScalar(THREE.MathUtils.lerp(0.24, 1, smooth(THREE.MathUtils.clamp(sceneProgress / 0.36, 0, 1))));
                cards.children.forEach((card) => {
                    card.position.y = card.userData.baseY + Math.sin(elapsed * 0.55 + card.userData.floatOffset) * 0.035;
                    card.rotation.y = card.userData.baseRotationY + Math.sin(elapsed * 0.17 + card.userData.floatOffset) * 0.035;
                });
                dust.rotation.z = elapsed * 0.006;
                atmosphere.material.uniforms.uTime.value = elapsed;
                renderer.render(scene, camera);
            };

            const visibilityObserver = new IntersectionObserver(([entry]) => {
                visible = entry.isIntersecting;
                if (visible && !frame) render();
            }, { rootMargin: "100px 0px" });
            visibilityObserver.observe(story);
            window.addEventListener("scroll", updateScroll, { passive: true });
            window.addEventListener("resize", resize, { passive: true });
            updateScroll();
            resize();
            document.documentElement.classList.add("webgl-ready");
        }
        }).catch((error) => {
            story.classList.add("is-static");
            console.error("The Three.js scene could not load; the photo story remains available.", error);
        });
    }
}
