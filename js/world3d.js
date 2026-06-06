/* ============================================================================
 *  PROJECT     : Fuzzy Racers: AI Racing Game (3D conversion)
 *  SUBJECT     : ISP568 Fuzzy Logic Systems
 *  FILE        : world3d.js
 *  DESCRIPTION : Three.js-based 3D world renderer. Replaces the old top-down
 *                Canvas-2D camera with a proper chase-cam 3D scene built
 *                from the same buildTrackGeometry() output.
 *
 *  COORD MAPPING
 *  -------------
 *      game 2D (x, y)         → world 3D (x, 0, y)
 *      game heading angle θ   → mesh.rotation.y = -θ
 *      Y axis                 = up
 *
 *  ARCHITECTURE
 *  ------------
 *  World3D.init(canvas, geom, cars, player)
 *      Build the scene once:
 *        - off-track ground plane
 *        - road ribbon (one BufferGeometry mesh from the geom's outer/inner)
 *        - curbs (thin raised ribbons just outside the road)
 *        - start/finish chequered tiles
 *        - one Group per Car (body + cockpit + wheels + lights)
 *      Powerup-box meshes are created lazily inside render().
 *
 *  World3D.render()
 *      Each frame:
 *        - sync car-mesh positions/rotations from each Car
 *        - sync powerup-box meshes (lazy create / remove on collect)
 *        - chase camera lerps to a target behind+above the player and
 *          looks at a point slightly in front of the player
 *        - WebGL renders the scene
 *
 *  Cars stay logically 2D: physics, AI, lap accounting are all unchanged.
 *  Only rendering changes.
 * ============================================================================ */

const World3D = {
    // Scene graph
    canvas: null,
    scene: null,
    renderer: null,
    camera: null,

    // Game refs
    track: null,
    cars: [],
    player: null,

    // Per-entity meshes
    carMeshes: null,             // Map<Car, THREE.Group>
    powerupMeshes: null,         // Map<PowerupBox, THREE.Group>
    projectileMeshes: null,      // Map<Projectile, THREE.Group>
    oilSlickMeshes: null,        // Map<OilSlick, THREE.Mesh>
    visualEffectMeshes: null,    // Map<effect, THREE.Mesh|Group>

    // Particle pool: grows as needed
    particlePool: null,
    _dotTexture: null,

    // Chase-cam smoothing state
    _camTargetPos: null,
    _camTargetLook: null,

    // ============================================================
    // SECTION: Init
    // ============================================================

    init(canvas, trackGeom, cars, player) {
        this.canvas = canvas;
        this.track = trackGeom;
        this.cars = cars;
        this.player = player;
        this.carMeshes = new Map();
        this.powerupMeshes = new Map();
        this.projectileMeshes = new Map();
        this.oilSlickMeshes = new Map();
        this.visualEffectMeshes = new Map();
        this.particlePool = [];
        this._dotTexture = this._makeDotTexture();

        // ---- Renderer ----
        this.renderer = new THREE.WebGLRenderer({
            canvas, antialias: true, alpha: false
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight, false);
        this.renderer.outputEncoding = THREE.sRGBEncoding;

        // ---- Scene + sky/fog (per-track colour) ----
        this.scene = new THREE.Scene();
        const skyColor = trackGeom.id === 'desert'   ? 0xeac98a
                       : trackGeom.id === 'mountain' ? 0x9bc4d6
                       : 0x4a5a7a;
        this.scene.background = new THREE.Color(skyColor);
        this.scene.fog = new THREE.Fog(skyColor, 700, 2400);

        // ---- Camera ----
        this.camera = new THREE.PerspectiveCamera(
            65, window.innerWidth / window.innerHeight, 1, 5000
        );
        this.camera.position.set(player.x - 100, 55, player.y);
        this.camera.lookAt(player.x, 8, player.y);
        this._camTargetPos  = this.camera.position.clone();
        this._camTargetLook = new THREE.Vector3(player.x, 8, player.y);

        // ---- Lights ----
        const sun = new THREE.DirectionalLight(0xffffff, 0.95);
        sun.position.set(800, 1400, 400);
        this.scene.add(sun);
        const ambient = new THREE.AmbientLight(0xffffff, 0.45);
        this.scene.add(ambient);
        const fill = new THREE.DirectionalLight(0x88aaff, 0.20);
        fill.position.set(-400, 600, -300);
        this.scene.add(fill);

        // ---- Off-track ground (huge plane) ----
        const style = trackGeom.style;
        const groundColorHex = style.grass || style.sand || '#0a1a0a';
        const groundGeom = new THREE.PlaneGeometry(6000, 6000, 1, 1);
        const groundMat  = new THREE.MeshLambertMaterial({
            color: new THREE.Color(groundColorHex)
        });
        const ground = new THREE.Mesh(groundGeom, groundMat);
        ground.rotation.x = -Math.PI / 2;
        const cx = (trackGeom.bounds.minX + trackGeom.bounds.maxX) / 2;
        const cz = (trackGeom.bounds.minY + trackGeom.bounds.maxY) / 2;
        ground.position.set(cx, -0.2, cz);
        this.scene.add(ground);

        // ---- Road ribbon ----
        this.scene.add(this._buildRoadMesh(trackGeom));

        // ---- Curbs (raised edges) ----
        this.scene.add(this._buildCurbMesh(trackGeom));

        // ---- Start/finish chequered line ----
        this.scene.add(this._buildStartLine(trackGeom));

        // ---- Lane markings (dashed centerline) ----
        this.scene.add(this._buildLaneMarkings(trackGeom));

        // ---- Red/white striped tiles on the outer curb at sharp corners ----
        this.scene.add(this._buildCornerStripes(trackGeom));

        // ---- Track-themed scenery (buildings / cacti / pine trees) ----
        this.scene.add(this._buildTrackProps(trackGeom));

        // ---- Cars ----
        for (const car of cars) {
            const mesh = this._buildCarMesh(car);
            this.carMeshes.set(car, mesh);
            this.scene.add(mesh);
        }
    },

    // ============================================================
    // SECTION: Geometry builders
    // ============================================================

    /** Road ribbon from outer/inner waypoint pairs. */
    _buildRoadMesh(geom) {
        const { outer, inner, style } = geom;
        const N = outer.length;
        const positions = new Float32Array(N * 2 * 3);
        const indices  = [];
        for (let i = 0; i < N; i++) {
            positions[i * 6 + 0] = outer[i].x;
            positions[i * 6 + 1] = 0.05;
            positions[i * 6 + 2] = outer[i].y;
            positions[i * 6 + 3] = inner[i].x;
            positions[i * 6 + 4] = 0.05;
            positions[i * 6 + 5] = inner[i].y;
        }
        for (let i = 0; i < N; i++) {
            const a = i * 2;
            const b = i * 2 + 1;
            const c = ((i + 1) % N) * 2;
            const d = ((i + 1) % N) * 2 + 1;
            indices.push(a, b, d, a, d, c);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        g.setIndex(indices);
        g.computeVertexNormals();
        const m = new THREE.MeshLambertMaterial({
            color: new THREE.Color(style.road || '#2a2f44'),
            side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(g, m);
        return mesh;
    },

    /** Two thin raised ribbons on the outer and inner edges of the road. */
    _buildCurbMesh(geom) {
        const { outer, inner, style } = geom;
        const N = outer.length;
        const positions = [];
        const indices = [];
        const curbWidth = 5;
        const elev = 0.35;

        // sign = +1 for outer (push further outside), -1 for inner (further inside)
        const buildSide = (line, sign) => {
            const baseIdx = positions.length / 3;
            const tangents = [];
            for (let i = 0; i < N; i++) {
                const a = line[(i - 1 + N) % N];
                const b = line[(i + 1) % N];
                const tx = b.x - a.x, ty = b.y - a.y;
                const len = Math.hypot(tx, ty) || 1;
                // Lateral normal (perpendicular to tangent)
                tangents.push({ nx: -ty / len * sign, ny: tx / len * sign });
            }
            for (let i = 0; i < N; i++) {
                const p = line[i];
                const t = tangents[i];
                positions.push(p.x,                       elev, p.y);
                positions.push(p.x + t.nx * curbWidth,    elev, p.y + t.ny * curbWidth);
            }
            for (let i = 0; i < N; i++) {
                const a = baseIdx + i * 2;
                const b = baseIdx + i * 2 + 1;
                const c = baseIdx + ((i + 1) % N) * 2;
                const d = baseIdx + ((i + 1) % N) * 2 + 1;
                indices.push(a, b, d, a, d, c);
            }
        };
        buildSide(geom.outer, +1);
        buildSide(geom.inner, -1);

        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        g.setIndex(indices);
        g.computeVertexNormals();
        const m = new THREE.MeshLambertMaterial({
            color: new THREE.Color(style.asphalt || '#1a1d2a'),
            side: THREE.DoubleSide
        });
        return new THREE.Mesh(g, m);
    },

    /** Chequered start/finish tiles laid across the road at waypoint 0. */
    _buildStartLine(geom) {
        const wp = geom.start;
        const halfW = geom.halfRoadWidth;
        const sn = { x: -Math.sin(wp.angle), y: Math.cos(wp.angle) };
        const sq = 12;
        const group = new THREE.Group();
        let idx = 0;
        for (let i = -halfW; i < halfW; i += sq) {
            const cx = wp.x + sn.x * (i + sq / 2);
            const cy = wp.y + sn.y * (i + sq / 2);
            const isWhite = idx % 2 === 0;
            const tg = new THREE.PlaneGeometry(sq, sq * 0.9);
            const tm = new THREE.MeshLambertMaterial({
                color: isWhite ? 0xffffff : 0x0a0d18,
                side: THREE.DoubleSide
            });
            const tile = new THREE.Mesh(tg, tm);
            tile.position.set(cx, 0.10, cy);
            tile.rotation.x = -Math.PI / 2;
            tile.rotation.z = -wp.angle;
            group.add(tile);
            idx++;
        }
        return group;
    },

    /** Dashed white centerline along the track. */
    _buildLaneMarkings(geom) {
        const group = new THREE.Group();
        const wps = geom.waypoints;
        const N = wps.length;
        // Every other waypoint, a small white tile aligned with the tangent.
        for (let i = 0; i < N; i += 2) {
            const wp = wps[i];
            const g = new THREE.PlaneGeometry(14, 2.5);
            const m = new THREE.MeshLambertMaterial({
                color: 0xffffff, transparent: true, opacity: 0.65,
                side: THREE.DoubleSide
            });
            const tile = new THREE.Mesh(g, m);
            tile.position.set(wp.x, 0.08, wp.y);
            tile.rotation.x = -Math.PI / 2;
            tile.rotation.z = -wp.tangent;
            group.add(tile);
        }
        return group;
    },

    // Per-chassis 3D body dimensions (length along X, width along Z, height,
    // nose/tail taper). Mirrors the 2D baseDims in car.js (drawCarTopDown),
    // scaled ~0.76× so the footprint matches the old fixed 64×30 box, so the
    // 3D silhouette reads like the garage's top-down preview.
    _shapeDims: {
        sedan:   { L: 64, W: 30, H: 14, nose: 0.55, tail: 0.55 },
        muscle:  { L: 70, W: 33, H: 15, nose: 0.45, tail: 0.65 },
        compact: { L: 54, W: 29, H: 14, nose: 0.55, tail: 0.55 },
        truck:   { L: 73, W: 38, H: 17, nose: 0.55, tail: 0.40 },
        wedge:   { L: 69, W: 28, H: 12, nose: 0.30, tail: 0.70 },
        coupe:   { L: 66, W: 30, H: 13, nose: 0.50, tail: 0.60 }
    },

    /** Resolve the chassis shape + body-kit into final body dimensions. */
    _carDims(car) {
        const shape = car._shape ||
            (typeof getCarById === 'function' ? (getCarById(car.id) || {}).shape : null) ||
            'sedan';
        const base = this._shapeDims[shape] || this._shapeDims.sedan;
        const dims = Object.assign({ shape }, base);
        // Stealth (low-profile) kit: narrower + lower, sharper nose: same
        // tweak the 2D renderer applies.
        const kitVisual = (typeof getBodyKit === 'function')
            ? getBodyKit((car.customization || {}).bodyKit).visual
            : 'stock';
        dims.kit = kitVisual;
        if (kitVisual === 'lowprofile') {
            dims.W *= 0.85;
            dims.H *= 0.78;
            dims.nose = Math.max(0.2, dims.nose - 0.15);
        }
        return dims;
    },

    /** Build the body geometry by extruding the same top-down silhouette the
     *  2D garage uses, then orienting it so length→X, width→Z, height→Y. */
    _buildCarBodyGeometry(dims) {
        const hl = dims.L / 2, hw = dims.W / 2;
        const nose = dims.nose, tail = dims.tail;
        // Shape plane: x = forward, y = lateral (matches drawCarSilhouette).
        const s = new THREE.Shape();
        s.moveTo(-hl, -hw + 2);
        s.lineTo(-hl + hl * tail * 0.3, -hw);
        s.lineTo( hl - hl * nose * 0.3, -hw);
        s.quadraticCurveTo(hl, -hw, hl, -hw + 4);
        s.lineTo( hl,  hw - 4);
        s.quadraticCurveTo(hl,  hw, hl - hl * nose * 0.3,  hw);
        s.lineTo(-hl + hl * tail * 0.3,  hw);
        s.lineTo(-hl,  hw - 2);
        s.closePath();
        const geom = new THREE.ExtrudeGeometry(s, {
            depth: dims.H, bevelEnabled: true,
            bevelThickness: 1.5, bevelSize: 1.2, bevelSegments: 1, steps: 1
        });
        // Extrude builds in XY extruded along +Z; rotate so +Z (height)→+Y.
        geom.rotateX(-Math.PI / 2);
        return geom;
    },

    /** A car whose 3D look reflects the garage choices: chassis shape (body
     *  silhouette + proportions), body kit (aero wing / armored sidebars /
     *  stealth low-profile), pattern (stripes / flame / camo), and the
     *  paint + accent colours. */
    _buildCarMesh(car) {
        const group = new THREE.Group();
        const carData = (typeof getCarById === 'function') ? getCarById(car.id) : null;
        const cust = car.customization || {};
        const paint   = cust.paint   || (carData && carData.paint)  || '#00eaff';
        const accent  = cust.accent  || (carData && carData.accent) || '#ffffff';
        const pattern = cust.pattern || 'stripes';
        const dims = this._carDims(car);
        const hl = dims.L / 2, hw = dims.W / 2;
        const baseY = 4;                 // body sits this high; wheels peek below
        // The extruded body has a ~1.5-unit bevel on top, so its real top
        // surface is dims.H + ~2 above baseY. Account for it here so the
        // cockpit, pattern decal, roof strip, and FX sit ON the body, not
        // buried inside it.
        const topY  = baseY + dims.H + 2;

        // Soft contact-shadow (sized to the chassis footprint).
        const shadow = new THREE.Mesh(
            new THREE.PlaneGeometry(dims.L * 1.12, dims.W * 1.25),
            new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false })
        );
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.y = 0.18;
        group.add(shadow);

        // Body: extruded chassis silhouette in the paint colour.
        const bodyMat = new THREE.MeshLambertMaterial({
            color: new THREE.Color(paint),
            emissive: new THREE.Color(paint),
            emissiveIntensity: 0.08
        });
        const body = new THREE.Mesh(this._buildCarBodyGeometry(dims), bodyMat);
        body.position.y = baseY;
        group.add(body);

        // Cockpit (dark glass), scaled to the chassis and set slightly rearward.
        const cockpit = new THREE.Mesh(
            new THREE.BoxGeometry(dims.L * 0.34, 9, dims.W * 0.62),
            new THREE.MeshLambertMaterial({ color: 0x0a0d18 })
        );
        cockpit.position.set(-dims.L * 0.04, topY + 3, 0);
        group.add(cockpit);

        // ---- Pattern decal across the top deck (bold + unlit so the paint
        //      job reads clearly from the chase cam, just like the garage). ----
        const patTex = this._makePatternTexture(pattern, accent);
        if (patTex) {
            // Sized to the flat central deck so it doesn't overhang the
            // tapered nose/tail. The texture's u→forward(X), v→lateral(Z).
            const decal = new THREE.Mesh(
                new THREE.PlaneGeometry(dims.L * 0.8, dims.W * 0.84),
                new THREE.MeshBasicMaterial({
                    map: patTex, transparent: true, depthWrite: false,
                    polygonOffset: true, polygonOffsetFactor: -2
                })
            );
            decal.rotation.x = -Math.PI / 2;   // lay flat: local X→X, local Y→Z
            decal.position.set(0, topY + 0.6, 0);
            group.add(decal);
        }

        // ---- Wheels ----
        const wheelGeom = new THREE.CylinderGeometry(5.5, 5.5, 5, 16);
        const wheelMat  = new THREE.MeshLambertMaterial({ color: 0x0a0c14 });
        const axleX = hl * 0.58, axleZ = hw + 0.5;
        for (const [x, z] of [[axleX, axleZ], [axleX, -axleZ], [-axleX, axleZ], [-axleX, -axleZ]]) {
            const w = new THREE.Mesh(wheelGeom, wheelMat);
            w.position.set(x, 5, z);
            w.rotation.x = Math.PI / 2;
            group.add(w);
        }

        // ---- Lights ----
        const lampGeom = new THREE.BoxGeometry(2, 3, 5);
        const lampY = baseY + dims.H * 0.4;
        const headMat = new THREE.MeshBasicMaterial({ color: 0xfff8b0 });
        const tailMat = new THREE.MeshBasicMaterial({ color: 0xff3355 });
        for (const z of [hw * 0.6, -hw * 0.6]) {
            const h = new THREE.Mesh(lampGeom, headMat); h.position.set(hl - 1, lampY, z); group.add(h);
            const t = new THREE.Mesh(lampGeom, tailMat); t.position.set(-hl + 1, lampY, z * 0.92); group.add(t);
        }

        // ---- Body-kit add-ons ----
        this._addBodyKit(group, dims.kit, accent, dims, baseY, topY);

        // ---- Hidden FX children, sized/positioned from the chassis dims ----
        const reach = Math.max(dims.L, dims.W);
        const shield = new THREE.Mesh(
            new THREE.SphereGeometry(reach * 0.62, 24, 16),
            new THREE.MeshBasicMaterial({ color: 0x00eaff, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide })
        );
        shield.position.set(0, topY * 0.6, 0);
        shield.visible = false;
        group.add(shield);

        const boostFlame = new THREE.Mesh(
            new THREE.ConeGeometry(7, 28, 12),
            new THREE.MeshBasicMaterial({ color: 0xff3355, transparent: true, opacity: 0.85 })
        );
        boostFlame.rotation.z = Math.PI / 2;
        boostFlame.position.set(-hl - 12, baseY + 2, 0);
        boostFlame.visible = false;
        group.add(boostFlame);

        const nitroFlame = new THREE.Mesh(
            new THREE.ConeGeometry(8, 38, 12),
            new THREE.MeshBasicMaterial({ color: 0x00eaff, transparent: true, opacity: 0.9 })
        );
        nitroFlame.rotation.z = Math.PI / 2;
        nitroFlame.position.set(-hl - 18, baseY + 2, 0);
        nitroFlame.visible = false;
        group.add(nitroFlame);

        const stunRing = new THREE.Mesh(
            new THREE.TorusGeometry(reach * 0.42, 1.4, 6, 32),
            new THREE.MeshBasicMaterial({ color: 0xa479ff, transparent: true, opacity: 0.7 })
        );
        stunRing.rotation.x = Math.PI / 2;
        stunRing.position.y = topY;
        stunRing.visible = false;
        group.add(stunRing);

        group.userData = {
            car, body, bodyMat, cockpit,
            originalPaint: new THREE.Color(paint),
            shield, boostFlame, nitroFlame, stunRing
        };
        return group;
    },

    /** Build a CanvasTexture of the paint-job pattern (accent on transparent)
     *  for the body-top decal. Texture u→forward(X), v→lateral(Z). Returns
     *  null for 'solid' (no decal). Mirrors the garage's pattern motifs so the
     *  in-race car matches the customisation preview. */
    _makePatternTexture(pattern, accent) {
        if (!pattern || pattern === 'solid') return null;
        const W = 256, H = 128;
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = accent;
        ctx.strokeStyle = accent;

        if (pattern === 'stripes') {
            // Two bold racing stripes running front↔back (along u).
            ctx.globalAlpha = 0.95;
            ctx.fillRect(0, H * 0.30, W, H * 0.12);
            ctx.fillRect(0, H * 0.58, W, H * 0.12);
        } else if (pattern === 'flame') {
            // Flame licking back from the nose (u = 1 / right edge = front).
            ctx.globalAlpha = 0.95;
            const tongue = (x0, spread, tip) => {
                ctx.beginPath();
                ctx.moveTo(W * tip, H * 0.5);
                ctx.lineTo(W * x0,  H * (0.5 - spread));
                ctx.lineTo(W * (x0 + 0.12), H * 0.5);
                ctx.lineTo(W * x0,  H * (0.5 + spread));
                ctx.closePath();
                ctx.fill();
            };
            tongue(0.30, 0.42, 1.0);
            tongue(0.10, 0.26, 0.72);
        } else if (pattern === 'camo') {
            const blobs = [[0.22, 0.30], [0.48, 0.62], [0.70, 0.34], [0.40, 0.50], [0.82, 0.70], [0.15, 0.64]];
            ctx.globalAlpha = 0.65;
            for (const [bx, by] of blobs) {
                ctx.beginPath(); ctx.ellipse(bx * W, by * H, 24, 17, 0, 0, Math.PI * 2); ctx.fill();
            }
            ctx.globalAlpha = 0.45;
            ctx.fillStyle = '#0b0e1a';
            for (const [bx, by] of [[0.35, 0.46], [0.64, 0.54], [0.55, 0.30], [0.78, 0.5]]) {
                ctx.beginPath(); ctx.ellipse(bx * W, by * H, 16, 12, 0, 0, Math.PI * 2); ctx.fill();
            }
        }
        ctx.globalAlpha = 1;

        const tex = new THREE.CanvasTexture(c);
        tex.minFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        return tex;
    },

    /** Body-kit hardware: aero rear wing, armored side bars, or stealth top
     *  accent. Stock adds nothing (the low-profile silhouette is in dims). */
    _addBodyKit(group, kit, accent, dims, baseY, topY) {
        const hl = dims.L / 2, hw = dims.W / 2;
        if (kit === 'spoiler') {
            const dark = new THREE.MeshLambertMaterial({ color: 0x1c2138 });
            const acc  = new THREE.MeshLambertMaterial({
                color: new THREE.Color(accent), emissive: new THREE.Color(accent), emissiveIntensity: 0.2
            });
            // Two posts at the tail
            for (const z of [hw * 0.55, -hw * 0.55]) {
                const post = new THREE.Mesh(new THREE.BoxGeometry(3, 8, 3), dark);
                post.position.set(-hl + 4, topY + 4, z);
                group.add(post);
            }
            // Wing blade spanning the width
            const wing = new THREE.Mesh(new THREE.BoxGeometry(8, 2, dims.W * 1.25), acc);
            wing.position.set(-hl + 4, topY + 8, 0);
            group.add(wing);
        } else if (kit === 'sidebars') {
            const barMat = new THREE.MeshLambertMaterial({ color: 0x2a2f44 });
            for (const z of [hw + 2.5, -(hw + 2.5)]) {
                const bar = new THREE.Mesh(new THREE.BoxGeometry(dims.L * 0.7, 5, 4), barMat);
                bar.position.set(0, baseY + 3, z);
                group.add(bar);
            }
        } else if (kit === 'lowprofile') {
            // Thin matte accent strip along the roofline.
            const strip = new THREE.Mesh(
                new THREE.BoxGeometry(dims.L * 0.7, 0.6, 2),
                new THREE.MeshLambertMaterial({ color: new THREE.Color(accent), emissive: new THREE.Color(accent), emissiveIntensity: 0.12 })
            );
            strip.position.set(0, topY + 0.4, 0);
            group.add(strip);
        }
        // 'stock' → nothing
    },

    /** Generate a soft radial-gradient dot texture for billboarded particles. */
    _makeDotTexture() {
        const size = 64;
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const ctx = c.getContext('2d');
        const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
        g.addColorStop(0,    'rgba(255,255,255,1)');
        g.addColorStop(0.4,  'rgba(255,255,255,0.7)');
        g.addColorStop(1,    'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
        const tex = new THREE.CanvasTexture(c);
        tex.minFilter = THREE.LinearFilter;
        return tex;
    },

    /** A missile: small body cylinder + nose cone + back flame, no homing
     *  geometry: position is synced each frame from the Projectile. */
    _buildProjectileMesh(proj) {
        const group = new THREE.Group();

        // Body
        const bodyGeom = new THREE.CylinderGeometry(2.4, 2.4, 14, 12);
        const bodyMat  = new THREE.MeshLambertMaterial({ color: 0xdadada });
        const body = new THREE.Mesh(bodyGeom, bodyMat);
        body.rotation.z = Math.PI / 2;  // cylinder default Y → rotate so length is X
        group.add(body);

        // Nose (red cone in +X direction)
        const noseGeom = new THREE.ConeGeometry(2.4, 5, 12);
        const noseMat  = new THREE.MeshLambertMaterial({
            color: 0xff3355, emissive: 0xff3355, emissiveIntensity: 0.4
        });
        const nose = new THREE.Mesh(noseGeom, noseMat);
        nose.rotation.z = -Math.PI / 2;
        nose.position.x = 9.5;
        group.add(nose);

        // Tail flame
        const flameGeom = new THREE.ConeGeometry(3, 10, 10);
        const flameMat  = new THREE.MeshBasicMaterial({
            color: 0xffd400, transparent: true, opacity: 0.9
        });
        const flame = new THREE.Mesh(flameGeom, flameMat);
        flame.rotation.z = Math.PI / 2;
        flame.position.x = -12;
        group.add(flame);

        return group;
    },

    /** An oil slick: dark elliptical decal on the ground at the slick's
     *  position. Opacity ramps down as it ages. */
    _buildOilSlickMesh(slick) {
        const r = slick.radius || 22;
        const geom = new THREE.CircleGeometry(r * 1.2, 24);
        const mat  = new THREE.MeshBasicMaterial({
            color: 0x121212, transparent: true, opacity: 0.85, depthWrite: false
        });
        const mesh = new THREE.Mesh(geom, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.15;
        return mesh;
    },

    /** A visual effect mesh: currently EMP (expanding ring) or tornado
     *  (rotating funnel around a target car). */
    _buildVisualEffectMesh(effect) {
        if (effect.type === 'emp') {
            const geom = new THREE.RingGeometry(2, 4, 36);
            const mat  = new THREE.MeshBasicMaterial({
                color: 0xa479ff, transparent: true, opacity: 0.8,
                side: THREE.DoubleSide, depthWrite: false
            });
            const mesh = new THREE.Mesh(geom, mat);
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.set(effect.x, 4, effect.y);
            return mesh;
        }
        if (effect.type === 'tornado') {
            // Spinning open cone (point-down) above the target
            const geom = new THREE.ConeGeometry(18, 60, 16, 1, true);
            const mat  = new THREE.MeshBasicMaterial({
                color: 0x88ddff, transparent: true, opacity: 0.45,
                side: THREE.DoubleSide, depthWrite: false, wireframe: true
            });
            const mesh = new THREE.Mesh(geom, mat);
            return mesh;
        }
        return null;
    },

    /** Powerup crate: floating octahedron, glow colour matches type. */
    _buildPowerupMesh(box) {
        const t = getPowerupType(box.type);
        const colorHex = (t && t.color) || '#ffffff';
        const group = new THREE.Group();

        const crateGeom = new THREE.OctahedronGeometry(14);
        const crateMat  = new THREE.MeshLambertMaterial({
            color: new THREE.Color(colorHex),
            emissive: new THREE.Color(colorHex),
            emissiveIntensity: 0.55,
            transparent: true,
            opacity: 0.9
        });
        const crate = new THREE.Mesh(crateGeom, crateMat);
        crate.position.y = 22;
        group.add(crate);

        // Halo ring around the base
        const ringGeom = new THREE.RingGeometry(14, 22, 32);
        const ringMat  = new THREE.MeshBasicMaterial({
            color: new THREE.Color(colorHex),
            transparent: true,
            opacity: 0.35,
            side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.5;
        group.add(ring);

        return group;
    },

    // ============================================================
    // SECTION: Per-frame update + render
    // ============================================================

    render() {
        const now = performance.now();

        // ---- Cars (position + rotation + per-car FX overlay) ----
        for (const car of this.cars) {
            const mesh = this.carMeshes.get(car);
            if (!mesh) continue;
            mesh.position.x = car.x;
            mesh.position.z = car.y;
            mesh.rotation.y = -car.angle;

            // Wrecked: tilt + shift colour toward charred grey
            if (car.exploded) {
                const t = (now - car.explodedAt) / 1000;
                mesh.position.y = 0;
                mesh.rotation.x = Math.sin(now / 220) * 0.04;
                mesh.rotation.z = Math.cos(now / 240) * 0.04;
                const bodyMat = mesh.userData.bodyMat;
                if (bodyMat) {
                    bodyMat.color.setHex(0x3a3030);
                    bodyMat.emissive.setHex(t < 2 ? 0xff6611 : 0x000000);
                    bodyMat.emissiveIntensity = t < 2 ? (0.5 * (1 - t / 2)) : 0;
                }
            } else {
                mesh.position.y = 0;
                mesh.rotation.x = 0;
                mesh.rotation.z = 0;
            }

            this._syncCarFX(car, mesh, now);
        }

        // ---- Powerup boxes (lazy add, remove on collect) ----
        const seen = new Set();
        if (typeof PowerupManager !== 'undefined' && PowerupManager.boxes) {
            for (const box of PowerupManager.boxes) {
                if (box.collected) continue;
                seen.add(box);
                let m = this.powerupMeshes.get(box);
                if (!m) {
                    m = this._buildPowerupMesh(box);
                    this.powerupMeshes.set(box, m);
                    this.scene.add(m);
                }
                m.position.x = box.x;
                m.position.z = box.y;
                // Spin the crate
                const crate = m.children[0];
                if (crate) {
                    crate.rotation.y = box.rotation;
                    crate.rotation.x = box.rotation * 0.7;
                    crate.position.y = 22 + Math.sin(now / 240 + box.x * 0.01) * 2.5;
                }
            }
        }
        for (const [box, mesh] of this.powerupMeshes) {
            if (!seen.has(box)) {
                this.scene.remove(mesh);
                this.powerupMeshes.delete(box);
            }
        }

        // ---- Projectiles / oil slicks / visual effects / particles ----
        this._syncProjectiles(now);
        this._syncOilSlicks(now);
        this._syncVisualEffects(now);
        this._syncParticles(now);

        // ---- Chase camera ----
        const p = this.player;
        const cosA = Math.cos(p.angle);
        const sinA = Math.sin(p.angle);
        // Distance back grows a bit with speed → arcade feel
        const spd = Math.min(1, p.speed / Math.max(1, p.maxSpeed));
        const camDist   = 95 + spd * 30;
        const camHeight = 50 + spd * 10;
        const tx = p.x - cosA * camDist;
        const tz = p.y - sinA * camDist;
        // Smoothly approach camera target
        this._camTargetPos.set(tx, camHeight, tz);
        this.camera.position.lerp(this._camTargetPos, 0.18);
        // Look slightly ahead of the player
        const lookAhead = 30;
        const lookTarget = new THREE.Vector3(
            p.x + cosA * lookAhead,
            10,
            p.y + sinA * lookAhead
        );
        this._camTargetLook.lerp(lookTarget, 0.22);
        this.camera.lookAt(this._camTargetLook);

        // ---- Render ----
        this.renderer.render(this.scene, this.camera);
    },

    // ============================================================
    // SECTION: Scenery (corner stripes, per-track props)
    // ============================================================

    /** Red/white curb stripe tiles on the outer edge at sharp waypoints.
     *  Visual cue that mirrors real-world corner kerbs. */
    _buildCornerStripes(geom) {
        const group = new THREE.Group();
        const N = geom.waypoints.length;
        for (let i = 0; i < N; i++) {
            const wp = geom.waypoints[i];
            if ((wp.sharpness || 0) < 22) continue;   // straights → skip
            const nx = -Math.sin(wp.tangent);
            const ny =  Math.cos(wp.tangent);
            const off = geom.halfRoadWidth + 2.5;
            const px = wp.x + nx * off;
            const pz = wp.y + ny * off;
            const isWhite = i % 2 === 0;
            const tile = new THREE.Mesh(
                new THREE.BoxGeometry(7, 0.6, 5),
                new THREE.MeshLambertMaterial({
                    color: isWhite ? 0xffffff : 0xff3355
                })
            );
            tile.position.set(px, 0.5, pz);
            tile.rotation.y = -wp.tangent;
            group.add(tile);

            // Mirror on the inner edge too
            const ipx = wp.x - nx * off;
            const ipz = wp.y - ny * off;
            const tile2 = new THREE.Mesh(tile.geometry, tile.material);
            tile2.position.set(ipx, 0.5, ipz);
            tile2.rotation.y = -wp.tangent;
            group.add(tile2);
        }
        return group;
    },

    /** Deterministic PRNG used by prop placement so each track has a stable
     *  scenery layout. Seeded by trackId so city / desert / mountain each
     *  get their own consistent layout. */
    _makeRng(seed) {
        let s = seed | 0;
        return () => {
            s = (s * 9301 + 49297) | 0;
            s = ((s % 233280) + 233280) % 233280;
            return s / 233280;
        };
    },

    /** Scatter props in the off-track area outside the road. Props use
     *  per-track types: buildings (city), cacti (desert), pine trees
     *  (mountain). Safe-distance check skips any candidate too close to the
     *  road centerline. */
    _buildTrackProps(geom) {
        const group = new THREE.Group();
        const rand = this._makeRng(
            geom.id === 'city' ? 71013 :
            geom.id === 'desert' ? 42089 :
            91077
        );

        const b = geom.bounds;
        const pad = 220;
        const minX = b.minX - pad, maxX = b.maxX + pad;
        const minZ = b.minY - pad, maxZ = b.maxY + pad;
        const safe = geom.halfRoadWidth + 38;

        // Sample N candidate points, place a prop if it's far enough from the road.
        const SAMPLES = geom.id === 'city' ? 240 : 200;
        let placed = 0;
        for (let i = 0; i < SAMPLES; i++) {
            const x = minX + rand() * (maxX - minX);
            const z = minZ + rand() * (maxZ - minZ);
            // Distance to nearest waypoint
            let nearest = Infinity;
            for (const wp of geom.waypoints) {
                const dx = wp.x - x, dz = wp.y - z;
                const d2 = dx * dx + dz * dz;
                if (d2 < nearest) nearest = d2;
            }
            if (Math.sqrt(nearest) < safe) continue;

            let prop;
            if (geom.id === 'city')          prop = this._buildBuildingProp(rand);
            else if (geom.id === 'desert')   prop = this._buildCactusProp(rand);
            else if (geom.id === 'mountain') prop = this._buildPineProp(rand);
            if (!prop) continue;
            prop.position.set(x, 0, z);
            prop.rotation.y = rand() * Math.PI * 2;
            group.add(prop);
            placed++;
        }
        return group;
    },

    /** Boxy city building with a couple of lit windows on the front face. */
    _buildBuildingProp(rand) {
        const w = 26 + rand() * 36;
        const d = 26 + rand() * 36;
        const h = 70 + rand() * 180;
        const palette = [0x232a38, 0x2a3045, 0x363c52, 0x1f2435, 0x3a4055];
        const baseColor = palette[Math.floor(rand() * palette.length)];
        const mat = new THREE.MeshLambertMaterial({ color: baseColor });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        mesh.position.y = h / 2;

        // A few lit windows on one face random pattern, warm colour.
        const group = new THREE.Group();
        group.add(mesh);
        const winRows = Math.floor(h / 16);
        const winCols = Math.floor(w / 8);
        const winColor = rand() > 0.6 ? 0xffd400 : 0xfff8b0;
        for (let r = 1; r < winRows - 1; r++) {
            for (let c = 1; c < winCols; c++) {
                if (rand() > 0.55) continue;
                const wg = new THREE.PlaneGeometry(2.5, 3);
                const wm = new THREE.MeshBasicMaterial({ color: winColor });
                const win = new THREE.Mesh(wg, wm);
                win.position.set(
                    -w / 2 + c * 8,
                    r * 16,
                    d / 2 + 0.05
                );
                group.add(win);
            }
        }
        return group;
    },

    /** Saguaro-style cactus: trunk + 0-2 arms. */
    _buildCactusProp(rand) {
        const group = new THREE.Group();
        const h = 22 + rand() * 36;
        const r = 3 + rand() * 2;
        const greens = [0x2d5a2d, 0x356b35, 0x254525];
        const mat = new THREE.MeshLambertMaterial({
            color: greens[Math.floor(rand() * greens.length)]
        });
        const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(r, r * 1.15, h, 8),
            mat
        );
        trunk.position.y = h / 2;
        group.add(trunk);
        // Rounded cap
        const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat);
        cap.position.y = h;
        group.add(cap);

        // 0-2 arms
        const arms = Math.floor(rand() * 3);
        for (let i = 0; i < arms; i++) {
            const armH = h * (0.4 + rand() * 0.3);
            const armR = r * 0.78;
            const arm = new THREE.Mesh(
                new THREE.CylinderGeometry(armR, armR, armH, 8),
                mat
            );
            const side = rand() > 0.5 ? 1 : -1;
            arm.position.set(side * (r + armR), h * (0.55 + rand() * 0.15), 0);
            // Bend out then up: represented by 2 rotated segments would be
            // overkill; one rotated arm is fine.
            arm.rotation.z = side * (Math.PI / 5);
            group.add(arm);
        }
        return group;
    },

    /** Conifer pine: brown trunk + stacked green cones. */
    _buildPineProp(rand) {
        const group = new THREE.Group();
        const trunkH = 10 + rand() * 8;
        const trunkR = 2 + rand() * 1.5;
        const trunk = new THREE.Mesh(
            new THREE.CylinderGeometry(trunkR, trunkR * 1.3, trunkH, 6),
            new THREE.MeshLambertMaterial({ color: 0x4a2f1a })
        );
        trunk.position.y = trunkH / 2;
        group.add(trunk);

        const foliage = new THREE.MeshLambertMaterial({
            color: rand() > 0.5 ? 0x2a4a2a : 0x356b35
        });
        const layers = 3;
        const baseR = 9 + rand() * 6;
        const layerH = 12 + rand() * 6;
        for (let i = 0; i < layers; i++) {
            const layerR = baseR * (1 - i * 0.28);
            const cone = new THREE.Mesh(
                new THREE.ConeGeometry(layerR, layerH * 1.4, 8),
                foliage
            );
            cone.position.y = trunkH + i * layerH * 0.78;
            group.add(cone);
        }
        return group;
    },

    // ============================================================
    // SECTION: Effect / FX sync (called from render)
    // ============================================================

    /** Show/hide and animate the per-car overlay FX (shield, boost flame,
     *  nitro flame, stun rings) based on the car's current state. */
    _syncCarFX(car, group, now) {
        const ud = group.userData;
        if (!ud) return;

        // Shield bubble
        if (ud.shield) {
            const on = car.isShielded && car.isShielded() && !car.exploded;
            ud.shield.visible = on;
            if (on) {
                const pulse = 0.95 + 0.06 * Math.sin(now / 150);
                ud.shield.scale.setScalar(pulse);
            }
        }

        // Boost flame
        if (ud.boostFlame) {
            const on = car.isBoosted && car.isBoosted() && !car.exploded;
            ud.boostFlame.visible = on;
            if (on) {
                const flicker = 0.85 + 0.25 * Math.sin(now / 60);
                ud.boostFlame.scale.set(flicker, 1, flicker);
                ud.boostFlame.material.opacity = 0.7 + 0.2 * Math.sin(now / 80);
            }
        }

        // Nitro flame
        if (ud.nitroFlame) {
            const on = car.isNitro && car.isNitro() && !car.exploded;
            ud.nitroFlame.visible = on;
            if (on) {
                const flicker = 0.9 + 0.25 * Math.sin(now / 50);
                ud.nitroFlame.scale.set(flicker, 1, flicker);
                ud.nitroFlame.material.opacity = 0.8 + 0.15 * Math.sin(now / 70);
            }
        }

        // Stun ring
        if (ud.stunRing) {
            const on = car.isStunned && car.isStunned() && !car.exploded;
            ud.stunRing.visible = on;
            if (on) {
                ud.stunRing.rotation.z = now / 300;
                const wobble = 1 + 0.1 * Math.sin(now / 90);
                ud.stunRing.scale.setScalar(wobble);
            }
        }
    },

    /** Sync homing missiles. Position/orientation come from each Projectile,
     *  meshes are created lazily and removed when alive=false. */
    _syncProjectiles(now) {
        if (typeof PowerupManager === 'undefined' || !PowerupManager.projectiles) return;
        const seen = new Set();
        for (const p of PowerupManager.projectiles) {
            if (!p.alive) continue;
            seen.add(p);
            let m = this.projectileMeshes.get(p);
            if (!m) {
                m = this._buildProjectileMesh(p);
                this.projectileMeshes.set(p, m);
                this.scene.add(m);
            }
            m.position.set(p.x, 14, p.y);
            m.rotation.y = -p.angle;
            // Pulse the flame
            const flame = m.children[2];
            if (flame) {
                const s = 0.85 + 0.3 * Math.sin(now / 50);
                flame.scale.set(s, 1, s);
            }
        }
        for (const [p, mesh] of this.projectileMeshes) {
            if (!seen.has(p)) {
                this.scene.remove(mesh);
                this.projectileMeshes.delete(p);
            }
        }
    },

    /** Sync oil slicks on the ground. Opacity ramps down with life. */
    _syncOilSlicks(now) {
        if (typeof PowerupManager === 'undefined' || !PowerupManager.oilSlicks) return;
        const seen = new Set();
        for (const s of PowerupManager.oilSlicks) {
            if (s.life <= 0) continue;
            seen.add(s);
            let m = this.oilSlickMeshes.get(s);
            if (!m) {
                m = this._buildOilSlickMesh(s);
                m.position.x = s.x;
                m.position.z = s.y;
                m.rotation.z = s.angle || 0;
                this.oilSlickMeshes.set(s, m);
                this.scene.add(m);
            }
            // Fade out in the last 2 seconds
            const fade = Math.min(1, s.life / 2);
            m.material.opacity = 0.85 * fade;
        }
        for (const [s, mesh] of this.oilSlickMeshes) {
            if (!seen.has(s)) {
                this.scene.remove(mesh);
                this.oilSlickMeshes.delete(s);
            }
        }
    },

    /** Sync visual-only effects: EMP rings expanding outward, tornado funnels
     *  spinning above their target car. */
    _syncVisualEffects(now) {
        if (typeof PowerupManager === 'undefined' || !PowerupManager.visualEffects) return;
        const seen = new Set();
        for (const e of PowerupManager.visualEffects) {
            if (e.age >= e.duration) continue;
            seen.add(e);
            let m = this.visualEffectMeshes.get(e);
            if (!m) {
                m = this._buildVisualEffectMesh(e);
                if (!m) continue;
                this.visualEffectMeshes.set(e, m);
                this.scene.add(m);
            }
            const t = e.age / e.duration;
            if (e.type === 'emp') {
                const r = (e.radius || 280) * t;
                m.scale.set(r / 3, r / 3, 1);
                m.material.opacity = (1 - t) * 0.8;
            } else if (e.type === 'tornado') {
                const tgt = e.target;
                if (tgt) {
                    m.position.set(tgt.x, 30, tgt.y);
                    m.rotation.y = now / 90;
                    m.material.opacity = (1 - t * 0.5) * 0.55;
                }
            }
        }
        for (const [e, mesh] of this.visualEffectMeshes) {
            if (!seen.has(e)) {
                this.scene.remove(mesh);
                this.visualEffectMeshes.delete(e);
            }
        }
    },

    /** Sync the particle pool with PowerupManager.particles. The pool grows
     *  on demand; unused sprites are hidden rather than disposed. */
    _syncParticles(now) {
        if (typeof PowerupManager === 'undefined' || !PowerupManager.particles) return;
        const ps = PowerupManager.particles;

        // Grow pool if needed
        while (this.particlePool.length < ps.length) {
            const mat = new THREE.SpriteMaterial({
                map: this._dotTexture,
                color: 0xffffff,
                transparent: true,
                depthWrite: false
            });
            const sp = new THREE.Sprite(mat);
            sp.visible = false;
            this.scene.add(sp);
            this.particlePool.push(sp);
        }

        // Map particle[i] → sprite[i] for this frame
        for (let i = 0; i < this.particlePool.length; i++) {
            const sp = this.particlePool[i];
            const p = i < ps.length ? ps[i] : null;
            if (!p || p.life <= 0) { sp.visible = false; continue; }

            const t = p.life / p.maxLife;  // 1 = fresh, 0 = dead
            const baseSize = p.size || 4;
            let scale, opacity, yLift;
            switch (p.type) {
                case 'smoke':
                    scale = baseSize * (2.0 - t) * 1.6;
                    opacity = 0.45 * t;
                    yLift = 10 + (1 - t) * 12;
                    break;
                case 'spark':
                    scale = baseSize * t * 1.2;
                    opacity = t;
                    yLift = 6;
                    break;
                case 'flame':
                    scale = baseSize * (0.6 + t) * 1.3;
                    opacity = t * 0.95;
                    yLift = 8;
                    break;
                case 'explosion':
                    scale = (baseSize || 30) * (1 - t) * 1.6;
                    opacity = t * 0.7;
                    yLift = 12;
                    break;
                default:
                    scale = baseSize * 1.4;
                    opacity = t;
                    yLift = 8;
            }
            sp.visible = true;
            sp.position.set(p.x, yLift, p.y);
            sp.scale.setScalar(scale * 2);
            sp.material.color.set(p.color || '#cccccc');
            sp.material.opacity = opacity;
        }
    },

    handleResize() {
        if (!this.renderer || !this.camera) return;
        const W = window.innerWidth;
        const H = window.innerHeight;
        this.renderer.setSize(W, H, false);
        this.camera.aspect = W / H;
        this.camera.updateProjectionMatrix();
    }
};

if (typeof window !== 'undefined') window.World3D = World3D;
