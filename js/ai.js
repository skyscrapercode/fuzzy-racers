/* ============================================================================
 *  PROJECT     : Fuzzy Racers: AI Racing Game
 *  SUBJECT     : ISP568 Fuzzy Logic Systems
 *  FILE        : ai.js
 *  DESCRIPTION : Per-opponent AI controller. Owns a FuzzyEngine
 *                instance and re-evaluates it on a difficulty-dependent
 *                tick (Rookie 1.5 s, Racer 0.8 s, Champion 0.3 s).
 *                Between fuzzy ticks the cached outputs are reapplied
 *                each frame so the car has continuous input.
 *
 *  Steering is hybrid:
 *    - Direction comes from the geometry: angle delta to a
 *      look-ahead waypoint
 *    - Magnitude is the larger of the geometric need and the fuzzy
 *      engine's `steering` magnitude (the fuzzy hint reinforces
 *      "this is a corner: turn hard")
 *
 *  Throttle/brake/use_powerup come directly from the fuzzy engine.
 *
 *  Rubber-banding scales the AI's effective throttle by a factor
 *  derived from `difficulty.params.rubberBand` and the current gap.
 *  Champion additionally watches the player's powerup slot and
 *  defensively burns its own shield if it sees the player about to
 *  unleash something.
 * ============================================================================
 */

// ============================================================
// SECTION: AIController class
// ============================================================

class AIController {
    constructor(car, difficultyId) {
        this.car = car;
        this.difficultyId = difficultyId || 'racer';
        const d = (typeof getDifficulty === 'function') ? getDifficulty(this.difficultyId) : null;
        this.params = (d && d.params) || { tickMs: 800, noise: 0.10, powerupAggro: 0.6, rubberBand: 0.5, predictsPlayer: false };

        // Internal fuzzy engine
        this.fuzzy = new FuzzyEngine();

        // Tick scheduling
        this.lastTickAt = 0;
        this.cached = { throttle: 50, brake: 0, steering: 0, aggression: 50, use_powerup: 0 };
        this.cachedInputs = null;

        // How far ahead (in waypoints) the AI aims for steering and corner detection.
        this.lookAheadSteer  = 4;
        this.lookAheadCorner = 6;

        // For Champion's "predict player powerup" behavior
        this._lastPlayerSlot = null;
        this._playerArmedAt = 0;

        // Stuck-against-wall detection. If the AI tries to throttle but
        // barely moves for long enough, we override fuzzy output with a
        // brief reverse burst so the car can back out of the wall.
        this._stuckTimer  = 0;     // seconds of "throttling but not moving"
        this._reverseUntil = 0;    // ms timestamp; while now < this, apply brake

        // Cumulative stats for the post-race summary
        this.stats = {
            ticks: 0,
            ruleFires: {},                // ruleId → fire count
            outputSums: { throttle: 0, brake: 0, steering: 0, aggression: 0, use_powerup: 0 }
        };
    }

    /**
     * Called each frame from race.js. Re-evaluates the fuzzy engine on its
     * own schedule, then applies the cached outputs every frame.
     */
    update(dt, raceState) {
        // Wrecked car: no fuzzy ticks, no input, no powerup usage.
        if (this.car.exploded) return;
        const now = performance.now();
        if (now - this.lastTickAt >= this.params.tickMs) {
            this.lastTickAt = now;
            this._tick(raceState);
        }
        this._detectStuck(dt, now);
        this._applyOutputs(raceState);
        this._tryUsePowerup(raceState);
    }

    /**
     * Detect that the AI is wedged against a wall (high throttle, near-zero
     * speed) and trigger a 700 ms reverse burst when the condition has held
     * for ~0.7 seconds. Resets as soon as the car is moving again. The
     * actual reverse motion is applied in _applyOutputs() by holding brake
     * instead of throttle.
     */
    _detectStuck(dt, now) {
        const wantingForward = (this.cached.throttle || 0) > 25;
        const speed = this.car.speed || 0;
        if (now < this._reverseUntil) return;  // already reversing
        if (wantingForward && speed < 25) {
            this._stuckTimer += dt;
            if (this._stuckTimer >= 0.7) {
                this._reverseUntil = now + 700;
                this._stuckTimer = 0;
            }
        } else {
            this._stuckTimer = 0;
        }
    }

    /** Heavy work: build fuzzy inputs, run inference, cache outputs. */
    _tick(raceState) {
        const inputs = this._buildInputs(raceState);
        const outputs = this.fuzzy.infer(inputs);

        // Apply per-tick noise (multiplicative) to simulate AI mistakes.
        const n = this.params.noise || 0;
        if (n > 0) {
            for (const k in outputs) {
                const jitter = 1 + (Math.random() * 2 - 1) * n;
                outputs[k] *= jitter;
            }
        }

        this.cached = outputs;
        this.cachedInputs = inputs;

        // Update cumulative stats for the post-race summary.
        this.stats.ticks++;
        for (const k in this.stats.outputSums) {
            if (outputs[k] != null) this.stats.outputSums[k] += outputs[k];
        }
        const dbg = this.fuzzy.getFuzzyDebugInfo();
        if (dbg && dbg.active_rules) {
            for (const r of dbg.active_rules) {
                this.stats.ruleFires[r.id] = (this.stats.ruleFires[r.id] || 0) + 1;
            }
        }

        // Champion: snapshot the moment the player picked up a new powerup.
        if (this.params.predictsPlayer) {
            const slot = raceState.player.powerupSlot;
            if (slot && slot !== this._lastPlayerSlot) {
                this._lastPlayerSlot = slot;
                this._playerArmedAt = performance.now();
            } else if (!slot) {
                this._lastPlayerSlot = null;
            }
        }
    }

    /** Build the 6 crisp inputs to the fuzzy engine. */
    _buildInputs(raceState) {
        const car = this.car;
        const player = raceState.player;
        const track = raceState.track;

        const dx = player.x - car.x;
        const dy = player.y - car.y;
        const distance = Math.min(1000, Math.hypot(dx, dy));

        const player_speed = Math.min(100, (player.speed / Math.max(1, player.maxSpeed)) * 100);

        // Corner sharpness from the waypoint a few ticks ahead.
        const N = track.waypoints.length;
        const cornerIdx = (car.waypointIndex + this.lookAheadCorner) % N;
        const corner = track.waypoints[cornerIdx].sharpness;

        const health = (car.health / Math.max(1, car.maxHealth)) * 100;

        // Gap: positive = AI ahead of player, negative = AI behind player.
        // raceState provides this signed value already scaled.
        const gap = raceState.gapAI;

        const powerup = car.powerupSlot ? 100 : 0;

        return { distance, player_speed, corner, health, gap, powerup };
    }

    /** Push the cached outputs onto the Car each frame. */
    _applyOutputs(raceState) {
        const car = this.car;
        const out = this.cached;
        const track = raceState.track;

        // Steering: geometry-driven sign with fuzzy magnitude reinforcement.
        const N = track.waypoints.length;
        const tgt = track.waypoints[(car.waypointIndex + this.lookAheadSteer) % N];
        const desired = Math.atan2(tgt.y - car.y, tgt.x - car.x);
        let delta = desired - car.angle;
        while (delta >  Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        const geoMag = Math.max(-1, Math.min(1, delta * 1.8));
        const fuzzyMag = Math.abs(out.steering || 0) / 100;
        const sign = geoMag >= 0 ? 1 : -1;
        const steer = sign * Math.min(1, Math.max(Math.abs(geoMag), fuzzyMag * 0.4));

        // Reverse override: when stuck against a wall, hold brake (which
        // triggers reverse at low speed in car.js) and steer AWAY from the
        // intended racing line so we don't immediately re-collide. We invert
        // the steer sign so the car backs out at an angle.
        if (performance.now() < this._reverseUntil) {
            car.applySteering(-steer * 0.6);
            car.applyThrottle(0);
            car.applyBrake(1);
            return;
        }

        car.applySteering(steer);

        // Throttle: rubber-banded.
        const throttle0 = Math.max(0, Math.min(1, (out.throttle || 0) / 100));
        const rb = this._rubberBandMultiplier(raceState);
        car.applyThrottle(Math.max(0, Math.min(1, throttle0 * rb)));

        // Brake: from fuzzy.
        car.applyBrake(Math.max(0, Math.min(1, (out.brake || 0) / 100)));
    }

    /**
     * Rubber-banding factor. Scales throttle up when AI is behind, down
     * (slightly) when far ahead. Strength is `difficulty.params.rubberBand`.
     */
    _rubberBandMultiplier(raceState) {
        const rb = this.params.rubberBand || 0;
        const gap = raceState.gapAI || 0; // negative = behind
        if (rb === 0) return 1;
        if (gap < -10) {
            return 1 + rb * Math.min(1, -gap / 50);
        }
        if (gap > 30) {
            return Math.max(0.7, 1 - rb * 0.25);
        }
        return 1;
    }

    /**
     * Decide whether to fire the held powerup this frame, via the shared
     * PowerupManager rule, with a Champion-only "predict player" hook.
     */
    _tryUsePowerup(raceState) {
        if (!this.car.powerupSlot) return;

        const ctx = {
            gap:      raceState.gapAI,
            distance: this.cachedInputs ? this.cachedInputs.distance : 1000,
            corner:   this.cachedInputs ? this.cachedInputs.corner   : 0
        };
        const shouldUse = PowerupManager.shouldAIUsePowerup(this.car, this.cached, ctx);

        if (shouldUse) {
            const used = PowerupManager.activatePowerup(this.car, raceState.cars, raceState.track);
            if (used && typeof AudioManager !== 'undefined') AudioManager.activatePowerup(used);
            return;
        }

        // Champion: if player picked up a powerup in the last 400-1200 ms and AI
        // is holding a shield, deploy preemptively.
        if (this.params.predictsPlayer && this.car.powerupSlot === 'shield') {
            const since = performance.now() - this._playerArmedAt;
            if (this._lastPlayerSlot && since > 400 && since < 1200) {
                const used = PowerupManager.activatePowerup(this.car, raceState.cars, raceState.track);
                if (used && typeof AudioManager !== 'undefined') AudioManager.activatePowerup(used);
            }
        }
    }

    /** Expose the last fuzzy snapshot for the in-race inspector. */
    getFuzzyDebug() {
        return this.fuzzy.getFuzzyDebugInfo();
    }

    /** Stats summary for the results page: top rules, averages, fuzzy totals. */
    getRaceSummary() {
        const rules = this.fuzzy.getRules();
        const ruleById = new Map(rules.map(r => [r.id, r]));
        const fires = Object.entries(this.stats.ruleFires)
            .map(([id, count]) => {
                const rule = ruleById.get(+id);
                return rule ? { id: +id, count, antecedents: rule.antecedents, consequent: rule.consequent, why: rule.why } : null;
            })
            .filter(Boolean)
            .sort((a, b) => b.count - a.count);

        const avg = {};
        for (const k in this.stats.outputSums) {
            avg[k] = this.stats.ticks > 0 ? this.stats.outputSums[k] / this.stats.ticks : 0;
        }

        return {
            ticks: this.stats.ticks,
            totalRuleFires: fires.reduce((s, r) => s + r.count, 0),
            topRules: fires.slice(0, 5),
            allRules: fires,
            outputAverages: avg,
            difficulty: this.difficultyId
        };
    }
}

// ============================================================
// SECTION: Public entry point: updateAI()
// ============================================================

/**
 * Plain-function entry point used by race.js. Lazily attaches a controller
 * to the car if one doesn't exist.
 */
function updateAI(aiCar, playerCar, track, difficultyId, raceState) {
    if (!aiCar._controller) {
        aiCar._controller = new AIController(aiCar, difficultyId);
    }
    aiCar._controller.update(raceState.dt, raceState);
}

if (typeof window !== 'undefined') {
    window.AIController = AIController;
    window.updateAI = updateAI;
}
