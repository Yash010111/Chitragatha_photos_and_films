/*enh*/
const story = document.querySelector("[data-cinematic-story]");
const canvas = document.querySelector("[data-cinematic-canvas]");
const chapters = [...document.querySelectorAll("[data-journey-chapter]")];
const progressFill = document.querySelector("[data-journey-progress]");
const counter = document.querySelector("[data-journey-count]");
const soundToggle = document.querySelector("[data-cinematic-sound]"); // optional <button>; sound stays opt-in

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
            let activeFrame = -1;
            let storyTop = 0;
            let scrollRange = 1;
            let quality = 1;
            let perfFrames = 0;
            let perfAccum = 0;
            let perfWarm = true;
            let wasMobile = null;
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
                document.documentElement.classList.remove("webgl-ready");
            });

            /* ---------- Small helpers ---------- */
            const canvasTexture = (w, h, draw) => {
                const c = document.createElement("canvas");
                c.width = w;
                c.height = h;
                draw(c.getContext("2d"), w, h);
                const t = new THREE.CanvasTexture(c);
                t.colorSpace = THREE.SRGBColorSpace;
                t.anisotropy = 4;
                return t;
            };
            const makeGlowTexture = (stops, size = 128) => canvasTexture(size, size, (g) => {
                const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
                stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
                g.fillStyle = gradient;
                g.fillRect(0, 0, size, size);
            });
            const glowTex = makeGlowTexture([[0, "rgba(255,236,196,1)"], [0.25, "rgba(255,170,80,0.55)"], [1, "rgba(255,120,30,0)"]]);
            const ringTex = makeGlowTexture([[0, "rgba(255,255,255,0)"], [0.62, "rgba(255,255,255,0)"], [0.8, "rgba(255,255,255,0.55)"], [0.9, "rgba(255,255,255,0.12)"], [1, "rgba(255,255,255,0)"]]);

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

            /* ---------- Camera path (defined early: the shutter timing and the gallery layout both depend on it) ---------- */
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

            /* Shutter timeline (scroll progress):
               armed (idle flutter) -> wind-up (blades stop down to nothing) -> CLICK (viewfinder blackout + flash)
               -> blades snap open with a mechanical overshoot -> camera passes through the opening. */
            const openStart = Math.max(0.1, lensP - 0.34);
            const preStart = openStart - 0.07;
            const clickP = openStart + 0.05;
            const openLength = 0.19;

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

            const addRing = (radius, tube, z, material, segments = 192, parent = lens) => {
                const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 20, segments), material);
                ring.position.z = z;
                parent.add(ring);
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

            /* ---------- Aperture ring with f-stop scale (turns as the iris opens) ---------- */
            const focusRing = new THREE.Group();
            focusRing.position.z = 0.03;
            lens.add(focusRing);
            {
                const backing = new THREE.Mesh(new THREE.RingGeometry(2.7, 3.2, 128), darkMetal);
                backing.material.side = THREE.DoubleSide;
                focusRing.add(backing);
                const scaleTexture = canvasTexture(1024, 1024, (g, w, h) => {
                    g.translate(w / 2, h / 2);
                    g.strokeStyle = "#d0ad67";
                    g.fillStyle = "#d9b872";
                    g.textAlign = "center";
                    g.textBaseline = "middle";
                    g.font = "600 30px ui-monospace, Menlo, Consolas, monospace";
                    for (let i = 0; i < 72; i += 1) {
                        const major = i % 8 === 0;
                        g.save();
                        g.rotate((i / 72) * Math.PI * 2);
                        g.lineWidth = major ? 4 : 2;
                        g.beginPath();
                        g.moveTo(0, -(major ? 488 : 497));
                        g.lineTo(0, -506);
                        g.stroke();
                        g.restore();
                    }
                    ["1.4", "2", "2.8", "4", "5.6", "8", "11", "16", "22"].forEach((label, i) => {
                        g.save();
                        g.rotate((i / 9) * Math.PI * 2);
                        g.translate(0, -462);
                        g.fillText(label, 0, 0);
                        g.restore();
                    });
                });
                const scaleRing = new THREE.Mesh(
                    new THREE.RingGeometry(2.7, 3.2, 128),
                    new THREE.MeshBasicMaterial({ map: scaleTexture, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
                );
                scaleRing.position.z = 0.004;
                focusRing.add(scaleRing);
                addRing(3.2, 0.045, 0, metal, 160, focusRing);
                addRing(2.7, 0.03, 0, metal, 160, focusRing);
            }
            {
                // Fixed index mark (HDR red so it blooms slightly)
                const mark = new THREE.Shape();
                mark.moveTo(0, 0);
                mark.lineTo(-0.1, 0.22);
                mark.lineTo(0.1, 0.22);
                mark.closePath();
                const markMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
                markMaterial.color.setRGB(3, 0.45, 0.18);
                const markMesh = new THREE.Mesh(new THREE.ShapeGeometry(mark), markMaterial);
                markMesh.position.set(0, 3.32, 0.07);
                lens.add(markMesh);
            }

            /* ---------- Real iris diaphragm: rigid blades turning on pivots ---------- */
            const BLADES = 8;
            const IRIS_D0 = 0.1;      // apothem of the fully closed hole
            const IRIS_RP = 1.65;     // pivot radius
            const IRIS_BETA = 1.4;    // pivot angle relative to each blade's working-edge normal
            const IRIS_MAX = 1.12;    // fully open aperture (apothem)
            const WINDOW_R = 1.5;     // blades are clipped to this radius, the bezel hides the rest
            const IRIS_THMAX = IRIS_BETA - Math.acos(clamp((IRIS_MAX - IRIS_D0) / IRIS_RP + Math.cos(IRIS_BETA), -1, 1));
            // Aperture apothem for a blade rotation th: d = D0 + RP * (cos(th - BETA) - cos(BETA))
            const irisTheta = (radius) => clamp(
                IRIS_BETA - Math.acos(clamp((radius - IRIS_D0) / IRIS_RP + Math.cos(IRIS_BETA), -1, 1)),
                -0.065,
                IRIS_THMAX + 0.03,
            );

            const invLens = { value: new THREE.Matrix4() };
            const clipToWindow = (material) => {
                material.customProgramCacheKey = () => "iris-window-clip";
                material.onBeforeCompile = (shader) => {
                    shader.uniforms.uInvLens = invLens;
                    shader.uniforms.uWindow = { value: WINDOW_R };
                    shader.vertexShader = shader.vertexShader
                        .replace("#include <common>", "#include <common>\nuniform mat4 uInvLens;\nvarying vec2 vWin;")
                        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWin = (uInvLens * modelMatrix * vec4(transformed, 1.0)).xy;");
                    shader.fragmentShader = shader.fragmentShader
                        .replace("#include <common>", "#include <common>\nuniform float uWindow;\nvarying vec2 vWin;")
                        .replace("void main() {", "void main() {\n    if (dot(vWin, vWin) > uWindow * uWindow) discard;");
                };
                return material;
            };

            const brushedBump = canvasTexture(256, 256, (g, w, h) => {
                g.fillStyle = "#808080";
                g.fillRect(0, 0, w, h);
                for (let i = 0; i < 700; i += 1) {
                    const shade = 100 + Math.random() * 60;
                    g.fillStyle = `rgba(${shade},${shade},${shade},0.5)`;
                    g.fillRect(Math.random() * w, 0, 1, h);
                }
            });
            brushedBump.colorSpace = THREE.NoColorSpace;
            brushedBump.wrapS = brushedBump.wrapT = THREE.RepeatWrapping;
            brushedBump.repeat.set(3, 3);
            const bladeMaterials = [0x2f2b25, 0x26231e].map((color) => clipToWindow(new THREE.MeshStandardMaterial({
                color, metalness: 0.88, roughness: 0.36, bumpMap: brushedBump, bumpScale: 0.5, side: THREE.DoubleSide,
            })));

            const IRIS_PIVOT = new THREE.Vector2(Math.cos(IRIS_BETA) * IRIS_RP, Math.sin(IRIS_BETA) * IRIS_RP);
            const bladeGeometry = (() => {
                const aHi = THREE.MathUtils.degToRad(62.4);
                const aLo = THREE.MathUtils.degToRad(-33.8);
                const Rb = 2.09;
                const shape = new THREE.Shape();
                shape.moveTo(IRIS_D0, -0.985);                  // working edge (straight, faces the hole)
                shape.lineTo(IRIS_D0, 1.35);
                shape.quadraticCurveTo(0.6, 1.7, Math.cos(aHi) * Rb, Math.sin(aHi) * Rb); // leaf shoulder
                shape.absarc(0, 0, Rb, aHi, aLo, true);        // outer rim, hidden under the bezel
                shape.closePath();
                const geometry = new THREE.ExtrudeGeometry(shape, {
                    depth: 0.018, curveSegments: 28, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.008, bevelSegments: 1,
                });
                geometry.translate(-IRIS_PIVOT.x, -IRIS_PIVOT.y, 0);
                return geometry;
            })();

            const irisGroup = new THREE.Group();
            irisGroup.position.z = 0.14;
            lens.add(irisGroup);
            const bladePivots = [];
            for (let i = 0; i < BLADES; i += 1) {
                const holder = new THREE.Group();
                holder.rotation.z = (i / BLADES) * Math.PI * 2;
                holder.position.z = (i % 2) * 0.016; // alternate layers so neighbouring blades overlap like a real iris
                const pivot = new THREE.Group();
                pivot.position.set(IRIS_PIVOT.x, IRIS_PIVOT.y, 0);
                pivot.add(new THREE.Mesh(bladeGeometry, bladeMaterials[i % 2]));
                holder.add(pivot);
                irisGroup.add(holder);
                bladePivots.push(pivot);
            }

            // Light leaking through the aperture; scales with the opening and fades once the camera is through.
            const apertureGlow = new THREE.Mesh(
                new THREE.CircleGeometry(1, 64),
                new THREE.MeshBasicMaterial({
                    map: glowTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0,
                }),
            );
            apertureGlow.material.color.setRGB(2.2, 1.25, 0.55);
            apertureGlow.position.z = 0.115;
            lens.add(apertureGlow);

            // Bezel that hides the blade rims, plus a drive ring whose studs turn with the blades.
            {
                const bezel = new THREE.Mesh(new THREE.RingGeometry(1.46, 2.02, 128), darkMetal);
                bezel.material.side = THREE.DoubleSide;
                bezel.position.z = 0.2;
                lens.add(bezel);
                addRing(1.485, 0.022, 0.215, metal, 160); // polished chamfer around the window
            }
            const driveRing = new THREE.Group();
            driveRing.position.z = 0.225;
            lens.add(driveRing);
            {
                const stud = new THREE.CylinderGeometry(0.05, 0.05, 0.05, 16);
                const slot = new THREE.BoxGeometry(0.075, 0.012, 0.012);
                const studMaterial = new THREE.MeshStandardMaterial({ color: 0xb9975a, metalness: 1, roughness: 0.22 });
                for (let i = 0; i < BLADES; i += 1) {
                    const a = (i / BLADES) * Math.PI * 2 + 0.6;
                    const body = new THREE.Mesh(stud, studMaterial);
                    body.rotation.x = Math.PI / 2;
                    body.position.set(Math.cos(a) * 1.76, Math.sin(a) * 1.76, 0.02);
                    const groove = new THREE.Mesh(slot, darkMetal);
                    groove.position.set(Math.cos(a) * 1.76, Math.sin(a) * 1.76, 0.048);
                    groove.rotation.z = a * 2.3;
                    driveRing.add(body, groove);
                }
            }

            const setIris = (radius) => {
                const theta = irisTheta(radius);
                for (let i = 0; i < BLADES; i += 1) bladePivots[i].rotation.z = theta;
                return theta;
            };
            setIris(IRIS_D0);
            scene.add(lens);

            /* ---------- Film strips weaving along the flight path ---------- */
            const filmTexture = canvasTexture(384, 256, (g, w, h) => {
                g.fillStyle = "#15110c";
                g.fillRect(0, 0, w, h);
                const frameGradient = g.createLinearGradient(0, 44, w, h - 44);
                frameGradient.addColorStop(0, "rgba(255,170,90,0.34)");
                frameGradient.addColorStop(1, "rgba(120,160,255,0.16)");
                g.fillStyle = frameGradient;
                g.fillRect(14, 46, w - 28, h - 92);
                g.strokeStyle = "rgba(255,190,110,0.5)";
                g.lineWidth = 2;
                g.strokeRect(14, 46, w - 28, h - 92);
                g.fillStyle = "#000";
                for (let i = 0; i < 4; i += 1) {
                    const x = (i + 0.5) * (w / 4) - 17;
                    for (const y of [12, h - 34]) {
                        g.beginPath();
                        if (g.roundRect) g.roundRect(x, y, 34, 22, 6); else g.rect(x, y, 34, 22);
                        g.fill();
                    }
                }
                g.fillStyle = "rgba(255,180,90,0.75)";
                g.font = "600 15px ui-monospace, Menlo, Consolas, monospace";
                g.fillText("CHITRAGATHA 400", 20, 38);
            });
            filmTexture.wrapS = THREE.RepeatWrapping;
            const curveLength = camCurve.getLength();
            const filmMaterial = new THREE.MeshStandardMaterial({
                map: filmTexture, emissiveMap: filmTexture, emissive: 0xffffff, emissiveIntensity: 0.28,
                roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide,
            });
            const buildRibbon = (t0, t1, width, side) => {
                const segments = 240;
                const positions = new Float32Array((segments + 1) * 2 * 3);
                const uvs = new Float32Array((segments + 1) * 2 * 2);
                const indices = [];
                const c = new THREE.Vector3();
                const tangent = new THREE.Vector3();
                const right = new THREE.Vector3();
                const upAxis = new THREE.Vector3();
                const worldUp = new THREE.Vector3(0, 1, 0);
                const axis = new THREE.Vector3();
                for (let i = 0; i <= segments; i += 1) {
                    const t = lerp(t0, t1, i / segments);
                    camCurve.getPointAt(t, c);
                    camCurve.getTangentAt(t, tangent);
                    right.crossVectors(tangent, worldUp).normalize();
                    upAxis.crossVectors(right, tangent).normalize();
                    const roll = Math.sin(t * 10 + side * 1.3) * 0.9;
                    axis.copy(right).multiplyScalar(Math.cos(roll)).addScaledVector(upAxis, Math.sin(roll));
                    c.addScaledVector(right, -side * 0.7 * Math.sin(t * 8));
                    c.addScaledVector(upAxis, side * 2.7 + 0.3 * Math.sin(t * 11 + side));
                    const u = ((t - t0) * curveLength) / 1.35;
                    positions.set([c.x - axis.x * width / 2, c.y - axis.y * width / 2, c.z - axis.z * width / 2], i * 6);
                    positions.set([c.x + axis.x * width / 2, c.y + axis.y * width / 2, c.z + axis.z * width / 2], i * 6 + 3);
                    uvs.set([u, 0, u, 1], i * 4);
                    if (i < segments) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
                }
                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
                geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
                geometry.setIndex(indices);
                geometry.computeVertexNormals();
                const mesh = new THREE.Mesh(geometry, filmMaterial);
                mesh.frustumCulled = false;
                return mesh;
            };
            scene.add(buildRibbon(lensP + 0.05, 1, 0.9, 1), buildRibbon(lensP + 0.05, 1, 0.9, -1));

            /* ---------- Photo gallery: film frames on a zig-zag corridor, one hero frame at the end ---------- */
            const FRAMES = [
                { src: "assets/images/p5.jpg", exposure: "f/2.8  1/250  ISO 200" },
                { src: "assets/images/p7.jpg", exposure: "f/1.8  1/500  ISO 100" },
                { src: "assets/images/p4.jpg", exposure: "f/4  1/125  ISO 400" },
                { src: "assets/images/p9.jpg", exposure: "f/2  1/320  ISO 160" },
                { src: "assets/images/p3.jpg", exposure: "f/5.6  1/200  ISO 200" },
                { src: "assets/images/p8.jpg", exposure: "f/1.4  1/800  ISO 100" },
                { src: "assets/images/s1.jpg", exposure: "f/2.8  1/160  ISO 320" },
                { src: "assets/images/p1.jpg", exposure: "f/2  1/250  ISO 125" }, // hero frame
            ];
            const CARD_W = 3.8;
            const CARD_H = 2.75;
            const BORDER_X = 0.1;
            const BORDER_Y = 0.32;
            const PHOTO_W = CARD_W - BORDER_X * 2;
            const PHOTO_H = CARD_H - BORDER_Y * 2;
            const photoAspect = PHOTO_W / PHOTO_H;
            const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x171512, metalness: 0.9, roughness: 0.26 });
            const photoGeometry = new THREE.PlaneGeometry(PHOTO_W, PHOTO_H);
            const overlayGeometry = new THREE.PlaneGeometry(CARD_W, CARD_H);
            const backingGeometry = new THREE.BoxGeometry(CARD_W, CARD_H, 0.12);
            const outlineGeometry = new THREE.EdgesGeometry(backingGeometry);
            const outlineMaterial = new THREE.LineBasicMaterial({ color: 0xb38a4a, transparent: true, opacity: 0.8 });
            const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

            // Viewfinder AF brackets that lock onto the frame in focus.
            const bracketGeometry = (() => {
                const hw = CARD_W / 2 + 0.16;
                const hh = CARD_H / 2 + 0.16;
                const arm = 0.36;
                const pts = [];
                [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(([sx, sy]) => {
                    pts.push(sx * hw, sy * hh, 0, sx * (hw - arm), sy * hh, 0);
                    pts.push(sx * hw, sy * hh, 0, sx * hw, sy * (hh - arm), 0);
                });
                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
                return geometry;
            })();

            // Film border (sprocket holes + edge print) drawn once per frame; the photo window is transparent.
            const filmBorderTexture = (index, exposure) => canvasTexture(1024, 740, (g, w, h) => {
                const wx = Math.round((BORDER_X / CARD_W) * w);
                const wy = Math.round((BORDER_Y / CARD_H) * h);
                g.fillStyle = "#14110d";
                g.fillRect(0, 0, w, h);
                for (let i = 0; i < 900; i += 1) {
                    g.fillStyle = `rgba(255,200,120,${Math.random() * 0.025})`;
                    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
                }
                g.clearRect(wx, wy, w - wx * 2, h - wy * 2);
                g.fillStyle = "#000";
                for (let x = 40; x < w - 30; x += 50) {
                    for (const y of [22, h - 48]) {
                        g.beginPath();
                        if (g.roundRect) g.roundRect(x, y, 34, 24, 7); else g.rect(x, y, 34, 24);
                        g.fill();
                    }
                }
                const number = String(index + 1).padStart(2, "0");
                g.fillStyle = "rgba(255,180,87,0.92)";
                g.font = "600 24px ui-monospace, Menlo, Consolas, monospace";
                g.textBaseline = "alphabetic";
                g.textAlign = "left";
                g.fillText("CHITRAGATHA 400", wx + 6, h - 58);
                g.textAlign = "center";
                g.fillText(`\u25B8 ${number}A`, w / 2, h - 58);
                g.textAlign = "right";
                g.fillText(exposure, w - wx - 6, h - 58);
                g.textAlign = "left";
                g.fillText(`\u25B2 ${number}`, wx + 6, 78);
            });

            const cardList = [];
            const loadCard = (card) => {
                const u = card.userData;
                if (u.requested) return;
                u.requested = true;
                textures.load(
                    u.src,
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
                        u.photoMat.map = texture;
                        u.photoMat.color.set(0xffffff);
                        u.photoMat.needsUpdate = true;
                        u.loaded = true;
                    },
                    undefined,
                    (error) => {
                        u.loaded = true;
                        console.error(`Could not load cinematic photo: ${u.src}`, error);
                    },
                );
            };

            FRAMES.forEach((def, index) => {
                const hero = index === FRAMES.length - 1;
                const card = new THREE.Group();
                const photoMat = new THREE.MeshBasicMaterial({ color: 0x2a2119 });
                const photo = new THREE.Mesh(photoGeometry, photoMat);
                photo.position.z = 0.062;
                const overlayMat = new THREE.MeshBasicMaterial({ map: filmBorderTexture(index, def.exposure), transparent: true });
                const overlay = new THREE.Mesh(overlayGeometry, overlayMat);
                overlay.position.z = 0.066;
                const halo = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: glowTex, color: 0xffb060, blending: THREE.AdditiveBlending, transparent: true,
                    depthWrite: false, fog: false, opacity: 0,
                }));
                halo.scale.set(CARD_W * 2.1, CARD_H * 2.1, 1);
                halo.position.z = -0.5;
                const afMat = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0 });
                const brackets = new THREE.LineSegments(bracketGeometry, afMat);
                brackets.position.z = 0.1;
                card.add(new THREE.Mesh(backingGeometry, frameMaterial), photo, overlay, new THREE.LineSegments(outlineGeometry, outlineMaterial), halo, brackets);
                Object.assign(card.userData, {
                    index, hero, src: def.src, photoMat, overlayMat, haloMat: halo.material, afMat, brackets,
                    t: 0, baseY: 0, baseScale: 1, baseRot: new THREE.Euler(),
                    floatOffset: index * 0.8, focus: 0, reveal: 0, loaded: false, requested: false,
                    focusAt: hero ? 7.4 : 5.5, focusWidth: hero ? 4 : 2.8,
                });
                cardList.push(card);
                cards.add(card);
            });
            scene.add(cards);

            // Organised placement relative to the camera path: alternate left/right, evenly spaced, turned toward the path.
            const layoutVec = { c: new THREE.Vector3(), tan: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) };
            const layoutCards = () => {
                const mobile = window.innerWidth < 760;
                const lane = mobile ? 0.8 : 2.35;
                const lift = mobile ? 0.95 : 0.32;
                const laneCount = cardList.length - 1;
                const { c, tan, right, up } = layoutVec;
                cardList.forEach((card, i) => {
                    const u = card.userData;
                    if (u.hero) {
                        camCurve.getPointAt(1, c);
                        camCurve.getTangentAt(1, tan);
                        c.addScaledVector(tan, 7.4);
                        c.y += 0.15;
                        u.baseRot.set(0, Math.atan2(-tan.x, -tan.z), 0);
                        u.baseScale = mobile ? 1.05 : 1.5;
                    } else {
                        u.t = lerp(lensP + 0.13, 0.93, laneCount > 1 ? i / (laneCount - 1) : 0);
                        camCurve.getPointAt(u.t, c);
                        camCurve.getTangentAt(u.t, tan);
                        right.crossVectors(tan, up).normalize();
                        const side = i % 2 ? 1 : -1;
                        c.addScaledVector(right, side * lane);
                        c.y += side * lift;
                        u.baseRot.set(side * -0.02, Math.atan2(-tan.x, -tan.z) - side * (mobile ? 0.14 : 0.42), side * 0.025);
                        u.baseScale = mobile ? 0.72 : 1;
                    }
                    card.position.copy(c);
                    u.baseY = c.y;
                    card.rotation.copy(u.baseRot);
                    card.scale.setScalar(u.baseScale);
                });
            };
            layoutCards();

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

            /* ---------- Bokeh: octagonal discs, matching the 8-blade iris ---------- */
            const bp = new Float32Array(90 * 3);
            for (let i = 0; i < bp.length; i += 3) {
                bp[i] = (Math.random() - 0.5) * 18;
                bp[i + 1] = (Math.random() - 0.5) * 10;
                bp[i + 2] = 6 - Math.random() * 38;
            }
            const bokehGeo = new THREE.BufferGeometry();
            bokehGeo.setAttribute("position", new THREE.BufferAttribute(bp, 3));
            const bokehTex = canvasTexture(64, 64, (g) => {
                g.beginPath();
                for (let i = 0; i < BLADES; i += 1) {
                    const a = (i / BLADES) * Math.PI * 2 + Math.PI / BLADES;
                    g[i ? "lineTo" : "moveTo"](32 + Math.cos(a) * 29, 32 + Math.sin(a) * 29);
                }
                g.closePath();
                g.fillStyle = "rgba(255,185,105,0.22)";
                g.fill();
                g.strokeStyle = "rgba(255,215,160,0.5)";
                g.lineWidth = 2;
                g.stroke();
            });
            const bokehMat = new THREE.PointsMaterial({ map: bokehTex, size: 0.7, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
            const bokeh = new THREE.Points(bokehGeo, bokehMat);
            scene.add(bokeh);

            /* ---------- Lens flare (camera-attached additive sprites) ---------- */
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

            /* ---------- Optional shutter sound (opt-in via [data-cinematic-sound]) ---------- */
            let audioCtx = null;
            let soundOn = false;
            if (soundToggle) {
                soundToggle.setAttribute("aria-pressed", "false");
                soundToggle.addEventListener("click", () => {
                    soundOn = !soundOn;
                    soundToggle.setAttribute("aria-pressed", String(soundOn));
                    if (soundOn && !audioCtx) {
                        try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (error) { audioCtx = null; }
                    }
                    if (audioCtx && soundOn) audioCtx.resume();
                });
            }
            const noiseBurst = (when, duration, frequency, gain) => {
                const length = Math.floor(audioCtx.sampleRate * duration);
                const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (length * 0.22));
                const source = audioCtx.createBufferSource();
                source.buffer = buffer;
                const filter = audioCtx.createBiquadFilter();
                filter.type = "bandpass";
                filter.frequency.value = frequency;
                filter.Q.value = 0.9;
                const amp = audioCtx.createGain();
                amp.gain.value = gain;
                source.connect(filter).connect(amp).connect(audioCtx.destination);
                source.start(audioCtx.currentTime + when);
            };
            const playShutter = () => {
                if (!soundOn || !audioCtx) return;
                noiseBurst(0, 0.045, 2600, 0.5);   // curtain "ka"
                noiseBurst(0.075, 0.06, 1300, 0.38); // mirror return "chk"
            };

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
                    uBlink: { value: 0 },
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
                    uniform float uBlink;
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
                        col *= 1.0 - uBlink * 0.92; // viewfinder blackout while the mirror/shutter fires

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
                {
                    const w = window.innerWidth, h = window.innerHeight;
                    if (w < 760) camera.setViewOffset(w, h, 0, h * 0.16, w, h); // lens rides in the upper half on phones
                    else camera.clearViewOffset();
                }
                camera.updateProjectionMatrix();
                const mobile = window.innerWidth < 760;
                if (mobile !== wasMobile) {
                    wasMobile = mobile;
                    layoutCards();
                }
                sizeBuffers();
                measure();
                updateScroll();
            };

            window.addEventListener("pointermove", (event) => {
                pointer.tx = (event.clientX / window.innerWidth) * 2 - 1;
                pointer.ty = -((event.clientY / window.innerHeight) * 2 - 1);
            }, { passive: true });

            /* ---------- Render loop ---------- */
            const forward = new THREE.Vector3();
            const toCard = new THREE.Vector3();
            let clickSide = null;

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
                camera.getWorldDirection(forward);
                camera.translateX(pointer.x * 0.16);
                camera.translateY(pointer.y * 0.09);
                const clickShake = bump(p, clickP, 0.02);
                camera.rotateZ(Math.sin(elapsed * 0.31) * 0.004 + clickShake * (Math.sin(elapsed * 47) + Math.sin(elapsed * 71)) * 0.0035);
                camera.rotateX(Math.sin(elapsed * 0.23) * 0.002 + clickShake * Math.sin(elapsed * 53) * 0.003);
                camera.fov = baseFov() + velocity * 2.5 + bump(p, clickP, 0.012) * 1.2;
                camera.updateProjectionMatrix();
                camLight.position.copy(camPoint);

                // Shutter: armed -> wind-up (blades stop down) -> click -> snap open with overshoot
                let aperture;
                if (p < preStart) {
                    const armed = smooth(clamp((p - (preStart - 0.05)) / 0.05, 0, 1));
                    aperture = IRIS_D0 + Math.sin(elapsed * 2.2) * 0.012 * (1 - armed);
                } else if (p < clickP) {
                    aperture = lerp(IRIS_D0, 0, smooth(clamp((p - preStart) / (clickP - preStart), 0, 1)));
                } else {
                    aperture = lerp(0, IRIS_MAX, easeOutBack(clamp((p - clickP) / openLength, 0, 1)));
                }
                const theta = setIris(aperture);
                const openness = clamp(aperture / IRIS_MAX, 0, 1);

                driveRing.rotation.z = -theta * 0.9;
                focusRing.rotation.z = -theta * 1.6 + Math.sin(elapsed * 0.2) * 0.008;

                const glassFade = 1 - smooth(clamp((p - (clickP + 0.02)) / 0.12, 0, 1));
                glassMaterial.opacity = 0.6 * glassFade;
                lensGlass.visible = glassFade > 0.01;
                glowRingMaterial.emissiveIntensity = 1.1 + bump(p, clickP, 0.03) * 2.2;

                const throughLens = 1 - smooth(clamp((p - (lensP - 0.1)) / 0.1, 0, 1));
                apertureGlow.visible = throughLens > 0.01 && aperture > 0.02;
                apertureGlow.scale.setScalar(aperture * 1.15 + 0.2);
                apertureGlow.material.opacity = (0.35 + 0.65 * bump(p, clickP + 0.03, 0.08)) * Math.min(1, openness * 1.6 + 0.1) * throughLens;

                // Click: viewfinder blackout, then flash + flare; a second bloom as the camera passes through the opening
                const click = bump(p, clickP, 0.02);
                const blink = bump(p, clickP - 0.014, 0.007);
                const pass = bump(p, lensP, 0.025);
                const flareAmount = clamp(click * 0.9 + pass, 0, 1);
                flareSprites.forEach((sprite) => {
                    sprite.visible = flareAmount > 0.01;
                    sprite.material.opacity = flareAmount * sprite.userData.base;
                });
                compositeMaterial.uniforms.uFlash.value = click * 0.55 + pass * 0.3;
                compositeMaterial.uniforms.uBlink.value = blink;

                const side = p >= clickP;
                if (clickSide !== null && side !== clickSide) {
                    playShutter();
                    story.dispatchEvent(new CustomEvent("cinematic:shutter", { detail: { direction: side ? "open" : "close" } }));
                }
                clickSide = side;

                lens.rotation.z = p * 0.18 + Math.sin(elapsed * 0.12) * 0.02;
                lens.rotation.y = Math.sin(elapsed * 0.16) * 0.03;
                lens.updateMatrixWorld(true);
                invLens.value.copy(lens.matrixWorld).invert();

                // Gallery: float, parallax, and "pull focus" onto the frame the camera is approaching
                let bestIndex = -1;
                let bestFocus = 0.35;
                cardList.forEach((card) => {
                    const u = card.userData;
                    toCard.subVectors(card.position, camPoint);
                    const ahead = toCard.dot(forward);
                    const target = bump(ahead, u.focusAt, u.focusWidth);
                    u.focus += (target - u.focus) * (1 - Math.exp(-dt * 6));
                    if (u.loaded) u.reveal = Math.min(1, u.reveal + dt * 1.2);
                    const f = smooth(clamp(u.focus, 0, 1));
                    if (u.focus > bestFocus) { bestFocus = u.focus; bestIndex = u.index; }

                    card.position.y = u.baseY + Math.sin(elapsed * 0.55 + u.floatOffset) * 0.035;
                    card.rotation.set(
                        u.baseRot.x - pointer.y * 0.035 * f,
                        u.baseRot.y + Math.sin(elapsed * 0.17 + u.floatOffset) * 0.03 + pointer.x * 0.07 * f,
                        u.baseRot.z,
                    );
                    card.scale.setScalar(u.baseScale * (1 + f * 0.06));

                    const dim = 0.32 + 0.68 * f;
                    if (u.photoMat.map) u.photoMat.color.setScalar(dim * u.reveal);
                    u.overlayMat.color.setScalar(0.45 + 0.55 * f);
                    u.haloMat.opacity = f * 0.4 * u.reveal;
                    const lock = smooth(clamp((u.focus - 0.5) / 0.4, 0, 1));
                    u.afMat.opacity = lock * (0.78 + 0.22 * Math.sin(elapsed * 5 + u.floatOffset));
                    u.brackets.scale.setScalar(lerp(1.14, 1, lock));
                });
                if (bestIndex !== activeFrame) {
                    activeFrame = bestIndex;
                    story.dataset.activeFrame = String(activeFrame + 1);
                    story.dispatchEvent(new CustomEvent("cinematic:frame", { detail: { index: activeFrame } }));
                }

                filmTexture.offset.x = -p * 14;
                dust.rotation.z = elapsed * 0.006;
                bokeh.rotation.y = elapsed * 0.01;
                bokehMat.size = 0.7 + velocity * 0.5;
                bokehMat.opacity = 0.3 + bump(p, clickP, 0.03) * 0.3;
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
            story.classList.add("webgl-ready");
            document.documentElement.classList.add("webgl-ready");

            // Photos load after first paint so the lens appears immediately, then fade in as they arrive.
            const startLoading = () => cardList.forEach(loadCard);
            if ("requestIdleCallback" in window) window.requestIdleCallback(startLoading, { timeout: 1500 });
            else window.setTimeout(startLoading, 300);
        }
        }).catch((error) => {
            story.classList.add("is-static");
            console.error("The Three.js scene could not load; the photo story remains available.", error);
        });
    }
}