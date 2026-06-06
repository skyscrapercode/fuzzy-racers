/* ============================================================================
 *  PROJECT     : Fuzzy Racers: AI Racing Game
 *  SUBJECT     : ISP568 Fuzzy Logic Systems
 *  FILE        : powerups.js
 *  DESCRIPTION : Powerup system: registry, collectible boxes, homing
 *                missiles, oil slicks, EMP rings, tornado effects,
 *                manager, and the fuzzy-driven "should AI use powerup
 *                now?" decision helper consumed by ai.js.
 *  - PowerupBox   : rotating glowing crate scattered on the track
 *  - Projectile   : homing missile
 *  - OilSlick     : track hazard dropped behind a car
 *  - PowerupManager: owns all boxes/projectiles/slicks/effects,
 *                    handles activation, AI use decisions, drawing.
 *
 *  All drawing is in WORLD coordinates the race manager translates
 *  the ctx to camera space before calling PowerupManager.draw().
 * ============================================================ */

// ============================================================
// SECTION: Powerup Registry (8 types)
// ============================================================

const PowerupTypes = [
    {
        id: 'boost',
        name: 'Speed Boost',
        icon: '🔴',
        color: '#ff3355',
        category: 'speed',
        durationMs: 5000,
        desc: '+50% speed for 5s'
    },
    {
        id: 'shield',
        name: 'Shield',
        icon: '🛡️',
        color: '#00eaff',
        category: 'defensive',
        durationMs: 6000,
        desc: 'Immune to damage for 6s'
    },
    {
        id: 'missile',
        name: 'Missile',
        icon: '🎯',
        color: '#ffd400',
        category: 'aggressive',
        damage: 15,
        desc: 'Homing rocket: 15 HP damage'
    },
    {
        id: 'oil',
        name: 'Oil Slick',
        icon: '🌊',
        color: '#1a1a1a',
        category: 'aggressive',
        durationMs: 4000,    // how long the car keeps dripping
        slickLifeMs: 14000,  // how long each patch stays on track
        desc: 'Drop oil behind you'
    },
    {
        id: 'emp',
        name: 'EMP Blast',
        icon: '⚡',
        color: '#a479ff',
        category: 'aggressive',
        durationMs: 2000,
        radius: 280,
        desc: 'Stun nearby cars for 2s'
    },
    {
        id: 'repair',
        name: 'Repair Kit',
        icon: '🔧',
        color: '#39ff7a',
        category: 'defensive',
        heal: 40,
        desc: 'Instantly restore 40 HP'
    },
    {
        id: 'tornado',
        name: 'Tornado',
        icon: '🌀',
        color: '#88ddff',
        category: 'aggressive',
        durationMs: 2000,
        desc: 'Spin out the car ahead'
    },
    {
        id: 'nitro',
        name: 'Nitro Surge',
        icon: '💨',
        color: '#00eaff',
        category: 'speed',
        durationMs: 2000,
        requiresNitroEngine: true,
        desc: 'Massive 2s burst (Nitro Engine only)'
    }
];

function getPowerupType(id) {
    return PowerupTypes.find(p => p.id === id) || null;
}

/** Spawnable powerups (filtered by what's allowed for this player loadout). */
function spawnablePowerups(customization) {
    const out = [];
    for (const p of PowerupTypes) {
        if (p.requiresNitroEngine && customization?.engine !== 'nitro') continue;
        out.push(p);
    }
    return out;
}

// ============================================================
// SECTION: PowerupBox (collectible crate on the track)
// ============================================================

class PowerupBox {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.type = type;      // id string; assigned on (re)spawn
        this.spawnTime = performance.now();
        this.collected = false;
        this.collectedAt = 0;
        this.rotation = Math.random() * Math.PI * 2;
        this.radius = 22;
    }

    update(dt) {
        this.rotation += 1.6 * dt; // spin
    }

    contains(car) {
        const dx = car.x - this.x;
        const dy = car.y - this.y;
        return (dx*dx + dy*dy) < (this.radius + car.radius) * (this.radius + car.radius);
    }

    draw(ctx) {
        if (this.collected) return;
        const t = getPowerupType(this.type);
        const color = t ? t.color : '#ffffff';
        const pulse = 0.85 + 0.15 * Math.sin(performance.now() / 180);

        ctx.save();
        ctx.translate(this.x, this.y);

        // Halo
        ctx.fillStyle = color + '22';
        ctx.shadowColor = color;
        ctx.shadowBlur = 22 * pulse;
        ctx.beginPath();
        ctx.arc(0, 0, this.radius * 1.5 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Floating crate (diamond shape rotating)
        ctx.rotate(this.rotation);
        ctx.fillStyle = '#0a0d18';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        const r = this.radius;
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r, 0);
        ctx.lineTo(0, r);
        ctx.lineTo(-r, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Inner icon (drawn upright: counter-rotate)
        ctx.rotate(-this.rotation);
        _drawPowerupIcon(ctx, this.type, color);
        ctx.restore();
    }
}

/** Draw a small canvas icon for the powerup centered at (0,0). */
function _drawPowerupIcon(ctx, typeId, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (typeId) {
        case 'boost': {
            // Flame triangle
            ctx.beginPath();
            ctx.moveTo(-6, 6); ctx.quadraticCurveTo(-2, -2, 0, -8);
            ctx.quadraticCurveTo(4, -2, 6, 6);
            ctx.quadraticCurveTo(0, 3, -6, 6);
            ctx.closePath();
            ctx.fill();
            break;
        }
        case 'shield': {
            ctx.beginPath();
            ctx.moveTo(0, -8);
            ctx.lineTo(7, -4); ctx.lineTo(7, 3);
            ctx.quadraticCurveTo(0, 9, -7, 3);
            ctx.lineTo(-7, -4);
            ctx.closePath();
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(-3, 0); ctx.lineTo(-1, 3); ctx.lineTo(4, -3);
            ctx.stroke();
            break;
        }
        case 'missile': {
            // Rocket body + nose + fins
            ctx.beginPath();
            ctx.moveTo(7, 0); ctx.lineTo(-4, -3); ctx.lineTo(-6, -3);
            ctx.lineTo(-4, 0); ctx.lineTo(-6, 3); ctx.lineTo(-4, 3);
            ctx.closePath();
            ctx.fill();
            // Tip flash
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(6, 0, 1.5, 0, Math.PI * 2);
            ctx.fill();
            break;
        }
        case 'oil': {
            ctx.fillStyle = '#222';
            ctx.beginPath();
            ctx.ellipse(0, 1, 8, 4, 0, 0, Math.PI * 2);
            ctx.fill();
            // shine
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.ellipse(-3, -0.5, 2, 1, 0, 0, Math.PI * 2);
            ctx.fill();
            break;
        }
        case 'emp': {
            // Lightning bolt
            ctx.beginPath();
            ctx.moveTo(2, -8); ctx.lineTo(-3, 0); ctx.lineTo(1, 0);
            ctx.lineTo(-2, 8); ctx.lineTo(4, -1); ctx.lineTo(0, -1);
            ctx.closePath();
            ctx.fill();
            break;
        }
        case 'repair': {
            // Plus / cross
            ctx.fillRect(-2, -8, 4, 16);
            ctx.fillRect(-8, -2, 16, 4);
            break;
        }
        case 'tornado': {
            // Spiral
            ctx.beginPath();
            for (let i = 0; i < 30; i++) {
                const a = i * 0.6;
                const r = i * 0.27;
                const x = Math.cos(a) * r;
                const y = Math.sin(a) * r;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
            break;
        }
        case 'nitro': {
            // NOS bottle silhouette
            ctx.fillStyle = '#0a0d18';
            ctx.fillRect(-3, -7, 6, 14);
            ctx.fillStyle = color;
            ctx.fillRect(-3, -7, 6, 4);
            ctx.fillRect(-1, -9, 2, 2);
            ctx.fillStyle = '#0a0d18';
            ctx.font = '700 6px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('N', 0, 1);
            break;
        }
    }
    ctx.restore();
}

// ============================================================
// SECTION: Projectile (homing missile)
// ============================================================

class Projectile {
    constructor(opts) {
        this.x = opts.x;
        this.y = opts.y;
        this.vx = opts.vx || 0;
        this.vy = opts.vy || 0;
        this.angle = opts.angle || 0;
        this.target = opts.target;        // car to home toward
        this.owner = opts.owner;
        this.damage = opts.damage || 15;
        this.life = 4.5;                  // seconds until self-destruct
        this.speed = 520;                 // px/s
        this.alive = true;
    }

    update(dt, cars, particles) {
        if (!this.alive) return;

        // Homing: steer the velocity toward target's predicted position.
        if (this.target && this.target.alive !== false) {
            const tx = this.target.x;
            const ty = this.target.y;
            const dx = tx - this.x;
            const dy = ty - this.y;
            const desired = Math.atan2(dy, dx);
            // Smoothly rotate current heading toward desired (limit turn rate)
            let delta = desired - this.angle;
            while (delta >  Math.PI) delta -= 2 * Math.PI;
            while (delta < -Math.PI) delta += 2 * Math.PI;
            const maxTurn = 4.5 * dt; // rad/s
            if (delta >  maxTurn) delta =  maxTurn;
            if (delta < -maxTurn) delta = -maxTurn;
            this.angle += delta;
        }

        this.vx = Math.cos(this.angle) * this.speed;
        this.vy = Math.sin(this.angle) * this.speed;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= dt;

        // Smoke trail
        if (particles && Math.random() < 0.7) {
            particles.push({
                x: this.x - Math.cos(this.angle) * 10,
                y: this.y - Math.sin(this.angle) * 10,
                vx: -this.vx * 0.05, vy: -this.vy * 0.05,
                life: 0.5, maxLife: 0.5,
                color: '#888', size: 4 + Math.random() * 3, type: 'smoke'
            });
        }

        // Collision with any car other than owner
        for (const c of cars) {
            if (c === this.owner) continue;
            const dx = c.x - this.x, dy = c.y - this.y;
            if (dx*dx + dy*dy < (c.radius + 10) * (c.radius + 10)) {
                c.takeDamage(this.damage);
                if (typeof AudioManager !== 'undefined') AudioManager.hit();
                if (particles) Particles.spawnExplosion(particles, this.x, this.y, '#ff8800');
                this.alive = false;
                return;
            }
        }

        if (this.life <= 0) {
            if (particles) Particles.spawnExplosion(particles, this.x, this.y, '#ff8800');
            this.alive = false;
        }
    }

    draw(ctx) {
        if (!this.alive) return;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        // Exhaust glow
        ctx.fillStyle = '#ffd400';
        ctx.shadowColor = '#ff3355';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.moveTo(-12, -3); ctx.lineTo(-22, 0); ctx.lineTo(-12, 3);
        ctx.closePath();
        ctx.fill();
        // Body
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#dadada';
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        roundedRect(ctx, -10, -3, 18, 6, 2);
        ctx.fill(); ctx.stroke();
        // Nose
        ctx.fillStyle = '#ff3355';
        ctx.beginPath();
        ctx.moveTo(8, 0); ctx.lineTo(4, -3); ctx.lineTo(4, 3); ctx.closePath();
        ctx.fill();
        // Fins
        ctx.fillStyle = '#333';
        ctx.fillRect(-9, -5, 4, 2);
        ctx.fillRect(-9,  3, 4, 2);
        ctx.restore();
    }
}

// ============================================================
// SECTION: OilSlick (track hazard)
// ============================================================

class OilSlick {
    constructor(x, y, ownerId) {
        this.x = x;
        this.y = y;
        this.ownerId = ownerId;
        this.life = 14;            // seconds on track
        this.maxLife = 14;
        this.radius = 22;
        this.angle = Math.random() * Math.PI * 2;
        this.triggered = new WeakSet();
    }

    update(dt, cars) {
        this.life -= dt;
        if (this.life <= 0) return;
        for (const c of cars) {
            if (c.id === this.ownerId) continue;
            if (this.triggered.has(c)) continue;
            const dx = c.x - this.x, dy = c.y - this.y;
            if (dx*dx + dy*dy < (this.radius + c.radius * 0.6) ** 2) {
                this.triggered.add(c);
                c.spinUntil = Math.max(c.spinUntil, performance.now() + 1500);
            }
        }
    }

    draw(ctx) {
        if (this.life <= 0) return;
        const fade = Math.min(1, this.life / 2); // fade out in last 2s
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        ctx.globalAlpha = 0.8 * fade;
        // Dark puddle
        const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, this.radius);
        grad.addColorStop(0, '#1a1a1a');
        grad.addColorStop(0.7, '#0a0a0a');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(0, 0, this.radius * 1.2, this.radius * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();
        // Rainbow shimmer
        ctx.globalAlpha = 0.4 * fade;
        ctx.fillStyle = '#a479ff';
        ctx.beginPath();
        ctx.ellipse(-6, -3, 4, 1.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#39ff7a';
        ctx.beginPath();
        ctx.ellipse(4, 3, 5, 1.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
    }
}

// ============================================================
// SECTION: PowerupManager (orchestrates boxes, projectiles, slicks, effects)
// ============================================================

const PowerupManager = {
    BOX_COUNT: 6,
    RESPAWN_MS: 10000,
    OIL_INTERVAL_MS: 250,

    boxes: [],
    projectiles: [],
    oilSlicks: [],
    visualEffects: [],   // EMP rings, tornado spirals on targets, etc.
    particles: [],

    /**
     * Place 6 boxes around the track on randomly-chosen waypoints, spread out
     * so they're not clumped. Pool is the spawnable powerup types (filtered
     * by Nitro engine availability).
     */
    init(geom, playerCustomization) {
        this.boxes.length = 0;
        this.projectiles.length = 0;
        this.oilSlicks.length = 0;
        this.visualEffects.length = 0;
        this.particles.length = 0;
        this._pool = spawnablePowerups(playerCustomization);
        if (!geom || !geom.waypoints) return;

        // Pick BOX_COUNT roughly-equidistant waypoint indices.
        const N = geom.waypoints.length;
        const stride = Math.floor(N / this.BOX_COUNT);
        for (let k = 0; k < this.BOX_COUNT; k++) {
            const idx = (k * stride + Math.floor(Math.random() * stride * 0.5)) % N;
            const wp = geom.waypoints[idx];
            // Offset randomly across the road width
            const lat = (Math.random() - 0.5) * geom.halfRoadWidth * 1.2;
            const nx = -Math.sin(wp.tangent), ny = Math.cos(wp.tangent);
            this.boxes.push(new PowerupBox(wp.x + nx * lat, wp.y + ny * lat, this._pickType()));
        }
    },

    _pickType() {
        const pool = this._pool || PowerupTypes;
        return pool[Math.floor(Math.random() * pool.length)].id;
    },

    /**
     * Per-frame tick: spin boxes, check pickups, update projectiles, age
     * oil slicks, dribble oil out of cars with active oil drops, age visual
     * effects, update particle pool.
     */
    update(dt, cars) {
        const now = performance.now();

        // Boxes
        for (const box of this.boxes) {
            if (box.collected) {
                if (now - box.collectedAt > this.RESPAWN_MS) {
                    box.collected = false;
                    box.type = this._pickType();
                    box.spawnTime = now;
                }
                continue;
            }
            box.update(dt);
            // Check pickup
            for (const car of cars) {
                if (!car.powerupSlot && box.contains(car)) {
                    // Skip nitro pickup if car doesn't have Nitro Engine
                    const ptype = getPowerupType(box.type);
                    if (ptype.requiresNitroEngine && car.customization?.engine !== 'nitro') {
                        continue;
                    }
                    car.powerupSlot = box.type;
                    box.collected = true;
                    box.collectedAt = now;
                    Particles.spawnSparks(this.particles, box.x, box.y, 8, ptype.color);
                    break;
                }
            }
        }

        // Projectiles
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            p.update(dt, cars, this.particles);
            if (!p.alive) this.projectiles.splice(i, 1);
        }

        // Oil slicks
        for (let i = this.oilSlicks.length - 1; i >= 0; i--) {
            const s = this.oilSlicks[i];
            s.update(dt, cars);
            if (s.life <= 0) this.oilSlicks.splice(i, 1);
        }

        // Active oil drips (cars currently spreading oil)
        for (const car of cars) {
            if (now < car.oilDropUntil) {
                car.oilDropTimer = (car.oilDropTimer || 0) + dt * 1000;
                if (car.oilDropTimer >= this.OIL_INTERVAL_MS) {
                    car.oilDropTimer = 0;
                    // Spawn slick slightly behind the car
                    const bx = car.x - Math.cos(car.angle) * 28;
                    const by = car.y - Math.sin(car.angle) * 28;
                    this.oilSlicks.push(new OilSlick(bx, by, car.id));
                }
            }
        }

        // Repair sparkles trailing recently-repaired cars
        for (const car of cars) {
            if (car._repairSparkleUntil && now < car._repairSparkleUntil) {
                if (Math.random() < 0.6) {
                    this.particles.push({
                        x: car.x + (Math.random() - 0.5) * 40,
                        y: car.y + (Math.random() - 0.5) * 30,
                        vx: 0, vy: -30,
                        life: 0.6, maxLife: 0.6,
                        color: '#39ff7a', size: 2, type: 'spark'
                    });
                }
            }
        }

        // Visual-only effects (EMP rings expanding, tornado funnels on targets)
        for (let i = this.visualEffects.length - 1; i >= 0; i--) {
            const e = this.visualEffects[i];
            e.age += dt;
            if (e.age >= e.duration) this.visualEffects.splice(i, 1);
        }

        // Particles
        Particles.update(this.particles, dt);
    },

    /**
     * Activate the car's held powerup. Returns the activated type id, or
     * null if no powerup was held or the prerequisites failed (e.g. nitro
     * without Nitro Engine).
     */
    activatePowerup(car, cars, geom) {
        if (!car.powerupSlot) return null;
        const id = car.powerupSlot;
        const t = getPowerupType(id);
        if (!t) { car.powerupSlot = null; return null; }
        const now = performance.now();

        switch (id) {
            case 'boost':
                car.boostUntil = now + t.durationMs;
                break;
            case 'shield':
                car.shieldUntil = now + t.durationMs;
                break;
            case 'missile': {
                const target = this._findCarAhead(car, cars, geom);
                if (!target) return null; // don't consume if nothing to shoot at
                const aimAngle = Math.atan2(target.y - car.y, target.x - car.x);
                this.projectiles.push(new Projectile({
                    x: car.x + Math.cos(car.angle) * 32,
                    y: car.y + Math.sin(car.angle) * 32,
                    angle: aimAngle,
                    target, owner: car, damage: t.damage
                }));
                break;
            }
            case 'oil':
                car.oilDropUntil = now + t.durationMs;
                car.oilDropTimer = this.OIL_INTERVAL_MS; // drop one immediately
                break;
            case 'emp': {
                this.visualEffects.push({ type: 'emp', x: car.x, y: car.y, radius: t.radius, age: 0, duration: 0.7 });
                for (const other of cars) {
                    if (other === car) continue;
                    const dx = other.x - car.x, dy = other.y - car.y;
                    if (dx*dx + dy*dy < t.radius * t.radius) {
                        other.stunUntil = Math.max(other.stunUntil, now + t.durationMs);
                    }
                }
                break;
            }
            case 'repair':
                car.health = Math.min(car.maxHealth, car.health + t.heal);
                car._repairSparkleUntil = now + 900;
                break;
            case 'tornado': {
                const target = this._findCarAhead(car, cars, geom);
                if (!target) return null;
                target.spinUntil = Math.max(target.spinUntil, now + t.durationMs);
                this.visualEffects.push({ type: 'tornado', target, age: 0, duration: t.durationMs / 1000 });
                break;
            }
            case 'nitro':
                if (car.customization?.engine !== 'nitro') return null;
                car.nitroUntil = now + t.durationMs;
                break;
        }

        car.powerupSlot = null;

        // Record stats if the car has a stats bag attached (race.js sets these up).
        if (car._stats) {
            car._stats.powerupsUsed.count = (car._stats.powerupsUsed.count || 0) + 1;
            car._stats.powerupsUsed.types[id] = (car._stats.powerupsUsed.types[id] || 0) + 1;
        }

        return id;
    },

    /**
     * Find the car immediately ahead of `from` along the track. Picks the
     * nearest car whose direction-of-travel projection onto `from`'s heading
     * is positive (i.e. in front).
     */
    _findCarAhead(from, cars, geom) {
        let best = null, bestDist = Infinity;
        const fdx = Math.cos(from.angle), fdy = Math.sin(from.angle);
        for (const c of cars) {
            if (c === from) continue;
            const dx = c.x - from.x, dy = c.y - from.y;
            const forward = dx * fdx + dy * fdy;
            if (forward <= 0) continue;
            const d = Math.hypot(dx, dy);
            if (d < bestDist) { best = c; bestDist = d; }
        }
        return best;
    },

    // ------------------------------------------------------------
    // AI use-decision helper (consumed by ai.js)
    //
    // Returns true if the AI should fire its currently-held powerup right
    // now, given the fuzzy engine's `use_powerup` output and the broader
    // race state. The per-category gates encode the spec:
    //
    //   - Aggressive powerups: use when losing AND player is close
    //   - Defensive powerups : use when health is low
    //   - Speed powerups     : use on a long straight when losing
    // ------------------------------------------------------------

    shouldAIUsePowerup(car, fuzzyOutput, raceContext) {
        if (!car.powerupSlot) return false;
        const t = getPowerupType(car.powerupSlot);
        if (!t) return false;
        if (t.requiresNitroEngine && car.customization?.engine !== 'nitro') return false;

        const fz   = (fuzzyOutput && fuzzyOutput.use_powerup) || 0;
        const gap  = raceContext?.gap ?? 0;        // negative = losing
        const dist = raceContext?.distance ?? 1000;
        const corner = raceContext?.corner ?? 0;
        const hpPct  = car.health / car.maxHealth;

        if (t.category === 'aggressive') {
            // Losing badly OR (losing and player close), and fuzzy says go.
            const losing = gap < -10;
            const close  = dist < 280;
            return fz > 55 && losing && (close || gap < -50);
        }
        if (t.category === 'defensive') {
            if (t.id === 'shield')  return fz > 50 && (hpPct < 0.5 || (dist < 200 && gap < 0));
            if (t.id === 'repair')  return hpPct < 0.45;
        }
        if (t.category === 'speed') {
            // Use on a near-straight section when behind, or panic-fire if fz very high.
            return (corner < 35 && gap < -5 && fz > 50) || fz > 85;
        }
        return false;
    },

    // ------------------------------------------------------------
    // DRAW (world space)
    // ------------------------------------------------------------

    draw(ctx) {
        // Oil slicks (drawn first so cars/missiles render on top)
        for (const s of this.oilSlicks) s.draw(ctx);
        // Boxes
        for (const b of this.boxes) b.draw(ctx);
        // Projectiles
        for (const p of this.projectiles) p.draw(ctx);
        // Visual effects (EMP rings, tornados)
        for (const e of this.visualEffects) this._drawEffect(ctx, e);
        // Particles last
        Renderer.drawParticles(ctx, this.particles);
    },

    _drawEffect(ctx, e) {
        const t = e.age / e.duration;
        if (t >= 1) return;
        if (e.type === 'emp') {
            const r = e.radius * t;
            ctx.save();
            ctx.translate(e.x, e.y);
            ctx.strokeStyle = '#a479ff';
            ctx.shadowColor = '#a479ff';
            ctx.shadowBlur = 26 * (1 - t);
            ctx.lineWidth = 4 * (1 - t) + 1;
            ctx.globalAlpha = 1 - t;
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.stroke();
            // Inner glow ring
            ctx.lineWidth = 2;
            ctx.globalAlpha = (1 - t) * 0.4;
            ctx.beginPath();
            ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
        } else if (e.type === 'tornado') {
            const tgt = e.target;
            if (!tgt) return;
            ctx.save();
            ctx.translate(tgt.x, tgt.y);
            ctx.rotate(performance.now() / 80);
            ctx.strokeStyle = '#88ddff';
            ctx.shadowColor = '#88ddff';
            ctx.shadowBlur = 16;
            ctx.lineWidth = 2;
            ctx.globalAlpha = 1 - t * 0.5;
            ctx.beginPath();
            for (let i = 0; i < 80; i++) {
                const a = i * 0.35;
                const r = 2 + i * 0.45;
                const x = Math.cos(a) * r;
                const y = Math.sin(a) * r;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.restore();
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
        }
    }
};

if (typeof window !== 'undefined') {
    window.PowerupTypes  = PowerupTypes;
    window.PowerupBox    = PowerupBox;
    window.Projectile    = Projectile;
    window.OilSlick      = OilSlick;
    window.PowerupManager= PowerupManager;
    window.getPowerupType= getPowerupType;
}
