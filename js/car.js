/* ============================================================================
 *  PROJECT     : Fuzzy Racers: AI Racing Game
 *  SUBJECT     : ISP568 Fuzzy Logic Systems
 *  FILE        : car.js
 *  DESCRIPTION : Car registry, customization data (engines/tires/body kits/
 *                paint/patterns), top-down rendering helpers, customization
 *                icon helpers, difficulty/track metadata, and the runtime
 *                Car class with arcade physics + collision handling.
 * ============================================================================
 */

// ============================================================
// SECTION: Car Roster (6 chassis)
// ============================================================

const CarRoster = [
    {
        id: 'street_rocket',
        name: 'Street Rocket',
        tagline: 'Balanced all-rounder',
        stats: { speed: 6, handling: 6, accel: 6, armor: 6 },
        paint: '#00eaff',
        accent: '#ffffff',
        shape: 'sedan'
    },
    {
        id: 'thunder_beast',
        name: 'Thunder Beast',
        tagline: 'Top speed, twitchy steering',
        stats: { speed: 9, handling: 3, accel: 7, armor: 5 },
        paint: '#ff3355',
        accent: '#ffd400',
        shape: 'muscle'
    },
    {
        id: 'corner_king',
        name: 'Corner King',
        tagline: 'Glued to the racing line',
        stats: { speed: 4, handling: 9, accel: 6, armor: 5 },
        paint: '#39ff7a',
        accent: '#003322',
        shape: 'compact'
    },
    {
        id: 'tank_brawler',
        name: 'Tank Brawler',
        tagline: 'Soak hits, deliver hits',
        stats: { speed: 3, handling: 5, accel: 4, armor: 10 },
        paint: '#8a91b4',
        accent: '#1c2138',
        shape: 'truck'
    },
    {
        id: 'turbo_ghost',
        name: 'Turbo Ghost',
        tagline: 'Explosive launches, fragile',
        stats: { speed: 7, handling: 6, accel: 10, armor: 2 },
        paint: '#a479ff',
        accent: '#00eaff',
        shape: 'wedge'
    },
    {
        id: 'drift_master',
        name: 'Drift Master',
        tagline: 'Fast and nimble, paper armor',
        stats: { speed: 8, handling: 8, accel: 5, armor: 3 },
        paint: '#ffd400',
        accent: '#ff2bd6',
        shape: 'coupe'
    }
];

function getCarById(id) {
    return CarRoster.find(c => c.id === id) || null;
}

// ============================================================
// SECTION: Customization Registries (Engines, Tires, Body Kits, Paint, Patterns)
// ============================================================

const Engines = [
    { id: 'stock', name: 'Stock Engine',  desc: 'Reliable factory mill', mods: { speed: 0, accel: 0 }, fuel: 'High',     unlocks: null   },
    { id: 'sport', name: 'Sport Engine',  desc: 'Tuned for response',    mods: { speed: 1, accel: 2 }, fuel: 'Medium',   unlocks: null   },
    { id: 'turbo', name: 'Turbo Engine',  desc: 'Forced induction',      mods: { speed: 2, accel: 3 }, fuel: 'Low',      unlocks: null   },
    { id: 'nitro', name: 'Nitro Engine',  desc: 'NOS-injected monster',  mods: { speed: 3, accel: 4 }, fuel: 'Very Low', unlocks: 'nitro' }
];

const Tires = [
    { id: 'standard', name: 'Standard Tires', desc: 'Balanced grip, all conditions',     mods: { handling: 0 } },
    { id: 'sport',    name: 'Sport Tires',    desc: '+1 accel on straights',             mods: { handling: 1, accel: 1 } },
    { id: 'rain',     name: 'Rain Tires',     desc: '+2 handling on wet, -1 speed',      mods: { handling: 2, speed: -1 } },
    { id: 'slick',    name: 'Slick Tires',    desc: '+3 handling dry, -2 on wet',        mods: { handling: 3 } }
];

const BodyKits = [
    { id: 'stock',    name: 'Stock Body',  desc: 'Factory silhouette',         mods: {},                       visual: 'stock'      },
    { id: 'aero',     name: 'Aero Kit',    desc: 'Rear wing, lower drag',      mods: { speed: 1, armor: -1 },  visual: 'spoiler'    },
    { id: 'armored',  name: 'Armored Kit', desc: 'Side bars, brawler stance',  mods: { armor: 2, speed: -1 },  visual: 'sidebars'   },
    { id: 'stealth',  name: 'Stealth Kit', desc: 'Low-profile, agile',         mods: { handling: 1 },          visual: 'lowprofile' }
];

const PaintPresets = [
    '#00eaff', '#ff2bd6', '#ffd400', '#39ff7a', '#ff3355',
    '#a479ff', '#ffffff', '#ff8800', '#1f90ff', '#9aa3c7'
];

const Patterns = [
    { id: 'solid',   name: 'Solid' },
    { id: 'stripes', name: 'Racing Stripes' },
    { id: 'flame',   name: 'Flame' },
    { id: 'camo',    name: 'Camo' }
];

const Difficulties = [
    {
        id: 'rookie',
        name: 'Rookie',
        icon: '🟢',
        accent: '#39ff7a',
        tagline: 'Easy-going AI. Slow to react, prone to mistakes.',
        bullets: [
            { k: 'Reaction',   v: 'Slow · 1.5s' },
            { k: 'Mistakes',   v: '±20% input noise' },
            { k: 'Powerups',   v: 'Rarely & randomly' },
            { k: 'Catch-up',   v: 'Mild rubber-banding' }
        ],
        params: { tickMs: 1500, noise: 0.20, powerupAggro: 0.2, rubberBand: 0.25, predictsPlayer: false }
    },
    {
        id: 'racer',
        name: 'Racer',
        icon: '🟡',
        accent: '#ffd400',
        tagline: 'Balanced competition with strategic powerup use.',
        bullets: [
            { k: 'Reaction',   v: 'Moderate · 0.8s' },
            { k: 'Mistakes',   v: '±10% input noise' },
            { k: 'Powerups',   v: 'Strategic (fuzzy)' },
            { k: 'Catch-up',   v: 'Moderate rubber-banding' }
        ],
        params: { tickMs: 800, noise: 0.10, powerupAggro: 0.6, rubberBand: 0.5, predictsPlayer: false }
    },
    {
        id: 'champion',
        name: 'Champion',
        icon: '🔴',
        accent: '#ff3355',
        tagline: 'Aggressive AI that anticipates your moves.',
        bullets: [
            { k: 'Reaction',   v: 'Fast · 0.3s' },
            { k: 'Mistakes',   v: '±3% input noise' },
            { k: 'Powerups',   v: 'Aggressive & optimal' },
            { k: 'Catch-up',   v: 'Strong rubber-banding' },
            { k: 'Bonus',      v: '★ Predicts player powerups' }
        ],
        params: { tickMs: 300, noise: 0.03, powerupAggro: 0.95, rubberBand: 0.85, predictsPlayer: true }
    }
];

const Tracks = [
    {
        id: 'city',
        name: 'City Circuit',
        desc: 'Tight corners, short straights, urban obstacles.',
        focus: 'Handling-heavy',
        accent: '#00eaff'
    },
    {
        id: 'desert',
        name: 'Desert Highway',
        desc: 'Long straights, few corners, top-speed focus.',
        focus: 'Speed-heavy',
        accent: '#ffd400'
    },
    {
        id: 'mountain',
        name: 'Mountain Pass',
        desc: 'Complex corners with elevation markers.',
        focus: 'Mixed handling',
        accent: '#39ff7a'
    }
];

function getDifficulty(id) { return Difficulties.find(d => d.id === id) || Difficulties[1]; }
function getTrack(id)      { return Tracks.find(t => t.id === id) || Tracks[0]; }

function getEngine(id)   { return Engines.find(e => e.id === id) || Engines[0]; }
function getTires(id)    { return Tires.find(t => t.id === id) || Tires[0]; }
function getBodyKit(id)  { return BodyKits.find(b => b.id === id) || BodyKits[0]; }

/* Compute combined final stats. base + engine + tires + bodyKit.
 * Returns { speed, handling, accel, armor }. Stats can exceed 10: caller
 * decides bar scaling. */
function computeFinalStats(baseStats, customization) {
    const out = Object.assign({}, baseStats);
    const apply = (mods) => {
        for (const k in mods) out[k] = (out[k] || 0) + mods[k];
    };
    apply(getEngine(customization.engine).mods);
    apply(getTires(customization.tires).mods);
    apply(getBodyKit(customization.bodyKit).mods);
    return out;
}

// ============================================================
// SECTION: Top-down Car Rendering
// ============================================================

/* Draw a top-down car centered at (0,0) in ctx, facing +x (right).
 * Caller is responsible for translate/rotate/scale around this. */
function drawCarTopDown(ctx, opts) {
    const o = opts || {};
    const shape = o.shape || 'sedan';
    const paint = o.paint || '#00eaff';
    const accent = o.accent || '#ffffff';
    const pattern = o.pattern || o.decal || 'stripes';
    const bodyKit = o.bodyKit || 'stock';
    const glow = o.glow !== false;

    // Dimensions per shape (length × width in local units)
    const baseDims = {
        sedan:   { L: 84, W: 40, nose: 0.55, tail: 0.55 },
        muscle:  { L: 92, W: 44, nose: 0.45, tail: 0.65 },
        compact: { L: 70, W: 38, nose: 0.55, tail: 0.55 },
        truck:   { L: 96, W: 50, nose: 0.55, tail: 0.40 },
        wedge:   { L: 90, W: 38, nose: 0.30, tail: 0.70 },
        coupe:   { L: 86, W: 40, nose: 0.50, tail: 0.60 }
    }[shape];
    const dims = Object.assign({}, baseDims);

    // Stealth: flatter, lower-profile silhouette
    if (bodyKit === 'lowprofile') {
        dims.W = dims.W * 0.85;
        dims.nose = Math.max(0.2, dims.nose - 0.15);
    }

    const L = dims.L, W = dims.W;
    const hl = L / 2, hw = W / 2;

    ctx.save();

    // ---- Armored side bars (drawn BEHIND body so they look like bolted-on plates) ----
    if (bodyKit === 'sidebars') {
        ctx.fillStyle = '#2a2f44';
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 1;
        roundedRect(ctx, -hl + 6, -hw - 5, L - 12, 4, 1.5);
        ctx.fill(); ctx.stroke();
        roundedRect(ctx, -hl + 6,  hw + 1, L - 12, 4, 1.5);
        ctx.fill(); ctx.stroke();
        // Rivets
        ctx.fillStyle = '#5a6088';
        for (let i = -hl + 12; i < hl - 12; i += 14) {
            ctx.fillRect(i, -hw - 4, 2, 2);
            ctx.fillRect(i,  hw + 2, 2, 2);
        }
    }

    // Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.ellipse(2, 4, hl * 0.95, hw * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body fill (silhouette)
    if (glow) {
        ctx.shadowColor = paint;
        ctx.shadowBlur = 14;
    }
    ctx.fillStyle = paint;
    drawCarSilhouette(ctx, dims);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Body outline
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = 1.5;
    drawCarSilhouette(ctx, dims);
    ctx.stroke();

    // Pattern (paint job)
    if (pattern === 'stripes') {
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(-hl + 4, -3, L - 8, 2);
        ctx.fillRect(-hl + 4,  1, L - 8, 2);
        ctx.globalAlpha = 1;
    } else if (pattern === 'flame') {
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.moveTo(-hl + 6, -hw * 0.45);
        ctx.lineTo( hl * 0.2, -hw * 0.15);
        ctx.lineTo(-hl + 6, 0);
        ctx.lineTo( hl * 0.2,  hw * 0.15);
        ctx.lineTo(-hl + 6,  hw * 0.45);
        ctx.closePath();
        ctx.fill();
    } else if (pattern === 'camo') {
        // Deterministic blob pattern based on shape size (so it doesn't twinkle)
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.55;
        const blobs = [
            [-0.30, -0.30, 8], [ 0.15, -0.20, 6], [-0.05,  0.25, 7],
            [ 0.30,  0.15, 5], [-0.40,  0.10, 6], [ 0.40, -0.05, 4]
        ];
        for (const [bx, by, br] of blobs) {
            ctx.beginPath();
            ctx.ellipse(bx * hl, by * hw, br, br * 0.85, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        // Second darker layer
        ctx.fillStyle = '#0b0e1a';
        ctx.globalAlpha = 0.35;
        const dark = [[-0.20, 0.05, 4], [0.25, 0.30, 3], [-0.30, 0.35, 3], [0.05, -0.30, 3]];
        for (const [bx, by, br] of dark) {
            ctx.beginPath();
            ctx.ellipse(bx * hl, by * hw, br, br * 0.85, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
    // 'solid' = no overlay

    // Windshield / cockpit (dark glass)
    ctx.fillStyle = 'rgba(8, 10, 22, 0.85)';
    const cockL = L * 0.32;
    const cockW = W * 0.62;
    roundedRect(ctx, -cockL * 0.3, -cockW / 2, cockL, cockW, 4);
    ctx.fill();

    // Glass highlight
    ctx.fillStyle = 'rgba(0, 234, 255, 0.18)';
    roundedRect(ctx, -cockL * 0.3 + 2, -cockW / 2 + 2, cockL * 0.55, 3, 1.5);
    ctx.fill();

    // Headlights (front, +x)
    ctx.fillStyle = '#fff8b0';
    ctx.shadowColor = '#fff8b0';
    ctx.shadowBlur = glow ? 8 : 0;
    ctx.fillRect(hl - 6, -hw + 4, 4, 4);
    ctx.fillRect(hl - 6,  hw - 8, 4, 4);
    ctx.shadowBlur = 0;

    // Taillights (rear, -x)
    ctx.fillStyle = '#ff3355';
    ctx.shadowColor = '#ff3355';
    ctx.shadowBlur = glow ? 6 : 0;
    ctx.fillRect(-hl + 2, -hw + 4, 3, 4);
    ctx.fillRect(-hl + 2,  hw - 8, 3, 4);
    ctx.shadowBlur = 0;

    // Wheels (sides)
    ctx.fillStyle = '#0a0c14';
    const wheelL = L * 0.18;
    const wheelW = 6;
    ctx.fillRect(-hl + L * 0.16, -hw - 2, wheelL, wheelW);
    ctx.fillRect( hl - L * 0.34, -hw - 2, wheelL, wheelW);
    ctx.fillRect(-hl + L * 0.16,  hw - 4, wheelL, wheelW);
    ctx.fillRect( hl - L * 0.34,  hw - 4, wheelL, wheelW);

    // ---- Aero spoiler (drawn over the rear of the body) ----
    if (bodyKit === 'spoiler') {
        // Wing supports
        ctx.fillStyle = '#0a0c14';
        ctx.fillRect(-hl + 4, -hw * 0.55, 3, 4);
        ctx.fillRect(-hl + 4,  hw * 0.55 - 4, 3, 4);
        // Wing blade
        ctx.fillStyle = '#1c2138';
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1;
        roundedRect(ctx, -hl + 1, -hw * 0.85, 6, W * 1.7, 2);
        ctx.fill();
        ctx.stroke();
        // Accent stripe on wing
        ctx.fillStyle = accent;
        ctx.fillRect(-hl + 3, -hw * 0.85 + 2, 2, W * 1.7 - 4);
    }

    // ---- Stealth: thin matte top accent (low-profile feel) ----
    if (bodyKit === 'lowprofile') {
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-hl + 10, -hw + 2);
        ctx.lineTo( hl - 10, -hw + 2);
        ctx.moveTo(-hl + 10,  hw - 2);
        ctx.lineTo( hl - 10,  hw - 2);
        ctx.stroke();
        // Darker tint overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
        drawCarSilhouette(ctx, dims);
        ctx.fill();
    }

    ctx.restore();
}

function drawCarSilhouette(ctx, dims) {
    const hl = dims.L / 2, hw = dims.W / 2;
    const nose = dims.nose, tail = dims.tail;
    ctx.beginPath();
    // rear-left → front-left (with nose curve) → front-right → rear-right (with tail curve)
    ctx.moveTo(-hl, -hw + 4);
    ctx.lineTo(-hl + hl * tail * 0.3, -hw);
    ctx.lineTo( hl - hl * nose * 0.3, -hw);
    ctx.quadraticCurveTo(hl, -hw, hl, -hw + 6);
    ctx.lineTo( hl,  hw - 6);
    ctx.quadraticCurveTo(hl,  hw, hl - hl * nose * 0.3,  hw);
    ctx.lineTo(-hl + hl * tail * 0.3,  hw);
    ctx.lineTo(-hl,  hw - 4);
    ctx.closePath();
}

function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

// ============================================================
// SECTION: Customization Icon Helpers (engine/tire/body-kit cards)
// ============================================================

/* Icon drawing helpers for customization cards.
 * Each draws into a (w x h) canvas with its own background already cleared. */

function drawEngineIcon(ctx, w, h, engineId) {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    const s = Math.min(w, h) / 90;
    ctx.scale(s, s);

    // Block (rounded rectangle, the "engine body")
    ctx.fillStyle = '#262b40';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.5;
    roundedRect(ctx, -28, -18, 56, 36, 4);
    ctx.fill(); ctx.stroke();

    // Cylinders/spark plugs on top: count varies by engine
    const cylCount = { stock: 4, sport: 4, turbo: 6, nitro: 6 }[engineId] || 4;
    const spacing = 48 / cylCount;
    ctx.fillStyle = '#5a6088';
    for (let i = 0; i < cylCount; i++) {
        const x = -24 + i * spacing + spacing / 2;
        ctx.fillRect(x - 2, -23, 4, 5);
    }

    // Engine-specific accents
    if (engineId === 'sport') {
        // Bright tuned headers
        ctx.strokeStyle = '#ffd400';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-22, 18); ctx.lineTo(-28, 26);
        ctx.moveTo(  0, 18); ctx.lineTo(  4, 28);
        ctx.moveTo( 22, 18); ctx.lineTo( 28, 26);
        ctx.stroke();
    } else if (engineId === 'turbo') {
        // Turbo snail
        ctx.fillStyle = '#00eaff';
        ctx.shadowColor = '#00eaff';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(22, -4, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#0b0e1a';
        ctx.beginPath();
        ctx.arc(22, -4, 4, 0, Math.PI * 2);
        ctx.fill();
        // Intake pipe
        ctx.strokeStyle = '#00eaff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(12, -4); ctx.lineTo(0, -4);
        ctx.stroke();
    } else if (engineId === 'nitro') {
        // NOS bottle silhouette
        ctx.fillStyle = '#39ff7a';
        ctx.shadowColor = '#39ff7a';
        ctx.shadowBlur = 14;
        roundedRect(ctx, 16, -22, 12, 36, 4);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#0b0e1a';
        ctx.fillRect(20, -24, 4, 4);
        // "NOS" label
        ctx.fillStyle = '#0b0e1a';
        ctx.font = '700 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('N', 22, -2);
    }

    // Belt detail on stock
    if (engineId === 'stock') {
        ctx.strokeStyle = '#1c2138';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(-14, 4, 6, 0, Math.PI * 2);
        ctx.arc( 14, 4, 6, 0, Math.PI * 2);
        ctx.stroke();
    }

    ctx.restore();
}

function drawTireIcon(ctx, w, h, tireId) {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    const s = Math.min(w, h) / 90;
    ctx.scale(s, s);

    // Tire rim (outer rubber)
    ctx.fillStyle = '#0a0c14';
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 32, 0, Math.PI * 2);
    ctx.fill();

    // Tread pattern per tire
    ctx.strokeStyle = '#5a6088';
    ctx.lineWidth = 2;

    if (tireId === 'standard') {
        // Block treads
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * 22, Math.sin(a) * 22);
            ctx.lineTo(Math.cos(a) * 30, Math.sin(a) * 30);
            ctx.stroke();
        }
    } else if (tireId === 'sport') {
        // Directional V-shaped treads
        ctx.strokeStyle = '#ffd400';
        for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            const x = Math.cos(a) * 26, y = Math.sin(a) * 26;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(a);
            ctx.beginPath();
            ctx.moveTo(-3, -2); ctx.lineTo(0, 3); ctx.lineTo(3, -2);
            ctx.stroke();
            ctx.restore();
        }
    } else if (tireId === 'rain') {
        // Wide channels (rain grooves)
        ctx.strokeStyle = '#00eaff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, 28, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 22, 0, Math.PI * 2);
        ctx.stroke();
        // Water droplets
        ctx.fillStyle = '#00eaff';
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(Math.cos(a) * 14, Math.sin(a) * 14, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
    } else if (tireId === 'slick') {
        // Smooth: almost no tread
        ctx.strokeStyle = 'rgba(255, 51, 85, 0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, 26, 0, Math.PI * 2);
        ctx.stroke();
        // Heat shimmer dots
        ctx.fillStyle = '#ff3355';
        ctx.shadowColor = '#ff3355';
        ctx.shadowBlur = 8;
        for (let i = 0; i < 4; i++) {
            const a = i * (Math.PI / 2) + 0.4;
            ctx.beginPath();
            ctx.arc(Math.cos(a) * 26, Math.sin(a) * 26, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.shadowBlur = 0;
    }

    // Hub
    ctx.fillStyle = '#1c2138';
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    // Lug nuts
    ctx.fillStyle = '#5a6088';
    for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 7, Math.sin(a) * 7, 1.5, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

function drawBodyKitIcon(ctx, w, h, kitId) {
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2);
    const s = Math.min(w / 110, h / 70);
    ctx.scale(s, s);
    drawCarTopDown(ctx, {
        shape: 'sedan',
        paint: '#5a6088',
        accent: '#00eaff',
        pattern: 'solid',
        bodyKit: { stock: 'stock', aero: 'spoiler', armored: 'sidebars', stealth: 'lowprofile' }[kitId] || 'stock',
        glow: true
    });
    ctx.restore();
}

// ============================================================
// SECTION: Car class: runtime physics + collisions
// ============================================================

/* ============================================================
 * Runtime Car physics
 *
 * Each Car is a small kinematic body in world coordinates.
 *
 *   Position:   (x, y)      world pixels
 *   Velocity:   (vx, vy)    world pixels/second (true velocity vector)
 *   Heading:    angle       radians, 0 = facing +x
 *   Speed:      |v|         derived from vx/vy each tick
 *
 * Stats are mapped through these constants:
 *   max speed      = 150 + speed_stat * 25   (px/s)
 *   acceleration   = 100 + accel_stat * 20   (px/s²)
 *   turn rate      = 1.0 + handling_stat * 0.25 (rad/s at speed)
 *   max health     = armor_stat * 10
 *
 * The physics model is arcade-style with a grip term that blends
 * velocity toward the heading, so the car broadly drives forward
 * but can be knocked sideways by collisions.
 * ============================================================ */

class Car {
    /**
     * @param {object} config
     *   - id         : string identifier (e.g. 'street_rocket')
     *   - baseStats  : { speed, handling, accel, armor }: base car stats
     *   - customization: same shape as State.get('customization'), used for paint/bodyKit and stat modifiers
     *   - isPlayer   : boolean
     *   - x, y, angle: starting pose
     */
    constructor(config) {
        config = config || {};
        this.id = config.id || 'car';
        this.isPlayer = !!config.isPlayer;
        this.baseStats = Object.assign({ speed: 6, handling: 6, accel: 6, armor: 6 }, config.baseStats);
        this.customization = Object.assign({
            engine: 'stock', tires: 'standard', bodyKit: 'stock',
            paint: '#00eaff', accent: '#ffffff', pattern: 'stripes'
        }, config.customization);

        // Final (combined) stats
        const final = (typeof computeFinalStats === 'function')
            ? computeFinalStats(this.baseStats, this.customization)
            : Object.assign({}, this.baseStats);
        this.stats = final;

        // Derived physics caps from stats
        this.maxSpeed     = 150 + final.speed    * 25;   // px/s
        this.acceleration = 100 + final.accel    * 20;   // px/s²
        this.brakingPower = 220 + final.accel    * 14;   // px/s² when braking
        this.turnRate     = 1.0 + final.handling * 0.25; // rad/s at full grip
        // Armor * 15 so that a full 3-lap race has comfortable HP headroom 
        // explosion is reserved for missile hits and repeated heavy
        // collisions, not normal scraping.
        this.maxHealth    = Math.max(30, final.armor * 15);

        // Pose
        this.x      = config.x || 0;
        this.y      = config.y || 0;
        this.angle  = config.angle || 0;
        this.vx     = 0;
        this.vy     = 0;
        this.speed  = 0;

        // Hitbox radius (used by collision); roughly half the visual length.
        this.radius = 24;

        // State
        this.health = this.maxHealth;
        this.powerupSlot = null;     // null | one of PowerupTypes ids
        this.alive = true;

        // Powerup timers (ms timestamps; effect active when now < value).
        // Defaulted to 0 so initial checks fail cleanly.
        this.shieldUntil   = 0;  // immune to damage
        this.boostUntil    = 0;  // +50% speed
        this.nitroUntil    = 0;  // massive instant burst
        this.stunUntil     = 0;  // no input, heavy drag (EMP)
        this.spinUntil     = 0;  // forced rotation (tornado, oil)
        this.oilDropUntil  = 0;  // currently dripping oil onto track
        this.oilDropTimer  = 0;  // accumulator for spacing oil patches

        // Explosion / wreck state. When health hits 0 the car explodes and
        // becomes a non-driveable wreck: race.js reads `exploded` to end the
        // race and award the win to the other car.
        this.exploded = false;
        this.explodedAt = 0;

        // Race state (filled in by race manager)
        this.lap = 0;
        this.waypointIndex = 0;
        this.lapProgress = 0; // 0..1 around the track
        this.position = 1;    // race position

        // Per-frame input accumulators (cleared at end of update)
        this._throttle = 0;     // 0..1
        this._brake    = 0;     // 0..1
        this._steerInput = 0;   // -1 (left) .. +1 (right)

        // Effects/visual state
        this.lastImpactTime = 0;
        this.smokeCounter = 0;
    }

    // ------------ Input API ------------

    /** Throttle in [0,1]. Accelerates car along its heading. */
    applyThrottle(amount) {
        this._throttle = Math.max(0, Math.min(1, amount || 0));
    }

    /** Brake in [0,1]. Decelerates car along its velocity vector. */
    applyBrake(amount) {
        this._brake = Math.max(0, Math.min(1, amount || 0));
    }

    /** Steering in [-1, +1]. -1 = full left, +1 = full right. */
    applySteering(amount) {
        this._steerInput = Math.max(-1, Math.min(1, amount || 0));
    }

    // ------------ Powerup API ------------

    /** Stash a powerup in the slot (no-op if already holding one). */
    pickupPowerup(name) {
        if (!this.powerupSlot) this.powerupSlot = name;
    }

    /** Activate the currently-held powerup. Returns the name consumed, or null.
     *  Most effects are handled by PowerupManager (which spawns projectiles,
     *  oil slicks, etc.); this method just clears the slot for simple cases.
     *  PowerupManager.activatePowerup() is the canonical entry point. */
    applyPowerup(powerup) {
        const p = powerup || this.powerupSlot;
        if (!p) return null;
        this.powerupSlot = null;
        return p;
    }

    isStunned()  { return performance.now() < this.stunUntil; }
    isSpinning() { return performance.now() < this.spinUntil; }
    isShielded() { return performance.now() < this.shieldUntil; }
    isBoosted()  { return performance.now() < this.boostUntil; }
    isNitro()    { return performance.now() < this.nitroUntil; }

    // ------------ Damage ------------

    /** Apply damage. While shielded, damage is fully absorbed. Health
     *  reaching 0 triggers the car's explosion and marks it as wrecked. */
    takeDamage(amount) {
        if (amount <= 0) return;
        if (this.exploded) return;
        if (this.isShielded()) return;
        this.health -= amount;
        this.lastImpactTime = performance.now();
        if (this.health <= 0) {
            this.health = 0;
            if (!this.exploded) {
                this.exploded = true;
                this.explodedAt = performance.now();
            }
        }
    }

    // ------------ Per-frame update ------------

    /**
     * Integrate physics for dt seconds.
     * @param {number} dt   timestep in seconds (cap at ~0.05 in caller)
     */
    update(dt) {
        if (dt <= 0) return;

        const now = performance.now();

        // Wrecked: ignore inputs, decelerate to a stop, no further physics.
        if (this.exploded) {
            this._throttle = this._brake = this._steerInput = 0;
            const k = Math.pow(0.15, dt); // strong drag so the wreck slides to a halt
            this.vx *= k;
            this.vy *= k;
            this.x += this.vx * dt;
            this.y += this.vy * dt;
            this.speed = Math.hypot(this.vx, this.vy);
            return;
        }

        const stunned  = now < this.stunUntil;
        const spinning = now < this.spinUntil;

        // While stunned: no throttle, no steering, extra drag (EMP).
        // While spinning: forced rapid rotation, no steering input (tornado/oil).
        if (stunned) {
            this._throttle = 0;
            this._brake = 0;
            this._steerInput = 0;
        }
        if (spinning) {
            this.angle += 9 * dt; // ~1.5 turns/sec
            this._steerInput = 0;
            this._throttle = Math.min(this._throttle, 0.2);
        }

        // ----- Throttle (along heading) -----
        const boosted = now < this.boostUntil;
        const nitro   = now < this.nitroUntil;
        const speedMult = nitro ? 2.2 : (boosted ? 1.6 : 1);
        const accel = this.acceleration * this._throttle * speedMult;
        const fdx = Math.cos(this.angle);
        const fdy = Math.sin(this.angle);
        this.vx += fdx * accel * dt;
        this.vy += fdy * accel * dt;

        // Signed forward speed: positive when moving along heading,
        // negative when reversing. Used by brake/reverse + grip.
        const forwardSpeed = this.vx * fdx + this.vy * fdy;

        // ----- Brake / reverse -----
        // ArrowDown / brake input behaves like a real arcade racer:
        //   - Moving forward → decelerate (brake against velocity).
        //   - Stopped or already reversing → accelerate backwards along the
        //     car's heading. Reverse uses ~60% of forward acceleration and is
        //     capped at ~40% of forward top speed (see cap block below).
        // This lets the player (and AI) back out after hitting a wall.
        const v = Math.hypot(this.vx, this.vy);
        if (this._brake > 0) {
            if (forwardSpeed > 30) {
                // Brake against velocity vector.
                const decel = Math.min(this.brakingPower * this._brake * dt, v);
                if (v > 0.1) {
                    this.vx -= (this.vx / v) * decel;
                    this.vy -= (this.vy / v) * decel;
                }
            } else {
                // Reverse: accelerate opposite to heading.
                const reverseAccel = this.acceleration * 0.6 * this._brake;
                this.vx -= fdx * reverseAccel * dt;
                this.vy -= fdy * reverseAccel * dt;
            }
        }

        // ----- Drag (so cars coast to a stop) -----
        const drag = Math.pow(0.5, dt); // ~50% velocity decay per second when coasting
        // Only apply gentle drag (not full 0.5: that'd kill the feel)
        const dragK = 1 - (1 - drag) * 0.2; // ≈ 0.9 over 1s
        this.vx *= dragK;
        this.vy *= dragK;

        // ----- Steering (rotate heading; speed-scaled so we can't pivot in place) -----
        const speedFactor = Math.min(1, v / 80); // need some speed to steer
        this.angle += this._steerInput * this.turnRate * speedFactor * dt;

        // ----- Grip: blend velocity toward the car's primary axis -----
        // Higher tire/handling → more grip → less lateral slip. The "primary
        // axis" sign respects the current direction of travel so reversing
        // doesn't get yanked back forward by the grip pull.
        const v2 = Math.hypot(this.vx, this.vy);
        if (v2 > 0.5) {
            const sign = forwardSpeed >= 0 ? 1 : -1;
            const tgtX = Math.cos(this.angle) * v2 * sign;
            const tgtY = Math.sin(this.angle) * v2 * sign;
            const gripRate = 1 - Math.pow(0.02, dt); // ≈ 98%/s pull toward heading
            this.vx += (tgtX - this.vx) * gripRate;
            this.vy += (tgtY - this.vy) * gripRate;
        }

        // ----- Cap top speed (forward: boost 1.5× / nitro 1.8× / base 1×;
        //                       reverse: 40% of base) -----
        const forwardCap = nitro ? this.maxSpeed * 1.8
                         : boosted ? this.maxSpeed * 1.5
                         : this.maxSpeed;
        const reverseCap = this.maxSpeed * 0.4;
        const finalV = Math.hypot(this.vx, this.vy);
        // Use the sign of forwardSpeed AFTER brake/reverse was applied
        const finalFwd = this.vx * fdx + this.vy * fdy;
        const cap = finalFwd >= 0 ? forwardCap : reverseCap;
        if (finalV > cap) {
            const s = cap / finalV;
            this.vx *= s;
            this.vy *= s;
        }

        // Extra drag while stunned
        if (stunned) {
            const k = Math.pow(0.3, dt);
            this.vx *= k;
            this.vy *= k;
        }

        // ----- Integrate position -----
        this.x += this.vx * dt;
        this.y += this.vy * dt;

        this.speed = Math.hypot(this.vx, this.vy);

        // ----- Tire smoke when braking hard or boosting -----
        if ((this._brake > 0.6 && this.speed > 80) || boosted) {
            this.smokeCounter += dt;
        } else {
            this.smokeCounter = 0;
        }

        // Per-frame inputs are persistent until overwritten by the controller.
        // (We do NOT clear them here race.js / ai.js sets them each tick.)
    }

    // ------------ Collisions ------------

    /**
     * Bounce off track walls when the car is past `halfRoadWidth` from the
     * closest centerline waypoint. The track geometry exposes a sampleClosest()
     * helper (see renderer.js) which returns { point, normal, segmentIndex }.
     *
     * @param {object} trackGeom  output of buildTrackGeometry()
     * @returns {boolean}  true if a wall hit happened
     */
    checkWallCollision(trackGeom) {
        if (!trackGeom || !trackGeom.waypoints || !trackGeom.waypoints.length) return false;

        // Find the nearest centerline waypoint.
        let bestI = 0, bestD2 = Infinity;
        const wps = trackGeom.waypoints;
        for (let i = 0; i < wps.length; i++) {
            const dx = wps[i].x - this.x;
            const dy = wps[i].y - this.y;
            const d2 = dx*dx + dy*dy;
            if (d2 < bestD2) { bestD2 = d2; bestI = i; }
        }
        this.waypointIndex = bestI;

        const halfWidth = trackGeom.halfRoadWidth || 80;
        const dist = Math.sqrt(bestD2);
        if (dist <= halfWidth - this.radius) return false;

        // Compute normal: from car toward centerline (push back onto road).
        const wp = wps[bestI];
        let nx = (wp.x - this.x);
        let ny = (wp.y - this.y);
        const nLen = Math.hypot(nx, ny) || 1;
        nx /= nLen; ny /= nLen;

        // Move car back onto the road.
        const push = dist - (halfWidth - this.radius);
        this.x += nx * push;
        this.y += ny * push;

        // Reflect velocity off the wall normal (lossy).
        const vDotN = this.vx * nx + this.vy * ny;
        if (vDotN < 0) {
            this.vx -= 1.6 * vDotN * nx;
            this.vy -= 1.6 * vDotN * ny;
        }
        // Energy loss.
        this.vx *= 0.55;
        this.vy *= 0.55;

        // Damage (scaled by impact velocity). Glances (<60 px/s impact) deal
        // no damage so the AI doesn't bleed HP just by scraping curbs.
        const impactVel = Math.abs(vDotN);
        if (impactVel > 60) {
            const dmg = Math.min(6, (impactVel - 60) * 0.025);
            this.takeDamage(dmg);
        }
        return true;
    }

    /**
     * Bump physics between two cars. Calls takeDamage on both.
     */
    checkCarCollision(other) {
        if (!other || other === this) return false;
        const dx = other.x - this.x;
        const dy = other.y - this.y;
        const dist = Math.hypot(dx, dy);
        const minDist = this.radius + other.radius;
        if (dist >= minDist || dist === 0) return false;

        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = minDist - dist;

        // Separate cars equally along the normal.
        this.x  -= nx * overlap * 0.5;
        this.y  -= ny * overlap * 0.5;
        other.x += nx * overlap * 0.5;
        other.y += ny * overlap * 0.5;

        // Exchange normal-component velocity (lossy elastic).
        const v1n = this.vx * nx + this.vy * ny;
        const v2n = other.vx * nx + other.vy * ny;
        const dv = v2n - v1n;
        const restitution = 0.6;
        this.vx  += dv * nx * restitution;
        this.vy  += dv * ny * restitution;
        other.vx -= dv * nx * restitution;
        other.vy -= dv * ny * restitution;

        // Damage proportional to closing speed. Light bumps (<80 px/s
        // closing) deal nothing: only meaningful side-swipes draw blood.
        const closing = Math.abs(dv);
        if (closing > 80) {
            const dmg = (closing - 80) * 0.04;
            this.takeDamage(dmg);
            other.takeDamage(dmg);
        }
        return true;
    }

    // ------------ Misc ------------

    /** Reset the car to a fresh starting pose (used by race manager). */
    reset(x, y, angle) {
        this.x = x; this.y = y;
        this.angle = angle || 0;
        this.vx = this.vy = this.speed = 0;
        this.health = this.maxHealth;
        this.powerupSlot = null;
        this.shieldActive = false;
        this.boostUntil = 0;
        this.lap = 0;
        this.lapProgress = 0;
        this.waypointIndex = 0;
        this._throttle = this._brake = this._steerInput = 0;
    }
}

if (typeof window !== 'undefined') window.Car = Car;
