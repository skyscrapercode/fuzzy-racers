/* ============================================================================
 *  PROJECT     : Fuzzy Racers — AI Racing Game
 *  SUBJECT     : ISP568 Fuzzy Logic Systems
 *  FILE        : renderer.js
 *  DESCRIPTION : Track geometry generator + all canvas drawing helpers
 *
 *  Tracks are defined as a small set of hand-tuned control points
 *  per shape. The geometry builder samples a closed Catmull-Rom
 *  spline through those points, then computes inner/outer
 *  boundaries by perpendicular offset and a per-waypoint corner
 *  sharpness used as a fuzzy-logic input.
 * ============================================================ */

// ============================================================
// SECTION: Catmull-Rom Spline Sampling (closed loop)
// ============================================================

function _catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return {
        x: 0.5 * ((2 * p1.x) +
                  (-p0.x + p2.x) * t +
                  (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
                  (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) +
                  (-p0.y + p2.y) * t +
                  (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
                  (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
    };
}

function _sampleClosedCatmullRom(controlPoints, samplesPerSegment) {
    const N = controlPoints.length;
    const out = [];
    for (let i = 0; i < N; i++) {
        const p0 = controlPoints[(i - 1 + N) % N];
        const p1 = controlPoints[i];
        const p2 = controlPoints[(i + 1) % N];
        const p3 = controlPoints[(i + 2) % N];
        for (let j = 0; j < samplesPerSegment; j++) {
            out.push(_catmullRom(p0, p1, p2, p3, j / samplesPerSegment));
        }
    }
    return out;
}

// ============================================================
// SECTION: Track Control Points (per track id)
// Coordinates are in "world pixels". Each track lives in a roughly
// 1800 × 1200 area. The race manager picks a camera centered on the
// player; sizes here are chosen so a lap takes a meaningful amount
// of time at the speeds defined in car.js.
// ============================================================

const TrackControlPoints = {
    // City Circuit — rounded rectangle with a chicane bite on the right
    // matching the garage minimap. Collinear intermediate points keep the
    // long straights from bowing under Catmull-Rom smoothing. The chicane
    // arms are placed 320 px apart (vs 156 px road width) so the road has
    // ~80 px of clearance on each side of the bite — comfortable to drive.
    city: [
        { x: 300,  y: 280  },
        { x: 700,  y: 280  },   // top straight (collinear keeps the spline flat)
        { x: 1100, y: 280  },
        { x: 1500, y: 280  },
        { x: 1700, y: 470  },   // top-right corner
        { x: 1380, y: 530  },   // chicane bite — upper inward turn
        { x: 1380, y: 850  },   // chicane bite — lower inward turn (320 px apart)
        { x: 1700, y: 910  },   // back to right after the bite
        { x: 1500, y: 1050 },   // bottom-right corner
        { x: 1100, y: 1050 },   // bottom straight
        { x: 700,  y: 1050 },
        { x: 300,  y: 1050 },
        { x: 100,  y: 870  },   // bottom-left corner
        { x: 100,  y: 470  }    // left straight
    ],

    // Desert Highway — long stretched oval, mild kinks
    desert: [
        { x: 300,  y: 600 },
        { x: 600,  y: 250 },
        { x: 1300, y: 230 },
        { x: 1650, y: 500 },
        { x: 1500, y: 950 },
        { x: 700,  y: 970 }
    ],

    // Mountain Pass — twisty winding closed loop
    mountain: [
        { x: 300,  y: 800  },
        { x: 350,  y: 500  },
        { x: 600,  y: 400  },
        { x: 750,  y: 600  },
        { x: 950,  y: 450  },
        { x: 1100, y: 250  },
        { x: 1400, y: 280  },
        { x: 1550, y: 500  },
        { x: 1450, y: 750  },
        { x: 1150, y: 850  },
        { x: 900,  y: 750  },
        { x: 600,  y: 950  }
    ]
};

const TrackStyles = {
    city:     { asphalt: '#1a1d2a', grass: '#0d2614', sand: null,        road: '#2a2f44', halfRoadWidth: 78 },
    desert:   { asphalt: '#2a2418', grass: null,      sand: '#5a4a2a',   road: '#3a2f1a', halfRoadWidth: 90 },
    mountain: { asphalt: '#1a1f1a', grass: '#0a1a0a', sand: null,        road: '#2a3a2a', halfRoadWidth: 80 }
};

// ============================================================
// SECTION: Geometry Builder (called once per race, cached per id)
// ============================================================

const _geometryCache = new Map();

/**
 * Build geometry for a track id.
 * Returns:
 *   {
 *     id, style, halfRoadWidth, length,
 *     waypoints   : [{ x, y, tangent: rad, sharpness: 0..100 }]
 *     outer       : [{ x, y }]
 *     inner       : [{ x, y }]
 *     bounds      : { minX, minY, maxX, maxY }
 *     start       : { x, y, angle, gridSlots: [{x,y,angle}, ...] }
 *     sampleClosest(x, y) → { i, point, dist }
 *   }
 */
function buildTrackGeometry(trackId) {
    if (_geometryCache.has(trackId)) return _geometryCache.get(trackId);

    const ctrl = TrackControlPoints[trackId] || TrackControlPoints.city;
    const style = TrackStyles[trackId] || TrackStyles.city;
    const samplesPerSegment = 12;

    const centerline = _sampleClosedCatmullRom(ctrl, samplesPerSegment);
    const N = centerline.length;

    // Tangent + sharpness per waypoint
    const waypoints = [];
    for (let i = 0; i < N; i++) {
        const prev = centerline[(i - 1 + N) % N];
        const next = centerline[(i + 1) % N];
        const tx = next.x - prev.x;
        const ty = next.y - prev.y;
        const tangent = Math.atan2(ty, tx);
        waypoints.push({ x: centerline[i].x, y: centerline[i].y, tangent, sharpness: 0 });
    }
    // Sharpness = magnitude of tangent angle change between this segment and
    // the next, mapped to 0..100. Smoothed over a small window.
    const window = 3;
    for (let i = 0; i < N; i++) {
        let acc = 0;
        for (let k = 0; k < window; k++) {
            const a = waypoints[(i + k) % N].tangent;
            const b = waypoints[(i + k + 1) % N].tangent;
            let d = b - a;
            while (d >  Math.PI) d -= 2 * Math.PI;
            while (d < -Math.PI) d += 2 * Math.PI;
            acc += Math.abs(d);
        }
        waypoints[i].sharpness = Math.min(100, (acc / window) * 220);
    }

    // Inner / outer boundaries (perpendicular offset of centerline)
    const halfW = style.halfRoadWidth;
    const outer = [], inner = [];
    for (let i = 0; i < N; i++) {
        const t = waypoints[i].tangent;
        const nx = -Math.sin(t), ny = Math.cos(t);
        outer.push({ x: waypoints[i].x + nx * halfW, y: waypoints[i].y + ny * halfW });
        inner.push({ x: waypoints[i].x - nx * halfW, y: waypoints[i].y - ny * halfW });
    }

    // Total length (sum of segment lengths)
    let length = 0;
    for (let i = 0; i < N; i++) {
        const a = waypoints[i];
        const b = waypoints[(i + 1) % N];
        length += Math.hypot(b.x - a.x, b.y - a.y);
    }

    // Bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of outer.concat(inner)) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
    }

    // Start line + grid slots (place a 2x2 grid behind waypoint 0)
    const start = (() => {
        const wp = waypoints[0];
        const angle = wp.tangent;
        const back = -1; // offset backward along tangent
        const fwd  = { x: Math.cos(angle), y: Math.sin(angle) };
        const sideN= { x: -Math.sin(angle), y: Math.cos(angle) };
        const gridSlots = [];
        const lateralOffset = 26;
        const longitudinal  = 70;
        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 2; col++) {
                const lat = (col === 0 ? -1 : 1) * lateralOffset;
                const lng = back * (row * longitudinal + 10);
                gridSlots.push({
                    x: wp.x + sideN.x * lat + fwd.x * lng,
                    y: wp.y + sideN.y * lat + fwd.y * lng,
                    angle
                });
            }
        }
        return { x: wp.x, y: wp.y, angle, gridSlots };
    })();

    const geom = {
        id: trackId,
        style,
        halfRoadWidth: halfW,
        length,
        waypoints, outer, inner,
        bounds: { minX, minY, maxX, maxY },
        start,
        sampleClosest(x, y) {
            let bestI = 0, best = Infinity;
            for (let i = 0; i < waypoints.length; i++) {
                const dx = waypoints[i].x - x, dy = waypoints[i].y - y;
                const d2 = dx*dx + dy*dy;
                if (d2 < best) { best = d2; bestI = i; }
            }
            return { i: bestI, point: waypoints[bestI], dist: Math.sqrt(best) };
        }
    };
    _geometryCache.set(trackId, geom);
    return geom;
}

// ============================================================
// SECTION: Renderer (drawTrack / drawCar / drawMinimap / drawParticles)
// ============================================================

const Renderer = {
    /**
     * Draw the full track at world coordinates (caller has already set
     * up ctx with the world-space transform).
     */
    drawTrack(ctx, geom) {
        if (!geom) return;
        const { outer, inner, waypoints, style, start } = geom;

        // 1. Off-track fill (grass / sand) — fills the rectangle around the
        //    track first, then we lay the road on top.
        ctx.fillStyle = style.grass || style.sand || '#0a1a0a';
        const pad = 200;
        ctx.fillRect(geom.bounds.minX - pad, geom.bounds.minY - pad,
                     (geom.bounds.maxX - geom.bounds.minX) + pad * 2,
                     (geom.bounds.maxY - geom.bounds.minY) + pad * 2);

        // 2. Road surface: fill the polygon between outer and inner.
        //    We build a path going around the outer CW then back around the
        //    inner CCW with evenodd fill rule.
        const drawRingPath = () => {
            ctx.beginPath();
            ctx.moveTo(outer[0].x, outer[0].y);
            for (let i = 1; i < outer.length; i++) ctx.lineTo(outer[i].x, outer[i].y);
            ctx.closePath();
            ctx.moveTo(inner[0].x, inner[0].y);
            for (let i = 1; i < inner.length; i++) ctx.lineTo(inner[i].x, inner[i].y);
            ctx.closePath();
        };
        ctx.fillStyle = style.road;
        drawRingPath();
        ctx.fill('evenodd');

        // 3. Curbs / asphalt edge highlight (thin stroke of outer + inner)
        ctx.strokeStyle = style.asphalt;
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < outer.length; i++) {
            const p = outer[i];
            if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        for (let i = 0; i < inner.length; i++) {
            const p = inner[i];
            if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.stroke();

        // 4. Lane markings (white dashed centerline)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([18, 26]);
        ctx.lineDashOffset = 0;
        ctx.beginPath();
        for (let i = 0; i < waypoints.length; i++) {
            const p = waypoints[i];
            if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);

        // 5. Start/finish checker line across the track at waypoint 0
        const wp0 = start;
        const sn = { x: -Math.sin(wp0.angle), y: Math.cos(wp0.angle) };
        const halfW = geom.halfRoadWidth;
        const sq = 12;
        for (let i = -halfW; i < halfW; i += sq) {
            const x = wp0.x + sn.x * i;
            const y = wp0.y + sn.y * i;
            ctx.fillStyle = (Math.floor((i + halfW) / sq) % 2 === 0) ? '#ffffff' : '#0a0d18';
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(wp0.angle);
            ctx.fillRect(-sq * 0.4, -sq * 0.5, sq * 0.8, sq);
            ctx.restore();
        }
    },

    /**
     * Draw a single car at its world position. Customization is the same
     * shape persisted by garage.html. Health < 25% adds a damaged tint.
     */
    drawCar(ctx, car, customization) {
        if (!car) return;
        const cust = customization || car.customization || {};
        ctx.save();
        ctx.translate(car.x, car.y);
        ctx.rotate(car.angle);

        // Wreck mode: blackened scorched silhouette + permanent thick smoke.
        if (car.exploded) {
            // Thick black smoke around the wreck
            const t = (performance.now() - car.explodedAt) / 1000;
            ctx.globalAlpha = 0.6;
            ctx.fillStyle = '#222';
            for (let i = 0; i < 6; i++) {
                const offX = (Math.random() - 0.5) * 50;
                const offY = (Math.random() - 0.5) * 36;
                ctx.beginPath();
                ctx.arc(offX, offY, 10 + Math.random() * 10, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;

            // Charred frame: dark sedan silhouette
            drawCarTopDown(ctx, {
                shape: car._shape || 'sedan',
                paint: '#3a3030',
                accent: '#1a1a1a',
                pattern: 'solid',
                bodyKit: 'stock',
                glow: false
            });
            // Red-hot flicker on top of the wreck for the first 2 seconds
            if (t < 2) {
                ctx.globalAlpha = 0.45 * (1 - t / 2) * (0.5 + 0.5 * Math.sin(performance.now() / 60));
                ctx.fillStyle = '#ff6611';
                ctx.beginPath();
                ctx.ellipse(0, 0, 22, 12, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
            }
            ctx.restore();
            return;
        }

        // Damaged smoke (rendered before body so it sits below)
        if (car.health <= car.maxHealth * 0.25) {
            ctx.globalAlpha = 0.4;
            ctx.fillStyle = '#1a1a1a';
            for (let i = 0; i < 3; i++) {
                ctx.beginPath();
                ctx.arc(-30 - i * 6, (Math.random() - 0.5) * 8, 6 + i * 2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
        }

        drawCarTopDown(ctx, {
            shape: car._shape || (getCarById ? (getCarById(car.id) || {}).shape : 'sedan'),
            paint: cust.paint || '#00eaff',
            accent: cust.accent || '#ffffff',
            pattern: cust.pattern || 'stripes',
            bodyKit: (typeof getBodyKit === 'function')
                ? getBodyKit(cust.bodyKit).visual
                : 'stock',
            glow: true
        });

        // Shield bubble (translucent blue dome with pulse)
        if (car.isShielded && car.isShielded()) {
            const pulse = 0.85 + 0.15 * Math.sin(performance.now() / 120);
            // Inner filled bubble
            const gr = ctx.createRadialGradient(0, 0, 8, 0, 0, 48);
            gr.addColorStop(0, 'rgba(0, 234, 255, 0.10)');
            gr.addColorStop(0.6, 'rgba(0, 234, 255, 0.20)');
            gr.addColorStop(1, 'rgba(0, 234, 255, 0.05)');
            ctx.fillStyle = gr;
            ctx.beginPath();
            ctx.arc(0, 0, 46 * pulse, 0, Math.PI * 2);
            ctx.fill();
            // Outline
            ctx.strokeStyle = 'rgba(0, 234, 255, 0.85)';
            ctx.lineWidth = 2;
            ctx.shadowColor = '#00eaff';
            ctx.shadowBlur = 18;
            ctx.beginPath();
            ctx.arc(0, 0, 46 * pulse, 0, Math.PI * 2);
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        // Boost flame (red)
        if (car.isBoosted && car.isBoosted()) {
            ctx.fillStyle = '#ffd400';
            ctx.shadowColor = '#ff3355';
            ctx.shadowBlur = 14;
            ctx.beginPath();
            ctx.moveTo(-46, -7); ctx.lineTo(-70, 0); ctx.lineTo(-46, 7); ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#ff3355';
            ctx.beginPath();
            ctx.moveTo(-46, -3); ctx.lineTo(-56, 0); ctx.lineTo(-46, 3); ctx.closePath();
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        // Nitro exhaust (blue) — distinct from boost
        if (car.isNitro && car.isNitro()) {
            ctx.fillStyle = '#00eaff';
            ctx.shadowColor = '#00eaff';
            ctx.shadowBlur = 18;
            ctx.beginPath();
            ctx.moveTo(-46, -8); ctx.lineTo(-80, 0); ctx.lineTo(-46, 8); ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.moveTo(-46, -3); ctx.lineTo(-62, 0); ctx.lineTo(-46, 3); ctx.closePath();
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        // Stunned (EMP) — electric pulses
        if (car.isStunned && car.isStunned()) {
            ctx.strokeStyle = '#a479ff';
            ctx.lineWidth = 2;
            ctx.shadowColor = '#a479ff';
            ctx.shadowBlur = 12;
            for (let i = 0; i < 3; i++) {
                const r = 20 + i * 8 + (performance.now() / 40 % 8);
                ctx.globalAlpha = 0.6 - i * 0.18;
                ctx.beginPath();
                ctx.arc(0, 0, r, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
        }

        // Player highlight (cyan name arrow above head)
        if (car.isPlayer) {
            ctx.save();
            ctx.rotate(-car.angle); // counter-rotate so the marker points up in screen space
            ctx.fillStyle = 'rgba(0, 234, 255, 0.9)';
            ctx.shadowColor = '#00eaff';
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.moveTo(0, -42);
            ctx.lineTo(-6, -52);
            ctx.lineTo(6, -52);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }

        ctx.restore();
    },

    /**
     * Mini-map of the track + cars, drawn into a small rectangle at
     * (x, y, w, h) of the current ctx (screen coords).
     */
    drawMinimap(ctx, geom, cars, opts) {
        opts = opts || {};
        const x = opts.x || 0, y = opts.y || 0;
        const w = opts.w || 220, h = opts.h || 160;
        const pad = 10;

        // Background panel
        ctx.save();
        ctx.fillStyle = 'rgba(10, 12, 22, 0.78)';
        ctx.strokeStyle = 'rgba(0, 234, 255, 0.45)';
        ctx.lineWidth = 1;
        roundedRect(ctx, x, y, w, h, 8);
        ctx.fill();
        ctx.stroke();

        // Compute scale
        const b = geom.bounds;
        const tw = b.maxX - b.minX;
        const th = b.maxY - b.minY;
        const scale = Math.min((w - pad * 2) / tw, (h - pad * 2) / th);
        const offX = x + (w - tw * scale) / 2 - b.minX * scale;
        const offY = y + (h - th * scale) / 2 - b.minY * scale;
        const M = (p) => ({ x: offX + p.x * scale, y: offY + p.y * scale });

        // Track outline (centerline)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = Math.max(2, geom.halfRoadWidth * scale * 1.8);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i < geom.waypoints.length; i++) {
            const p = M(geom.waypoints[i]);
            if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.stroke();
        // Center hairline
        ctx.strokeStyle = 'rgba(255, 212, 0, 0.6)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Start dot
        const s = M(geom.start);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
        ctx.fill();

        // Cars
        if (cars) {
            for (const car of cars) {
                const p = M(car);
                ctx.fillStyle = car.isPlayer ? '#00eaff' : '#ff3355';
                ctx.shadowColor = ctx.fillStyle;
                ctx.shadowBlur = 6;
                ctx.beginPath();
                ctx.arc(p.x, p.y, car.isPlayer ? 4 : 3, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.shadowBlur = 0;
        }

        ctx.restore();
    },

    /**
     * Draw an array of particles. Each particle has at least:
     *   { x, y, vx, vy, life, maxLife, color, size, type }
     *
     * Types supported:
     *   'smoke'   — soft grey circle that fades
     *   'spark'   — small glowing point with a short trail
     *   'flame'   — bright orange-yellow circle
     *   'explosion' — expanding ring
     */
    drawParticles(ctx, particles) {
        if (!particles || !particles.length) return;
        ctx.save();
        for (const p of particles) {
            const t = p.life / p.maxLife;       // 1 → fresh, 0 → dead
            if (t <= 0) continue;

            if (p.type === 'smoke') {
                ctx.globalAlpha = 0.5 * t;
                ctx.fillStyle = p.color || '#888';
                ctx.beginPath();
                ctx.arc(p.x, p.y, (p.size || 6) * (1.6 - t), 0, Math.PI * 2);
                ctx.fill();
            } else if (p.type === 'spark') {
                ctx.globalAlpha = t;
                ctx.fillStyle = p.color || '#ffd400';
                ctx.shadowColor = p.color || '#ffd400';
                ctx.shadowBlur = 8;
                ctx.beginPath();
                ctx.arc(p.x, p.y, (p.size || 2) * t, 0, Math.PI * 2);
                ctx.fill();
            } else if (p.type === 'flame') {
                ctx.globalAlpha = t;
                ctx.fillStyle = p.color || '#ff8800';
                ctx.shadowColor = '#ff3355';
                ctx.shadowBlur = 14;
                ctx.beginPath();
                ctx.arc(p.x, p.y, (p.size || 4) * (0.6 + t), 0, Math.PI * 2);
                ctx.fill();
            } else if (p.type === 'explosion') {
                ctx.globalAlpha = t * 0.7;
                ctx.strokeStyle = p.color || '#ff8800';
                ctx.lineWidth = 2 + 4 * t;
                ctx.beginPath();
                ctx.arc(p.x, p.y, (p.size || 30) * (1 - t), 0, Math.PI * 2);
                ctx.stroke();
            }
        }
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.restore();
    }
};

// ============================================================
// SECTION: Particle Helpers (spawners + update used by race.js)
// ============================================================

const Particles = {
    spawnTireSmoke(list, x, y, vx, vy) {
        list.push({
            x, y,
            vx: (vx || 0) * 0.1 + (Math.random() - 0.5) * 20,
            vy: (vy || 0) * 0.1 + (Math.random() - 0.5) * 20,
            life: 1, maxLife: 1,
            color: 'rgba(170, 170, 170, 1)',
            size: 4 + Math.random() * 4,
            type: 'smoke'
        });
    },
    spawnSparks(list, x, y, count, color) {
        for (let i = 0; i < (count || 6); i++) {
            const a = Math.random() * Math.PI * 2;
            const s = 80 + Math.random() * 120;
            list.push({
                x, y,
                vx: Math.cos(a) * s,
                vy: Math.sin(a) * s,
                life: 0.5, maxLife: 0.5,
                color: color || '#ffd400',
                size: 2 + Math.random() * 2,
                type: 'spark'
            });
        }
    },
    spawnExplosion(list, x, y, color) {
        list.push({
            x, y, vx: 0, vy: 0,
            life: 0.6, maxLife: 0.6,
            color: color || '#ff8800',
            size: 30, type: 'explosion'
        });
        Particles.spawnSparks(list, x, y, 14, color || '#ff8800');
    },
    /** Update all particles in place; remove dead ones in-place via splice. */
    update(list, dt) {
        for (let i = list.length - 1; i >= 0; i--) {
            const p = list[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.life -= dt;
            if (p.life <= 0) list.splice(i, 1);
        }
    }
};

// ============================================================
// SECTION: Decorative Track Minimap (garage track-selection cards)
// — distinct from Renderer.drawMinimap which uses live race geometry.
// ============================================================

function drawTrackMinimap(ctx, w, h, trackId, accent) {
    accent = accent || '#00eaff';

    // Background grid
    ctx.fillStyle = '#0a0d18';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    const gridSize = 16;
    for (let x = 0; x < w; x += gridSize) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += gridSize) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    const pad = Math.min(w, h) * 0.12;
    const trackWidth = Math.max(6, Math.min(w, h) * 0.06);

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (trackId === 'city') {
        // Matches the in-race city-circuit shape: rounded rectangle with a
        // chicane bite on the right side (between y=35% and y=72%).
        const path = (W) => {
            ctx.beginPath();
            ctx.moveTo(pad, pad);
            ctx.lineTo(w - pad, pad);
            ctx.lineTo(w - pad, h * 0.35);
            ctx.lineTo(w * 0.62, h * 0.42);
            ctx.lineTo(w * 0.62, h * 0.65);
            ctx.lineTo(w - pad, h * 0.72);
            ctx.lineTo(w - pad, h - pad);
            ctx.lineTo(pad, h - pad);
            ctx.closePath();
            ctx.lineWidth = W;
            ctx.stroke();
        };
        ctx.strokeStyle = '#1c2138'; path(trackWidth + 4);
        ctx.strokeStyle = '#2a3050'; path(trackWidth);

        ctx.fillStyle = '#1c2138';
        ctx.strokeStyle = 'rgba(0, 234, 255, 0.3)';
        ctx.lineWidth = 1;
        for (const [bx, by, bw, bh] of [
            [w * 0.35, h * 0.30, 14, 10],
            [w * 0.50, h * 0.30, 10, 14],
            [w * 0.30, h * 0.75, 18, 10],
            [w * 0.85, h * 0.30, 8, 14]
        ]) {
            ctx.fillRect(bx - bw/2, by - bh/2, bw, bh);
            ctx.strokeRect(bx - bw/2, by - bh/2, bw, bh);
        }
        _drawCheckerLine(ctx, pad, pad - 4, 16, 4);

    } else if (trackId === 'desert') {
        const cx = w / 2, cy = h / 2;
        const rx = w / 2 - pad;
        const ry = h / 2 - pad * 1.4;
        ctx.strokeStyle = '#3a2f1a'; ctx.lineWidth = trackWidth + 4;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#5a4a2a'; ctx.lineWidth = trackWidth;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#7d6a3a';
        for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2 + 0.7;
            const dx = cx + Math.cos(a) * rx * 0.4;
            const dy = cy + Math.sin(a) * ry * 0.4;
            ctx.beginPath(); ctx.ellipse(dx, dy, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = accent; ctx.shadowColor = accent; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(w - pad - 4, pad + 4, 5, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
        _drawCheckerLine(ctx, cx - 8, cy - ry - trackWidth/2 - 2, 16, 3);

    } else if (trackId === 'mountain') {
        ctx.strokeStyle = '#1a2a1a'; ctx.lineWidth = trackWidth + 4;
        ctx.beginPath();
        ctx.moveTo(pad, h - pad);
        ctx.bezierCurveTo(w * 0.1, h * 0.5, w * 0.5, h * 0.8, w * 0.55, h * 0.45);
        ctx.bezierCurveTo(w * 0.58, h * 0.15, w * 0.85, h * 0.2, w - pad, pad);
        ctx.stroke();
        ctx.strokeStyle = '#2a4a2a'; ctx.lineWidth = trackWidth; ctx.stroke();
        for (const [px, py, ps] of [
            [w * 0.25, h * 0.30, 10], [w * 0.42, h * 0.20, 14],
            [w * 0.75, h * 0.55, 12], [w * 0.85, h * 0.75, 9]
        ]) {
            ctx.fillStyle = '#3a4a4a';
            ctx.beginPath();
            ctx.moveTo(px, py - ps);
            ctx.lineTo(px - ps * 0.8, py + ps * 0.5);
            ctx.lineTo(px + ps * 0.8, py + ps * 0.5);
            ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#cfe8ff';
            ctx.beginPath();
            ctx.moveTo(px, py - ps);
            ctx.lineTo(px - ps * 0.3, py - ps * 0.4);
            ctx.lineTo(px + ps * 0.3, py - ps * 0.4);
            ctx.closePath(); ctx.fill();
        }
        _drawCheckerLine(ctx, pad - 2, h - pad - 4, 14, 4);
    }

    ctx.restore();

    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, h - 2, w, 2);
    ctx.globalAlpha = 1;
}

function _drawCheckerLine(ctx, x, y, len, height) {
    const sq = height;
    for (let i = 0; i < len / sq; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#0a0d18';
        ctx.fillRect(x + i * sq, y, sq, height);
    }
}

if (typeof window !== 'undefined') {
    window.Renderer = Renderer;
    window.Particles = Particles;
    window.buildTrackGeometry = buildTrackGeometry;
    window.drawTrackMinimap = drawTrackMinimap;
}
