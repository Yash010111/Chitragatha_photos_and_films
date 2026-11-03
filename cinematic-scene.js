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
        // Production: self-host three.js (or use an import map with `integrity`) instead of a runtime CDN import.
        import("https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js").then((THREE) => {
        let renderer;
        try {
            renderer = new THREE.WebGLRenderer({
                canvas,
                antialias: false, // MSAA is done on the HDR render target instead
                alpha: false,
                powerPreference: "high-performance",
            });
        } catch (error) {
            story.classList.add("is-static");
            console.error("The cinematic scene could not start WebGL; the photo story remains available.", error);
        }

        if (renderer) {
            const { clamp, lerp } = THREE.MathUtils;
            const smooth = (v) => v * v * (3 - 2 * v);
            const bump = (x, center, width) => Math.exp(-(((x - center) / width) ** 2));
            const easeOutBack = (v) => {
                const c1 = 1.0;
                const c3 = c1 + 1;
                return 1 + c3 * Math.pow(v - 1, 3) + c1 * Math.pow(v - 1, 2);
            };

            canvas.setAttribute("aria-hidden", "true");

            const scene = new THREE.Scene();
            scene.fog = new THREE.FogExp2(0x080807, 0.026);
            const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
            scene.add(camera); // flare sprites are children of the camera
            const textures = new THREE.TextureLoader();
            const lens = new THREE.Group();
            const cards = new THREE.Group();

            let targetProgress = 0;
            let sceneProgress = 0;
            let prevProgress = 0;
            let velocity = 0;
            let visible = false;
            let frame = 0;
            let last = 0;
            let elapsed = 0;
            let currentChapter = -1;
            let storyTop = 0;
            let scrollRange = 1;
            let quality = 1;
            let perfFrames = 0;
            let perfAccum = 0;
            let perfWarm = true;
            const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
            const bufferSize = new THREE.Vector2();

            // Tone mapping + colour space happen in the final composite pass (render targets are linear/HDR).
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.toneMapping = THREE.NeutralToneMapping;
            renderer.toneMappingExposure = 1.0;
            renderer.setClearColor(0x080807, 1);

            canvas.addEventListener("webglcontextlost", (event) => {
                event.preventDefault();
                visible = false;
                story.classList.add("is-static");
                story.classList.remove("webgl-ready");
            });

            /* ---------- Procedural studio environment (real metal reflections) ---------- */
            const buildEnvironment = () => {
                const env = new THREE.Scene();
                env.add(new THREE.Mesh(
                    new THREE.BoxGeometry(30, 30, 30),
                    new THREE.MeshBasicMaterial({ color: 0x0a0907, side: THREE.BackSide }),
                ));
                const panel = (w, h, color, intensity, pos) => {
                    const mesh = new THREE.Mesh(
                        new THREE.PlaneGeometry(w, h),
                        new THREE.MeshBasicMaterial({
                            color: new THREE.Color(color).multiplyScalar(intensity),
                            side: THREE.DoubleSide,
                        }),
                    );
                    mesh.position.set(...pos);
                    mesh.lookAt(0, 0, 0);
                    env.add(mesh);
                };
                panel(10, 6, 0xffd9a0, 9, [6, 9, 10]);   // warm key softbox
                panel(2, 14, 0x9fb8ff, 3.5, [-12, 0, 4]); // cool strip light
                panel(14, 1.2, 0xffb36b, 5, [0, -9, 6]);  // warm floor bounce
                panel(6, 6, 0xffffff, 2, [0, 4, -12]);    // back kicker
                const pmrem = new THREE.PMREMGenerator(renderer);
                const target = pmrem.fromScene(env, 0.02);
                pmrem.dispose();
                env.traverse((o) => {
                    if (o.geometry) o.geometry.dispose();
                    if (o.material) o.material.dispose();
                });
                return target.texture;
            };
            scene.environment = buildEnvironment();
            scene.environmentIntensity = 0.85;

            /* ---------- Atmosphere ---------- */
            const atmosphere = new THREE.Mesh(
                new THREE.SphereGeometry(70, 40, 28),
                new THREE.ShaderMaterial({
                    side: THREE.BackSide,
                    depthWrite: false,
                    fog: false,
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

            /* ---------- Lights ---------- */
            scene.add(new THREE.AmbientLight(0xffdfad, 0.5));
            const keyLight = new THREE.PointLight(0xffc66f, 90, 32);
            keyLight.position.set(1, 4, 7);
            scene.add(keyLight);
            const rimLight = new THREE.PointLight(0x9b5430, 70, 28);
            rimLight.position.set(-5, -2, -3);
            scene.add(rimLight);
            const camLight = new THREE.PointLight(0xffe2b0, 40, 18);
            scene.add(camLight);

            /* ---------- Lens barrel ---------- */
            const metal = new THREE.MeshStandardMaterial({ color: 0x9a7b4d, metalness: 1, roughness: 0.2 });
            const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1b1a17, metalness: 1, roughness: 0.28 });
            const glowRingMaterial = new THREE.MeshPhysicalMaterial({
                color: 0x332619,
                emissive: 0x7a4515,
                emissiveIntensity: 1.1, // >1 after tone mapping headroom -> picked up by bloom
                metalness: 0.72,
                roughness: 0.11,
                clearcoat: 1,
                clearcoatRoughness: 0.08,
            });

            const addRing = (radius, tube, z, material, segments = 192) => {
                const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 20, segments), material);
                ring.position.z = z;
                lens.add(ring);
                return ring;
            };
            addRing(2.52, 0.17, 0, darkMetal);
            addRing(2.32, 0.055, 0.16, metal);
            addRing(2.08, 0.12, 0.1, darkMetal);
            addRing(1.92, 0.035, 0.24, metal);
            addRing(1.55, 0.08, 0.3, metal);
            addRing(1.35, 0.035, 0.38, glowRingMaterial);

            // Barrel body + knurled grip ring so the lens reads as an object from the side.
            const barrel = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 3.2, 128, 1, true), darkMetal.clone());
            barrel.material.side = THREE.DoubleSide;
            barrel.rotation.x = Math.PI / 2;
            barrel.position.z = -1.6;
            lens.add(barrel);

            const knurlCount = 120;
            const knurl = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.05, 0.5), darkMetal, knurlCount);
            {
                const m = new THREE.Matrix4();
                const q = new THREE.Quaternion();
                const e = new THREE.Euler();
                const v = new THREE.Vector3();
                const s = new THREE.Vector3(1, 1, 1);
                for (let i = 0; i < knurlCount; i += 1) {
                    const a = (i / knurlCount) * Math.PI * 2;
                    v.set(Math.cos(a) * 2.62, Math.sin(a) * 2.62, -0.6);
                    e.set(0, 0, a);
                    q.setFromEuler(e);
                    m.compose(v, q, s);
                    knurl.setMatrixAt(i, m);
                }
                knurl.instanceMatrix.needsUpdate = true;
            }
            lens.add(knurl);

            // Coated front glass: iridescent, only visible while the shutter is closed.
            const glassMaterial = new THREE.MeshPhysicalMaterial({
                color: 0x1f1710,
                emissive: 0x3a210a,
                emissiveIntensity: 0.5,
                metalness: 0.15,
                roughness: 0.04,
                clearcoat: 1,
                clearcoatRoughness: 0.03,
                iridescence: 1,
                iridescenceIOR: 1.45,
                iridescenceThicknessRange: [120, 420],
                transparent: true,
                opacity: 0.6,
                depthWrite: false,
            });
            const lensGlass = new THREE.Mesh(new THREE.CircleGeometry(1.32, 128), glassMaterial);
            lensGlass.position.z = 0.34;
            lens.add(lensGlass);

            /* ---------- Iris diaphragm ---------- */
            const BLADES = 9;
            const IRIS_OUTER = 1.75;
            const IRIS_SWEEP = 0.42;
            const irisGroup = new THREE.Group();
            irisGroup.position.z = 0.14;
            lens.add(irisGroup);

            const irisPos = new Float32Array(BLADES * 4 * 3);
            const irisNormal = new Float32Array(BLADES * 4 * 3);
            const irisColor = new Float32Array(BLADES * 4 * 3);
            const irisIndex = [];
            const tint = [0.95, 0.8, 0.88];
            for (let i = 0; i < BLADES; i += 1) {
                const b = i * 4;
                irisIndex.push(b, b + 1, b + 2, b, b + 2, b + 3);
                const t = tint[i % 3];
                const set = (v, shade) => {
                    irisNormal.set([0, 0, 1], (b + v) * 3);
                    irisColor.set([0.30 * t * shade, 0.27 * t * shade, 0.22 * t * shade], (b + v) * 3);
                };
                set(0, 1.9); set(1, 1.9);
                set(2, 0.55); set(3, 0.55);
            }
            const irisGeometry = new THREE.BufferGeometry();
            irisGeometry.setAttribute("position", new THREE.BufferAttribute(irisPos, 3).setUsage(THREE.DynamicDrawUsage));
            irisGeometry.setAttribute("normal", new THREE.BufferAttribute(irisNormal, 3));
            irisGeometry.setAttribute("color", new THREE.BufferAttribute(irisColor, 3));
            irisGeometry.setIndex(irisIndex);
            const irisMesh = new THREE.Mesh(
                irisGeometry,
                new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.9, roughness: 0.34, side: THREE.DoubleSide }),
            );
            irisMesh.frustumCulled = false;
            irisGroup.add(irisMesh);

            const seamPos = new Float32Array(BLADES * 2 * 3);
            const seamGeometry = new THREE.BufferGeometry();
            seamGeometry.setAttribute("position", new THREE.BufferAttribute(seamPos, 3).setUsage(THREE.DynamicDrawUsage));
            const seams = new THREE.LineSegments(
                seamGeometry,
                new THREE.LineBasicMaterial({ color: 0x050403, transparent: true, opacity: 0.9 }),
            );
            seams.frustumCulled = false;
            seams.position.z = 0.003;
            irisGroup.add(seams);

            const setIris = (radius, twist) => {
                const rho = radius / Math.cos(Math.PI / BLADES);
                for (let i = 0; i < BLADES; i += 1) {
                    const a0 = twist + (i / BLADES) * Math.PI * 2;
                    const a1 = twist + ((i + 1) / BLADES) * Math.PI * 2;
                    const pts = [
                        [Math.cos(a0) * rho, Math.sin(a0) * rho],
                        [Math.cos(a1) * rho, Math.sin(a1) * rho],
                        [Math.cos(a1 + IRIS_SWEEP) * IRIS_OUTER, Math.sin(a1 + IRIS_SWEEP) * IRIS_OUTER],
                        [Math.cos(a0 + IRIS_SWEEP) * IRIS_OUTER, Math.sin(a0 + IRIS_SWEEP) * IRIS_OUTER],
                    ];
                    pts.forEach(([x, y], v) => {
                        irisPos[(i * 4 + v) * 3] = x;
                        irisPos[(i * 4 + v) * 3 + 1] = y;
                        irisPos[(i * 4 + v) * 3 + 2] = 0;
                    });
                    seamPos.set([pts[0][0], pts[0][1], 0, pts[3][0], pts[3][1], 0], i * 6);
                }
                irisGeometry.attributes.position.needsUpdate = true;
                seamGeometry.attributes.position.needsUpdate = true;
            };
            setIris(0.16, 0.9);

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

            /* ---------- Photo cards ---------- */
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
            const photoAspect = (cardWidth - 0.16) / (cardHeight - 0.16);
            const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x171512, metalness: 0.9, roughness: 0.26 });
            const photoGeometry = new THREE.PlaneGeometry(cardWidth - 0.16, cardHeight - 0.16);
            const backingGeometry = new THREE.BoxGeometry(cardWidth, cardHeight, 0.12);
            const outlineGeometry = new THREE.EdgesGeometry(backingGeometry);
            const outlineMaterial = new THREE.LineBasicMaterial({ color: 0xb38a4a, transparent: true, opacity: 0.8 });
            const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

            photos.forEach(([src, x, y, z, rotation], index) => {
                const card = new THREE.Group();
                card.add(new THREE.Mesh(backingGeometry, frameMaterial));
                const photo = new THREE.Mesh(
                    photoGeometry,
                    new THREE.MeshBasicMaterial({ color: 0x2a2119 }),
                );
                photo.position.z = 0.066;
                card.add(photo);
                card.add(new THREE.LineSegments(outlineGeometry, outlineMaterial));
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
                        texture.anisotropy = maxAniso;
                        const imageAspect = texture.image.width / texture.image.height;
                        if (imageAspect > photoAspect) {
                            texture.repeat.set(photoAspect / imageAspect, 1);
                            texture.offset.set((1 - texture.repeat.x) / 2, 0);
                        } else {
                            texture.repeat.set(1, imageAspect / photoAspect);
                            texture.offset.set(0, (1 - texture.repeat.y) / 2);
                        }
                        photo.material.map = texture;
                        photo.material.color.set(0xffffff);
                        photo.material.needsUpdate = true;
                    },
                    undefined,
                    (error) => console.error(`Could not load cinematic photo: ${src}`, error),
                );
            });
            scene.add(cards);

            /* ---------- Dust ---------- */
            const dustMaterial = new THREE.PointsMaterial({
                color: 0xd5b66e,
                size: 0.04,
                transparent: true,
                opacity: 0.6,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
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

            /* ---------- Lens flare (camera-attached additive sprites) ---------- */
            const makeGlowTexture = (stops, size = 128) => {
                const c = document.createElement("canvas");
                c.width = size;
                c.height = size;
                const g = c.getContext("2d");
                const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
                stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
                g.fillStyle = gradient;
                g.fillRect(0, 0, size, size);
                const texture = new THREE.CanvasTexture(c);
                texture.colorSpace = THREE.SRGBColorSpace;
                return texture;
            };
            const glowTex = makeGlowTexture([[0, "rgba(255,236,196,1)"], [0.25, "rgba(255,170,80,0.55)"], [1, "rgba(255,120,30,0)"]]);
            const ringTex = makeGlowTexture([[0, "rgba(255,255,255,0)"], [0.62, "rgba(255,255,255,0)"], [0.8, "rgba(255,255,255,0.55)"], [0.9, "rgba(255,255,255,0.12)"], [1, "rgba(255,255,255,0)"]]);
            const flare = new THREE.Group();
            flare.position.z = -3;
            camera.add(flare);
            const makeSprite = (map, color, sx, sy, x, y, base) => {
                const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
                    map, color, blending: THREE.AdditiveBlending, transparent: true,
                    depthTest: false, depthWrite: false, opacity: 0, fog: false,
                }));
                sprite.scale.set(sx, sy, 1);
                sprite.position.set(x, y, 0);
                sprite.renderOrder = 10;
                sprite.userData.base = base;
                sprite.visible = false;
                flare.add(sprite);
                return sprite;
            };
            const flareSprites = [
                makeSprite(glowTex, 0xffffff, 3.2, 3.2, 0, 0, 1.0),
                makeSprite(glowTex, 0xffd9a0, 12, 0.22, 0, 0, 0.9), // anamorphic streak
                makeSprite(ringTex, 0xffb060, 0.9, 0.9, 0.5, 0.28, 0.5),
                makeSprite(ringTex, 0x8fb4ff, 0.55, 0.55, -0.45, -0.25, 0.4),
                makeSprite(ringTex, 0xff8a4a, 1.4, 1.4, -1.0, -0.55, 0.3),
                makeSprite(glowTex, 0xffe0b0, 0.7, 0.7, 0.95, 0.52, 0.35),
            ];

            /* ---------- Camera path ---------- */
            const camCurve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(1.7, 0, 17),
                new THREE.Vector3(1.5, 0, 10),
                new THREE.Vector3(0.5, 0, 3.6),
                new THREE.Vector3(0, 0, 0.2),
                new THREE.Vector3(0, 0, -4),
                new THREE.Vector3(-0.5, -0.2, -9.5),
                new THREE.Vector3(-0.9, -0.2, -14.2),
                new THREE.Vector3(0.7, -0.15, -18.6),
                new THREE.Vector3(0.6, 0.1, -21.8),
                new THREE.Vector3(0.9, 0, -24),
            ], false, "centripetal");
            const aimCurve = new THREE.CatmullRomCurve3([
                new THREE.Vector3(1.7, 0, 0),
                new THREE.Vector3(1.4, 0, -4),
                new THREE.Vector3(0.5, 0, -10),
                new THREE.Vector3(0.2, 0, -16),
                new THREE.Vector3(1.0, 0.2, -22),
                new THREE.Vector3(0.9, 0.3, -26),
                new THREE.Vector3(1.2, 0.3, -30),
                new THREE.Vector3(0.5, 0.3, -34),
            ], false, "centripetal");
            const camPoint = new THREE.Vector3();
            const aimPoint = new THREE.Vector3();

            // Find where the path actually crosses the lens plane so shutter timing never drifts from the path.
            let lensP = 0.41;
            {
                const probe = new THREE.Vector3();
                for (let i = 0; i <= 400; i += 1) {
                    camCurve.getPointAt(i / 400, probe);
                    if (probe.z <= 0.14) {
                        lensP = i / 400;
                        break;
                    }
                }
            }
            const openStart = Math.max(0.02, lensP - 0.36);
            const openLength = 0.24;
            const clickP = openStart + 0.05; // moment the blades snap

            /* ---------- Post-processing: HDR target, bloom, composite ---------- */
            const sceneTarget = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
            const bloomA = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
            const bloomB = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
            const quadScene = new THREE.Scene();
            const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
            const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
            quad.frustumCulled = false;
            quadScene.add(quad);

            const passVertex = `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);
                }
            `;
            const extractMaterial = new THREE.ShaderMaterial({
                depthTest: false, depthWrite: false,
                uniforms: { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2(1, 1) }, uThreshold: { value: 0.95 } },
                vertexShader: passVertex,
                fragmentShader: `
                    varying vec2 vUv;
                    uniform sampler2D tDiffuse;
                    uniform vec2 uTexel;
                    uniform float uThreshold;
                    void main() {
                        vec3 c = texture2D(tDiffuse, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
                        c += texture2D(tDiffuse, vUv + uTexel * vec2(1.0, -1.0)).rgb;
                        c += texture2D(tDiffuse, vUv + uTexel * vec2(-1.0, 1.0)).rgb;
                        c += texture2D(tDiffuse, vUv + uTexel * vec2(1.0, 1.0)).rgb;
                        c *= 0.25;
                        float peak = max(max(c.r, c.g), c.b);
                        float w = smoothstep(uThreshold, uThreshold + 0.8, peak);
                        gl_FragColor = vec4(c * w, 1.0);
                    }
                `,
            });
            const blurMaterial = new THREE.ShaderMaterial({
                depthTest: false, depthWrite: false,
                uniforms: { tDiffuse: { value: null }, uStep: { value: new THREE.Vector2() } },
                vertexShader: passVertex,
                fragmentShader: `
                    varying vec2 vUv;
                    uniform sampler2D tDiffuse;
                    uniform vec2 uStep;
                    void main() {
                        vec3 c = texture2D(tDiffuse, vUv).rgb * 0.227027;
                        c += texture2D(tDiffuse, vUv + uStep * 1.3846154).rgb * 0.3162162;
                        c += texture2D(tDiffuse, vUv - uStep * 1.3846154).rgb * 0.3162162;
                        c += texture2D(tDiffuse, vUv + uStep * 3.2307692).rgb * 0.0702703;
                        c += texture2D(tDiffuse, vUv - uStep * 3.2307692).rgb * 0.0702703;
                        gl_FragColor = vec4(c, 1.0);
                    }
                `,
            });
            const compositeMaterial = new THREE.ShaderMaterial({
                depthTest: false, depthWrite: false,
                uniforms: {
                    tScene: { value: null },
                    tBloom: { value: null },
                    uTime: { value: 0 },
                    uVelocity: { value: 0 },
                    uFlash: { value: 0 },
                    uBloom: { value: 0.55 },
                    uAspect: { value: 1 },
                },
                vertexShader: passVertex,
                fragmentShader: `
                    varying vec2 vUv;
                    uniform sampler2D tScene;
                    uniform sampler2D tBloom;
                    uniform float uTime;
                    uniform float uVelocity;
                    uniform float uFlash;
                    uniform float uBloom;
                    uniform float uAspect;

                    float hash(vec2 p) {
                        p = fract(p * vec2(123.34, 456.21));
                        p += dot(p, p + 45.32);
                        return fract(p.x * p.y);
                    }

                    void main() {
                        vec2 c = vUv - 0.5;
                        vec2 cc = c * vec2(uAspect, 1.0);
                        float r2 = dot(cc, cc);

                        // chromatic aberration: stronger at the edges and while scrolling fast
                        float ca = (0.0005 + uVelocity * 0.004) * (0.3 + r2 * 3.0);
                        vec2 dir = normalize(c + 1e-5);
                        vec3 col;
                        col.r = texture2D(tScene, vUv + dir * ca).r;
                        col.g = texture2D(tScene, vUv).g;
                        col.b = texture2D(tScene, vUv - dir * ca).b;

                        col += texture2D(tBloom, vUv).rgb * uBloom;
                        col += vec3(1.0, 0.82, 0.55) * uFlash * max(1.25 - r2 * 1.6, 0.0);

                        // subtle grade: warm highlights, cool shadows
                        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
                        col = mix(col, col * vec3(1.06, 1.0, 0.92), smoothstep(0.2, 1.0, l));
                        col = mix(col, col * vec3(0.94, 0.99, 1.06), 1.0 - smoothstep(0.0, 0.25, l));

                        col *= 1.0 - smoothstep(0.16, 0.78, r2) * 0.55;

                        float g = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 100.0) - 0.5;
                        col += g * 0.03 * (1.0 - clamp(l, 0.0, 1.0) * 0.6);

                        gl_FragColor = vec4(max(col, 0.0), 1.0);
                        #include <tonemapping_fragment>
                        #include <colorspace_fragment>
                    }
                `,
            });

            const runPass = (material, target) => {
                quad.material = material;
                renderer.setRenderTarget(target);
                renderer.render(quadScene, quadCamera);
            };
            const blur = (source, target, dx, dy, stride) => {
                blurMaterial.uniforms.tDiffuse.value = source.texture;
                blurMaterial.uniforms.uStep.value.set((dx / source.width) * stride, (dy / source.height) * stride);
                runPass(blurMaterial, target);
            };

            /* ---------- Scroll / layout ---------- */
            const measure = () => {
                storyTop = story.getBoundingClientRect().top + window.scrollY;
                scrollRange = story.offsetHeight - window.innerHeight;
            };

            const updateScroll = () => {
                targetProgress = scrollRange > 0 ? clamp((window.scrollY - storyTop) / scrollRange, 0, 1) : 0;
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

            const baseFov = () => (window.innerWidth < 760 ? 48 : 42);
            const sizeBuffers = () => {
                const width = window.innerWidth;
                const height = window.innerHeight;
                const base = Math.min(window.devicePixelRatio || 1, width < 760 ? 1.35 : 1.75);
                renderer.setPixelRatio(base * quality);
                renderer.setSize(width, height, false);
                renderer.getDrawingBufferSize(bufferSize);
                sceneTarget.setSize(bufferSize.x, bufferSize.y);
                bloomA.setSize(Math.max(1, bufferSize.x >> 2), Math.max(1, bufferSize.y >> 2));
                bloomB.setSize(Math.max(1, bufferSize.x >> 2), Math.max(1, bufferSize.y >> 2));
                extractMaterial.uniforms.uTexel.value.set(1 / bufferSize.x, 1 / bufferSize.y);
                compositeMaterial.uniforms.uAspect.value = width / height;
            };

            const resize = () => {
                camera.aspect = window.innerWidth / window.innerHeight;
                camera.fov = baseFov();
                camera.updateProjectionMatrix();
                sizeBuffers();
                measure();
                updateScroll();
            };

            window.addEventListener("pointermove", (event) => {
                pointer.tx = (event.clientX / window.innerWidth) * 2 - 1;
                pointer.ty = -((event.clientY / window.innerHeight) * 2 - 1);
            }, { passive: true });

            /* ---------- Render loop ---------- */
            const render = (now) => {
                if (!visible) {
                    frame = 0;
                    last = 0;
                    return;
                }
                frame = window.requestAnimationFrame(render);
                const dt = Math.min((now - (last || now)) / 1000, 0.05);
                last = now;
                elapsed += dt;

                // Adaptive quality: drop resolution if the device can't hold ~40 fps (never raises it back, to avoid flapping).
                perfAccum += dt;
                perfFrames += 1;
                if (perfFrames === 60) {
                    if (!perfWarm && perfAccum / 60 > 0.024 && quality > 0.6) {
                        quality = Math.max(0.6, quality - 0.15);
                        sizeBuffers();
                    }
                    perfWarm = false;
                    perfAccum = 0;
                    perfFrames = 0;
                }

                prevProgress = sceneProgress;
                sceneProgress += (targetProgress - sceneProgress) * (1 - Math.exp(-dt * 4.5));
                const p = sceneProgress;
                const speed = dt > 0 ? Math.abs(p - prevProgress) / dt : 0;
                velocity += (clamp(speed * 1.2, 0, 1) - velocity) * (1 - Math.exp(-dt * 6));
                pointer.x += (pointer.tx - pointer.x) * (1 - Math.exp(-dt * 3));
                pointer.y += (pointer.ty - pointer.y) * (1 - Math.exp(-dt * 3));

                // Camera
                camCurve.getPointAt(p, camPoint);
                aimCurve.getPointAt(p, aimPoint);
                camera.position.copy(camPoint);
                camera.lookAt(aimPoint);
                camera.translateX(pointer.x * 0.16);
                camera.translateY(pointer.y * 0.09);
                const clickShake = bump(p, clickP, 0.02);
                camera.rotateZ(Math.sin(elapsed * 0.31) * 0.004 + clickShake * (Math.sin(elapsed * 47) + Math.sin(elapsed * 71)) * 0.0035);
                camera.rotateX(Math.sin(elapsed * 0.23) * 0.002 + clickShake * Math.sin(elapsed * 53) * 0.003);
                camera.fov = baseFov() + velocity * 2.5;
                camera.updateProjectionMatrix();
                camLight.position.copy(camPoint);

                // Shutter
                const openT = clamp((p - openStart) / openLength, 0, 1);
                const eased = easeOutBack(openT);
                setIris(lerp(0.16, 1.1, eased), lerp(0.9, 0, smooth(openT)));

                const glassFade = 1 - smooth(clamp((p - (clickP + 0.02)) / 0.12, 0, 1));
                glassMaterial.opacity = 0.6 * glassFade;
                lensGlass.visible = glassFade > 0.01;
                glowRingMaterial.emissiveIntensity = 1.1 + bump(p, clickP, 0.03) * 2.2;

                // Click flash + flare, and a second bloom of light as the camera passes through the opening
                const click = bump(p, clickP, 0.02);
                const pass = bump(p, lensP, 0.025);
                const flareAmount = clamp(click * 0.9 + pass, 0, 1);
                flareSprites.forEach((sprite) => {
                    sprite.visible = flareAmount > 0.01;
                    sprite.material.opacity = flareAmount * sprite.userData.base;
                });
                compositeMaterial.uniforms.uFlash.value = click * 0.55 + pass * 0.3;

                lens.rotation.z = p * 0.18 + Math.sin(elapsed * 0.12) * 0.02;
                lens.rotation.y = Math.sin(elapsed * 0.16) * 0.03;

                cards.children.forEach((card) => {
                    card.position.y = card.userData.baseY + Math.sin(elapsed * 0.55 + card.userData.floatOffset) * 0.035;
                    card.rotation.y = card.userData.baseRotationY + Math.sin(elapsed * 0.17 + card.userData.floatOffset) * 0.03;
                });
                dust.rotation.z = elapsed * 0.006;
                dustMaterial.size = 0.04 + velocity * 0.03;
                atmosphere.material.uniforms.uTime.value = elapsed;

                // 1) scene -> HDR target
                renderer.setRenderTarget(sceneTarget);
                renderer.render(scene, camera);

                // 2) bright-pass + 2x separable blur (quarter res)
                extractMaterial.uniforms.tDiffuse.value = sceneTarget.texture;
                runPass(extractMaterial, bloomA);
                blur(bloomA, bloomB, 1, 0, 1);
                blur(bloomB, bloomA, 0, 1, 1);
                blur(bloomA, bloomB, 1, 0, 2.5);
                blur(bloomB, bloomA, 0, 1, 2.5);

                // 3) composite to screen (grade, grain, vignette, tone mapping, sRGB)
                compositeMaterial.uniforms.tScene.value = sceneTarget.texture;
                compositeMaterial.uniforms.tBloom.value = bloomA.texture;
                compositeMaterial.uniforms.uTime.value = elapsed;
                compositeMaterial.uniforms.uVelocity.value = velocity;
                runPass(compositeMaterial, null);
            };

            const visibilityObserver = new IntersectionObserver(([entry]) => {
                visible = entry.isIntersecting;
                if (visible && !frame) frame = window.requestAnimationFrame(render);
            }, { rootMargin: "100px 0px" });
            visibilityObserver.observe(story);

            window.addEventListener("scroll", updateScroll, { passive: true });
            window.addEventListener("resize", resize, { passive: true });
            if ("ResizeObserver" in window) {
                new ResizeObserver(() => { measure(); updateScroll(); }).observe(document.body);
            }

            resize();
            sceneProgress = targetProgress;
            prevProgress = targetProgress;
            document.documentElement.classList.add("webgl-ready");
        }
        }).catch((error) => {
            story.classList.add("is-static");
            console.error("The Three.js scene could not load; the photo story remains available.", error);
        });
    }
}