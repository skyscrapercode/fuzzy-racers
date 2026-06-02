/* ============================================================================
 *  PROJECT     : Fuzzy Racers — AI Racing Game
 *  SUBJECT     : ISP568 Fuzzy Logic Systems
 *  FILE        : race.js
 *  DESCRIPTION : Race manager. Owns the canvas, the world, the cars,
 *                the powerup manager,
 *  and the main game loop. All inter-page configuration (selected
 *  car, customization, opponent, difficulty, track) is read from
 *  state.js at init.
 *
 *  Loop runs at requestAnimationFrame (~60 fps). The clock dt is
 *  capped at 50 ms to avoid huge integration steps after tab
 *  pauses or stutters.
 *
 *  Phases:
 *    'countdown'  – 3 / 2 / 1 / GO! overlay, cars frozen
 *    'racing'     – physics + AI + input live
 *    'paused'     – frozen, "P to resume" overlay
 *    'finished'   – frozen, brief "FINISHED" overlay, redirect
 *
 *  Lap detection uses waypoint progress: when a car's lapProgress
 *  wraps from > 0.8 back to < 0.2 in the forward direction we
 *  count a lap. Total laps = 3.
 * ============================================================ */

const TOTAL_LAPS = 3;

const Race = {
    // Phase
    phase: 'loading',

    // Entities
    canvas: null,
    ctx: null,
    track: null,
    player: null,
    ai: null,
    cars: [],

    // Input
    keys: Object.create(null),

    // Timing
    startedAt: 0,
    lastFrameTime: 0,
    countdown: { phase: 0, timer: 0 }, // 0..3 (3,2,1,GO)
    finishedAt: 0,
    winner: null,

    // Cached config
    difficultyId: 'racer',

    // ============================================================
    // SECTION: Initialization
    // ============================================================

    init() {
        // Two canvases: a WebGL canvas for the Three.js 3D world, and a
        // transparent 2D canvas on top for the HUD + phase overlays.
        this.canvas3d = document.getElementById('worldCanvas3D');
        this.canvas   = document.getElementById('hudCanvas');
        if (!this.canvas || !this.canvas3d) {
            console.warn('Missing #worldCanvas3D / #hudCanvas');
            return;
        }
        this.ctx = this.canvas.getContext('2d');

        // Load config from state
        const playerCarId = State.get('selectedCarId');
        const opponentCarId = State.get('opponentCarId');
        const customization = State.get('customization') || {};
        const trackId = State.get('trackId') || 'city';
        this.difficultyId = State.get('difficulty') || 'racer';

        const playerData = getCarById(playerCarId) || CarRoster[0];
        const opponentData = getCarById(opponentCarId) ||
            CarRoster.find(c => c.id !== playerData.id) || CarRoster[1];

        // Build track geometry
        this.track = buildTrackGeometry(trackId);

        // Place cars on starting grid (player front-left, AI front-right)
        const slots = this.track.start.gridSlots;
        // gridSlots = [[row0 col0], [row0 col1], [row1 col0], [row1 col1]]
        const pSlot = slots[0];
        const aSlot = slots[1];

        this.player = new Car({
            id: playerData.id,
            baseStats: playerData.stats,
            customization,
            x: pSlot.x, y: pSlot.y, angle: pSlot.angle,
            isPlayer: true
        });
        this.player._shape = playerData.shape;

        this.ai = new Car({
            id: opponentData.id,
            baseStats: opponentData.stats,
            // AI gets a stock loadout in opponent-roster colors
            customization: {
                engine: 'stock', tires: 'standard', bodyKit: 'stock',
                paint: opponentData.paint, accent: '#ff3355', pattern: 'stripes'
            },
            x: aSlot.x, y: aSlot.y, angle: aSlot.angle,
            isPlayer: false
        });
        this.ai._shape = opponentData.shape;

        this.cars = [this.player, this.ai];

        // Initialize waypoint index from start position
        for (const c of this.cars) {
            const closest = this.track.sampleClosest(c.x, c.y);
            c.waypointIndex = closest.i;
            c.lapProgress = closest.i / this.track.waypoints.length;
            c.lap = 0;
            // Per-car stats bag (consumed by results.html)
            c._stats = {
                lapStartTime: 0,
                lapTimes: [],
                topSpeed: 0,
                damageTaken: 0,
                lastHealth: c.maxHealth,
                powerupsUsed: { count: 0, types: {} }
            };
        }

        // Powerups
        PowerupManager.init(this.track, customization);

        // 3D world (Three.js scene/camera/renderer + track/car/prop meshes).
        // Built after the cars, track, and powerups exist; per-frame mesh
        // updates are driven from World3D.render().
        World3D.init(this.canvas3d, this.track, this.cars, this.player);

        // Input
        this._setupInput();
        this._setupInspector();

        // Resize + start loop
        window.addEventListener('resize', () => this._fitCanvas());
        this._fitCanvas();
        this.phase = 'countdown';
        this.countdown = { phase: 0, timer: 0 };
        this.lastFrameTime = performance.now();
        this._rafId = requestAnimationFrame((t) => this._loop(t));

        // Cancel the loop on page leave so we don't leak frames into the
        // next page or accumulate work on bfcache restores.
        window.addEventListener('pagehide', () => {
            this._cancelled = true;
            if (this._rafId) cancelAnimationFrame(this._rafId);
        });
    },

    _fitCanvas() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = window.innerWidth;
        const h = window.innerHeight;
        // HUD overlay canvas (Canvas 2D)
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = h + 'px';
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        // 3D world canvas — Three.js manages its own DPR/size
        if (typeof World3D !== 'undefined' && World3D.handleResize) World3D.handleResize();
    },

    _setupInspector() {
        this.inspectorEl = document.getElementById('fuzzyInspector');
        if (!this.inspectorEl) return;
        this.inspectorVisible = false;
        this._insp = null;   // skeleton + refs, built lazily on first toggle
        // F-key toggle is wired in _setupInput.
        // Refresh at ~120ms (≈8fps) when visible — smooth enough for the
        // live needles/curves, cheap enough not to dent the race loop.
        setInterval(() => {
            if (this.inspectorVisible) this._refreshInspector();
        }, 120);
    },

    _toggleInspector() {
        if (!this.inspectorEl) return;
        this.inspectorVisible = !this.inspectorVisible;
        this.inspectorEl.hidden = !this.inspectorVisible;
        if (this.inspectorVisible) this._refreshInspector();
    },

    // Consistent per-set colour palette shared by charts + legends.
    _fiColors: ['#00eaff', '#ff2bd6', '#ffd400', '#39ff7a', '#ff3355', '#a479ff'],

    /**
     * Build the inspector DOM once and cache element refs + a dedicated
     * "visualisation" FuzzyEngine. We run this throwaway engine on the live
     * inputs each refresh so the whole panel (fuzzification → rules →
     * defuzzification) is a single consistent snapshot — without disturbing
     * the real AI engine's state or stats.
     */
    _buildInspectorSkeleton() {
        const el = this.inspectorEl;
        const viz = new FuzzyEngine();
        const schema = viz.getVariableSchema();
        this._insp = { viz, inputs: {}, outputs: {} };

        el.innerHTML = `
            <div class="fi-header">
                <h3>🧠 AI Fuzzy Brain</h3>
                <span class="fi-hint">[F] close</span>
            </div>
            <div class="fi-meta" id="fiMeta"></div>
            <section class="fi-section">
                <h4>① Fuzzification <span class="fi-tag">inputs → membership μ</span></h4>
                <div class="fi-charts" id="fiInputCharts"></div>
            </section>
            <section class="fi-section">
                <h4>② Rule activations <span class="fi-tag" id="fiRuleTag"></span></h4>
                <div class="fi-rules" id="fiRules"></div>
            </section>
            <section class="fi-section">
                <h4>③ Defuzzification <span class="fi-tag">aggregate → centroid</span></h4>
                <div class="fi-charts" id="fiOutputCharts"></div>
            </section>`;

        this._insp.metaEl  = el.querySelector('#fiMeta');
        this._insp.ruleTag = el.querySelector('#fiRuleTag');
        this._insp.rulesEl = el.querySelector('#fiRules');

        const makeCard = (host, name) => {
            const card = document.createElement('div');
            card.className = 'fi-chart-card';
            card.innerHTML = `
                <div class="fi-chart-top">
                    <span class="fi-chart-name">${name}</span>
                    <span class="fi-chart-val"></span>
                </div>
                <canvas></canvas>
                <div class="fi-leg"></div>`;
            host.appendChild(card);
            return {
                canvas: card.querySelector('canvas'),
                valEl:  card.querySelector('.fi-chart-val'),
                legEl:  card.querySelector('.fi-leg')
            };
        };

        const inHost = el.querySelector('#fiInputCharts');
        for (const v in schema.inputs) {
            this._insp.inputs[v] = Object.assign(
                { setNames: schema.inputs[v].sets, range: schema.inputs[v].range },
                makeCard(inHost, v));
        }
        const outHost = el.querySelector('#fiOutputCharts');
        for (const v in schema.outputs) {
            this._insp.outputs[v] = Object.assign(
                { setNames: schema.outputs[v].sets, range: schema.outputs[v].range },
                makeCard(outHost, v));
        }
    },

    _refreshInspector() {
        const ctl = this.ai && this.ai._controller;
        if (!ctl || !this.inspectorEl) return;
        if (!this._insp) this._buildInspectorSkeleton();
        const insp = this._insp;

        // ---- Live crisp inputs (same formula as AIController._buildInputs) ----
        // Recomputed every refresh so the needles move continuously, not just
        // on the AI's fuzzy ticks.
        const N    = this.track.waypoints.length;
        const la   = ctl.lookAheadCorner || 6;
        const cidx = (N > 0) ? (this.ai.waypointIndex + la) % N : 0;
        const wp   = this.track.waypoints[cidx];
        const liveInputs = {
            distance:     Math.min(1000, Math.hypot(this.player.x - this.ai.x,
                                                    this.player.y - this.ai.y)),
            player_speed: Math.min(100, (this.player.speed /
                                         Math.max(1, this.player.maxSpeed)) * 100),
            corner:       wp ? wp.sharpness : 0,
            health:       (this.ai.health / Math.max(1, this.ai.maxHealth)) * 100,
            gap:          -this._computeGap(),   // negative = AI losing
            powerup:      this.ai.powerupSlot ? 100 : 0
        };

        // Single consistent snapshot from the dedicated viz engine.
        insp.viz.infer(liveInputs);
        const dbg = insp.viz.getFuzzyDebugInfo();
        const C = this._fiColors;

        // ---- Meta line ----
        const diff   = this.difficultyId || 'racer';
        const tickMs = ({ rookie: 1500, racer: 800, champion: 300 })[diff] || 800;
        insp.metaEl.innerHTML =
            `<span class="fi-meta-chip">AI <b>${diff.toUpperCase()}</b></span>` +
            `<span class="fi-meta-chip">re-ticks ~<b>${(tickMs / 1000).toFixed(1)}s</b></span>` +
            `<span class="fi-meta-chip">viz <b>live</b></span>`;

        // ---- Input charts (fuzzification) ----
        for (const v in insp.inputs) {
            const c   = insp.inputs[v];
            const val = liveInputs[v];
            const mem = dbg.memberships[v] || {};
            let domSet = '', domDeg = 0;
            for (const s in mem) if (mem[s] > domDeg) { domDeg = mem[s]; domSet = s; }
            c.valEl.innerHTML =
                `${this._fiFmt(val)}<span class="fi-chart-set">${domDeg > 0.01 ? domSet : '—'}</span>`;
            this._drawInputChart(c.canvas, insp.viz._inputs[v], c.setNames, c.range, val, mem);
            c.legEl.innerHTML = c.setNames.map((s, i) => {
                const d = mem[s] || 0;
                return `<span class="fi-leg-item ${d > 0.01 ? 'on' : ''}">` +
                       `<span class="fi-leg-swatch" style="background:${C[i % C.length]}"></span>` +
                       `${s}<span class="fi-leg-deg">${d.toFixed(2)}</span></span>`;
            }).join('');
        }

        // ---- Rule activations ----
        const fired = (dbg.active_rules || []).slice().sort((a, b) => b.firing - a.firing);
        const total = insp.viz.getRules().length;
        insp.ruleTag.textContent = `${fired.length} firing · ${total - fired.length} dormant`;
        if (fired.length === 0) {
            insp.rulesEl.innerHTML = '<div class="fi-rule off">No rules currently firing.</div>';
        } else {
            insp.rulesEl.innerHTML = fired.slice(0, 8).map(r => {
                const pct = (r.firing * 100).toFixed(0);
                return `<div class="fi-rule on" title="${r.why || ''}">
                    <div class="fi-rule-line">
                        <span class="fi-rule-id">#${r.id}</span>
                        <span class="fi-rule-text">${r.antecedents.join(' AND ')} → <b>${r.consequent}</b></span>
                        <span class="fi-rule-fire">${pct}%</span>
                    </div>
                    <div class="fi-rule-bar"><div class="fi-rule-bar-fill" style="width:${pct}%"></div></div>
                </div>`;
            }).join('');
        }

        // ---- Output charts (defuzzification) ----
        for (const v in insp.outputs) {
            const c     = insp.outputs[v];
            const crisp = dbg.outputs[v];
            const acts  = dbg.activations[v] || {};
            c.valEl.innerHTML = this._fiFmt(crisp);
            this._drawOutputChart(c.canvas, insp.viz._outputs[v], c.setNames, c.range, acts, crisp);
            c.legEl.innerHTML = c.setNames.map((s, i) => {
                const a = acts[s] || 0;
                return `<span class="fi-leg-item ${a > 0.01 ? 'on' : ''}">` +
                       `<span class="fi-leg-swatch" style="background:${C[i % C.length]}"></span>` +
                       `${s}<span class="fi-leg-deg">${a.toFixed(2)}</span></span>`;
            }).join('');
        }
    },

    /** Compact value formatter for chart headers (sign-aware integers). */
    _fiFmt(v) {
        if (v == null || isNaN(v)) return '—';
        return (Math.round(v * 10) / 10).toString();
    },

    /** Prepare a chart canvas: size to its CSS box × dpr, clear, return ctx
     *  plus the inner plot rectangle. */
    _fiPrep(canvas) {
        const ctx = canvas.getContext('2d');
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const rect = canvas.getBoundingClientRect();
        const cw = Math.max(40, rect.width), ch = Math.max(30, rect.height);
        if (canvas.width !== Math.round(cw * dpr)) {
            canvas.width  = Math.round(cw * dpr);
            canvas.height = Math.round(ch * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cw, ch);
        const ML = 20, MR = 6, MT = 7, MB = 12;
        return { ctx, cw, ch, ML, MR, MT, MB, pw: cw - ML - MR, ph: ch - MT - MB };
    },

    /** Y gridlines + μ labels (0 / 0.5 / 1) shared by both chart types. */
    _fiYGrid(ctx, g) {
        ctx.font = '8px monospace';
        ctx.textBaseline = 'middle';
        [0, 0.5, 1].forEach(yv => {
            const py = g.MT + (1 - yv) * g.ph;
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(g.ML, py); ctx.lineTo(g.ML + g.pw, py); ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.textAlign = 'right';
            ctx.fillText(yv.toFixed(1), g.ML - 3, py);
        });
    },

    /**
     * Fuzzification chart: every set's membership curve, a dashed vertical
     * "needle" at the current crisp input, and a glowing dot where the
     * needle crosses each set (its membership degree).
     */
    _drawInputChart(canvas, varObj, setNames, range, crisp, mem) {
        const g = this._fiPrep(canvas);
        const ctx = g.ctx;
        const C = this._fiColors;
        const [min, max] = range;
        this._fiYGrid(ctx, g);

        setNames.forEach((s, i) => {
            const fn = varObj.sets[s];
            if (!fn) return;
            ctx.strokeStyle = C[i % C.length];
            ctx.lineWidth = 1.6;
            ctx.globalAlpha = 0.9;
            ctx.beginPath();
            for (let p = 0; p <= 60; p++) {
                const x = min + (max - min) * (p / 60);
                const mu = Math.max(0, Math.min(1, fn(x)));
                const px = g.ML + (p / 60) * g.pw;
                const py = g.MT + (1 - mu) * g.ph;
                p === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            }
            ctx.stroke();
        });
        ctx.globalAlpha = 1;

        // Needle at the crisp value
        const cc = Math.max(min, Math.min(max, crisp));
        const nx = g.ML + ((cc - min) / (max - min)) * g.pw;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1.4;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(nx, g.MT); ctx.lineTo(nx, g.MT + g.ph); ctx.stroke();
        ctx.setLineDash([]);

        // Membership dots where the needle crosses each set
        setNames.forEach((s, i) => {
            const d = mem[s] || 0;
            if (d <= 0.02) return;
            const py = g.MT + (1 - d) * g.ph;
            ctx.fillStyle = C[i % C.length];
            ctx.shadowColor = C[i % C.length];
            ctx.shadowBlur = 6;
            ctx.beginPath(); ctx.arc(nx, py, 2.6, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
        });
    },

    /**
     * Defuzzification chart: faint individual set curves, the Mamdani
     * aggregated-clipped membership area μ(x) = max_s min(activation_s,
     * set_s(x)) filled in cyan, and a green centroid line at the crisp output.
     */
    _drawOutputChart(canvas, varObj, setNames, range, acts, crisp) {
        const g = this._fiPrep(canvas);
        const ctx = g.ctx;
        const C = this._fiColors;
        const [min, max] = range;
        this._fiYGrid(ctx, g);

        // Faint individual set curves for context
        setNames.forEach((s, i) => {
            const fn = varObj.sets[s];
            if (!fn) return;
            ctx.strokeStyle = C[i % C.length];
            ctx.globalAlpha = 0.22;
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let p = 0; p <= 60; p++) {
                const x = min + (max - min) * (p / 60);
                const mu = Math.max(0, Math.min(1, fn(x)));
                const px = g.ML + (p / 60) * g.pw;
                const py = g.MT + (1 - mu) * g.ph;
                p === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            }
            ctx.stroke();
        });
        ctx.globalAlpha = 1;

        // Aggregated clipped curve
        const SAMP = 80;
        const agg = new Array(SAMP + 1);
        let any = false;
        for (let p = 0; p <= SAMP; p++) {
            const x = min + (max - min) * (p / SAMP);
            let m = 0;
            for (let i = 0; i < setNames.length; i++) {
                const a = acts[setNames[i]] || 0;
                if (a <= 0) continue;
                const fn = varObj.sets[setNames[i]];
                const mu = Math.min(a, Math.max(0, Math.min(1, fn(x))));
                if (mu > m) m = mu;
            }
            agg[p] = m;
            if (m > 0) any = true;
        }
        if (any) {
            // Filled area
            ctx.beginPath();
            ctx.moveTo(g.ML, g.MT + g.ph);
            for (let p = 0; p <= SAMP; p++) {
                ctx.lineTo(g.ML + (p / SAMP) * g.pw, g.MT + (1 - agg[p]) * g.ph);
            }
            ctx.lineTo(g.ML + g.pw, g.MT + g.ph);
            ctx.closePath();
            ctx.fillStyle = 'rgba(0,234,255,0.22)';
            ctx.fill();
            // Outline
            ctx.beginPath();
            for (let p = 0; p <= SAMP; p++) {
                const px = g.ML + (p / SAMP) * g.pw;
                const py = g.MT + (1 - agg[p]) * g.ph;
                p === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            }
            ctx.strokeStyle = '#00eaff';
            ctx.lineWidth = 1.4;
            ctx.stroke();
        }

        // Centroid line (the crisp defuzzified output)
        const cc = Math.max(min, Math.min(max, crisp));
        const nx = g.ML + ((cc - min) / (max - min)) * g.pw;
        ctx.strokeStyle = '#39ff7a';
        ctx.lineWidth = 1.6;
        ctx.shadowColor = '#39ff7a';
        ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.moveTo(nx, g.MT); ctx.lineTo(nx, g.MT + g.ph); ctx.stroke();
        ctx.shadowBlur = 0;
        // Down-pointing marker at the top of the centroid line
        ctx.fillStyle = '#39ff7a';
        ctx.beginPath();
        ctx.moveTo(nx, g.MT + 4);
        ctx.lineTo(nx - 3, g.MT - 1);
        ctx.lineTo(nx + 3, g.MT - 1);
        ctx.closePath();
        ctx.fill();
    },

    _setupInput() {
        const handle = (down) => (e) => {
            const k = e.key;
            this.keys[k] = down;
            if (down) {
                if (k === ' ' || k === 'Spacebar') {
                    if (this.phase === 'racing') {
                        PowerupManager.activatePowerup(this.player, this.cars, this.track);
                    }
                    e.preventDefault();
                }
                if (k === 'p' || k === 'P') {
                    if (this.phase === 'racing') this.phase = 'paused';
                    else if (this.phase === 'paused') {
                        this.phase = 'racing';
                        this.lastFrameTime = performance.now();
                    }
                    e.preventDefault();
                }
                if (k === 'f' || k === 'F') {
                    this._toggleInspector();
                    e.preventDefault();
                }
                if (k === 'Escape' || k === 'Esc') {
                    // Quit the race and return to the garage. Cancel the loop
                    // so no stray frames run during navigation.
                    this._cancelled = true;
                    if (this._rafId) cancelAnimationFrame(this._rafId);
                    window.location.href = 'garage.html';
                    e.preventDefault();
                }
            }
            if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(k)) {
                e.preventDefault();
            }
        };
        window.addEventListener('keydown', handle(true));
        window.addEventListener('keyup',   handle(false));
    },

    // ============================================================
    // SECTION: Main Loop (countdown / racing / paused / finished)
    // ============================================================

    _loop(now) {
        if (this._cancelled) return;
        const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05);
        this.lastFrameTime = now;

        switch (this.phase) {
            case 'countdown': this._tickCountdown(dt); break;
            case 'racing':    this._tickRacing(dt);    break;
            case 'paused':    /* frozen */            break;
            case 'finished':
                if (now - this.finishedAt > 2200) {
                    window.location.href = 'results.html';
                    return;
                }
                break;
        }

        this._render();

        this._rafId = requestAnimationFrame((t) => this._loop(t));
    },

    _tickCountdown(dt) {
        this.countdown.timer += dt;
        if (this.countdown.timer >= 1) {
            this.countdown.timer = 0;
            this.countdown.phase++;
            if (this.countdown.phase >= 4) {
                this.phase = 'racing';
                this.startedAt = performance.now();
                // First lap clock starts now.
                for (const c of this.cars) c._stats.lapStartTime = this.startedAt;
            }
        }
        // Still animate visuals lightly (boxes spin) so the scene isn't dead.
        PowerupManager.update(dt, []);
    },

    _tickRacing(dt) {
        // --- Player input ---
        const k = this.keys;
        this.player.applyThrottle(k.ArrowUp ? 1 : 0);
        this.player.applyBrake(k.ArrowDown ? 1 : 0);
        this.player.applySteering((k.ArrowRight ? 1 : 0) - (k.ArrowLeft ? 1 : 0));

        // --- AI update (controller schedules its own fuzzy ticks) ---
        const gapPlayerAhead = this._computeGap(); // +ve = player ahead
        const raceState = {
            player: this.player,
            ai: this.ai,
            cars: this.cars,
            track: this.track,
            gapAI: -gapPlayerAhead, // for AI, ahead = positive
            dt
        };
        updateAI(this.ai, this.player, this.track, this.difficultyId, raceState);

        // --- Physics ---
        for (const c of this.cars) {
            c.update(dt);
            c.checkWallCollision(this.track);
        }
        this.player.checkCarCollision(this.ai);

        // --- Per-frame stats (top speed, damage taken) ---
        for (const c of this.cars) {
            if (c.speed > c._stats.topSpeed) c._stats.topSpeed = c.speed;
            const lost = c._stats.lastHealth - c.health;
            if (lost > 0) c._stats.damageTaken += lost;
            c._stats.lastHealth = c.health;
        }

        // --- Explosion detection ---
        // When a car's health hits 0 it explodes. Spawn a dramatic particle
        // burst the first frame, then end the race ~1.2s later so the
        // explosion is visible before the win/lose overlay appears.
        for (const c of this.cars) {
            if (c.exploded && !c._explosionTriggered) {
                c._explosionTriggered = true;
                this._spawnExplosion(c);
                // Winner is locked on the first explosion only — if both
                // cars die in the same frame, whoever exploded first still
                // hands the win to the other.
                if (!this._explosionWinner) {
                    this._explosionWinner = (c === this.player) ? this.ai : this.player;
                    this._explosionEndAt = performance.now() + 1200;
                }
            }
        }
        if (this._explosionEndAt && performance.now() >= this._explosionEndAt && this.phase === 'racing') {
            this._explosionEndAt = 0;
            this._finish(this._explosionWinner);
        }

        // --- Lap accounting ---
        // A lap only counts when the car has physically driven through the
        // MIDDLE of the track (lapProgress in [0.35, 0.65]) and then wraps
        // from >0.8 back to <0.2. The narrow mid-window is impossible to be
        // in at spawn — grid slots sit just behind waypoint 0, which puts
        // the initial `lapProgress` at either ~0 or ~1 (Euclidean closest
        // is sometimes the last waypoint). Requiring a true mid-track
        // visit rules out the spurious "0.10s first lap" race-start wrap.
        const N = this.track.waypoints.length;
        for (const c of this.cars) {
            const closest = this.track.sampleClosest(c.x, c.y);
            const newIdx = closest.i;
            const newProgress = newIdx / N;

            if (c._sawMidLap == null) c._sawMidLap = false;
            if (newProgress >= 0.35 && newProgress <= 0.65) c._sawMidLap = true;

            if (c._sawMidLap && c.lapProgress > 0.8 && newProgress < 0.2) {
                const now = performance.now();
                const lapTime = (now - c._stats.lapStartTime) / 1000;
                c._stats.lapTimes.push(lapTime);
                c._stats.lapStartTime = now;
                c.lap += 1;
                c._sawMidLap = false;
                if (c.lap >= TOTAL_LAPS && this.phase === 'racing') {
                    this._finish(c);
                }
            }
            c.waypointIndex = newIdx;
            c.lapProgress = newProgress;
        }

        // --- Powerups + particles ---
        PowerupManager.update(dt, this.cars);
    },

    _spawnExplosion(car) {
        const ps = PowerupManager.particles;
        // Big central blast + a few smaller ones offset to feel chunkier
        Particles.spawnExplosion(ps, car.x, car.y, '#ff8800');
        Particles.spawnExplosion(ps, car.x + 18, car.y - 12, '#ffd400');
        Particles.spawnExplosion(ps, car.x - 14, car.y + 10, '#ff3355');
        // Lots of sparks
        Particles.spawnSparks(ps, car.x, car.y, 30, '#ffd400');
        Particles.spawnSparks(ps, car.x, car.y, 20, '#ff3355');
        // Persistent smoke plume — keep spawning for ~2s so the wreck smokes.
        const start = performance.now();
        const interval = setInterval(() => {
            if (performance.now() - start > 2200) { clearInterval(interval); return; }
            for (let i = 0; i < 4; i++) {
                ps.push({
                    x: car.x + (Math.random() - 0.5) * 30,
                    y: car.y + (Math.random() - 0.5) * 24,
                    vx: (Math.random() - 0.5) * 30,
                    vy: -20 - Math.random() * 40,
                    life: 1.6, maxLife: 1.6,
                    color: '#1a1a1a',
                    size: 8 + Math.random() * 6,
                    type: 'smoke'
                });
            }
        }, 90);
    },

    _computeGap() {
        const N = this.track.waypoints.length;
        const playerTotal = this.player.lap + this.player.lapProgress;
        const aiTotal     = this.ai.lap     + this.ai.lapProgress;
        return (playerTotal - aiTotal) * 100;
    },

    _positions() {
        const playerTotal = this.player.lap + this.player.lapProgress;
        const aiTotal     = this.ai.lap     + this.ai.lapProgress;
        return playerTotal >= aiTotal ? ['player', 'ai'] : ['ai', 'player'];
    },

    _finish(winner) {
        if (this.phase === 'finished') return;
        this.phase = 'finished';
        this.finishedAt = performance.now();
        this.winner = winner;

        const time = (this.finishedAt - this.startedAt) / 1000;
        const pos = this._positions();
        const playerPlace = pos.indexOf('player') + 1;

        const aiCtl = this.ai._controller;
        const fuzzySummary = aiCtl ? aiCtl.getRaceSummary() : null;

        State.set('lastResult', {
            track:        this.track.id,
            difficulty:   this.difficultyId,
            winner:       winner.isPlayer ? 'player' : 'ai',
            playerPlace,
            time,
            playerCarId:  this.player.id,
            opponentCarId:this.ai.id,
            customization:State.get('customization'),
            cars: {
                player: {
                    id:           this.player.id,
                    lap:          this.player.lap,
                    health:       Math.round(this.player.health),
                    maxHealth:    this.player.maxHealth,
                    lapTimes:     this.player._stats.lapTimes.slice(),
                    topSpeed:     Math.round(this.player._stats.topSpeed),
                    damageTaken:  Math.round(this.player._stats.damageTaken),
                    powerupsUsed: this.player._stats.powerupsUsed
                },
                ai: {
                    id:           this.ai.id,
                    lap:          this.ai.lap,
                    health:       Math.round(this.ai.health),
                    maxHealth:    this.ai.maxHealth,
                    lapTimes:     this.ai._stats.lapTimes.slice(),
                    topSpeed:     Math.round(this.ai._stats.topSpeed),
                    damageTaken:  Math.round(this.ai._stats.damageTaken),
                    powerupsUsed: this.ai._stats.powerupsUsed
                }
            },
            fuzzy: fuzzySummary
        });
    },

    // ============================================================
    // SECTION: Render (world + HUD + phase overlays)
    // ============================================================

    _render() {
        // ---- 3D world (Three.js draws the track, cars, props, powerups,
        //      projectiles, particles, and effects into worldCanvas3D) ----
        if (typeof World3D !== 'undefined' && World3D.scene) World3D.render();

        // ---- HUD overlay (Canvas 2D on the transparent top canvas) ----
        const ctx = this.ctx;
        const W = window.innerWidth;
        const H = window.innerHeight;
        ctx.clearRect(0, 0, W, H);

        this._drawHUD(ctx, W, H);

        // Phase overlays
        if (this.phase === 'countdown') this._drawCountdown(ctx, W, H);
        if (this.phase === 'paused')    this._drawPause(ctx, W, H);
        if (this.phase === 'finished')  this._drawFinish(ctx, W, H);
    },

    _drawHUD(ctx, W, H) {
        const player = this.player;
        const positions = this._positions();
        const myPlace = positions.indexOf('player') + 1;

        // --- Top-left: lap counter ---
        ctx.save();
        ctx.fillStyle = 'rgba(10,12,22,0.7)';
        ctx.strokeStyle = 'rgba(0,234,255,0.4)';
        ctx.lineWidth = 1;
        roundedRect(ctx, 20, 20, 170, 60, 8);
        ctx.fill(); ctx.stroke();

        ctx.fillStyle = '#8a91b4';
        ctx.font = '700 11px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('LAP', 36, 30);
        ctx.fillStyle = '#fff';
        ctx.font = '900 30px monospace';
        ctx.fillText(`${Math.min(player.lap + 1, TOTAL_LAPS)}/${TOTAL_LAPS}`, 36, 44);
        ctx.restore();

        // --- Top-center: position ---
        ctx.save();
        const placeColor = myPlace === 1 ? '#ffd400' : '#00eaff';
        ctx.fillStyle = 'rgba(10,12,22,0.7)';
        ctx.strokeStyle = placeColor;
        ctx.lineWidth = 1;
        roundedRect(ctx, W/2 - 70, 20, 140, 60, 8);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#8a91b4';
        ctx.font = '700 11px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('POSITION', W/2, 30);
        ctx.fillStyle = placeColor;
        ctx.shadowColor = placeColor;
        ctx.shadowBlur = 14;
        ctx.font = '900 30px monospace';
        ctx.fillText(myPlace === 1 ? '1ST' : '2ND', W/2, 44);
        ctx.shadowBlur = 0;
        ctx.restore();

        // --- Top-right: minimap ---
        Renderer.drawMinimap(ctx, this.track, this.cars,
            { x: W - 240, y: 20, w: 220, h: 160 });

        // --- Bottom-left: speedometer + health ---
        this._drawSpeedometer(ctx, 90, H - 100, 64, player.speed, player.maxSpeed);
        this._drawHealthBar(ctx, 175, H - 50, 230, 18, player.health, player.maxHealth);

        // --- Bottom-center: held powerup ---
        this._drawPowerupSlot(ctx, W/2 - 50, H - 130, 100, 100, player.powerupSlot);

        // --- Bottom-right: opponent health (mini) + tips ---
        this._drawOpponentBadge(ctx, W - 240, H - 60, 220, 40, this.ai);
    },

    _drawSpeedometer(ctx, cx, cy, r, speed, maxSpeed) {
        const pct = Math.max(0, Math.min(1, speed / maxSpeed));
        const startA = Math.PI * 0.75;
        const endA   = Math.PI * 0.25;
        const sweep  = (Math.PI * 2 - (startA - endA));
        const curA   = startA + sweep * pct;

        ctx.save();
        ctx.translate(cx, cy);
        // Background arc
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(0, 0, r, startA, endA + Math.PI * 2);
        ctx.stroke();
        // Fill arc — color shifts from cyan to red as speed nears max
        const color = pct < 0.6 ? '#00eaff' : pct < 0.85 ? '#ffd400' : '#ff3355';
        ctx.strokeStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(0, 0, r, startA, curA);
        ctx.stroke();
        ctx.shadowBlur = 0;
        // Tick marks
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 2;
        for (let i = 0; i <= 8; i++) {
            const a = startA + (sweep * i / 8);
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * (r + 8), Math.sin(a) * (r + 8));
            ctx.lineTo(Math.cos(a) * (r + 14), Math.sin(a) * (r + 14));
            ctx.stroke();
        }
        // Speed text
        ctx.fillStyle = '#fff';
        ctx.font = '900 26px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(Math.round(speed), 0, -2);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '700 9px monospace';
        ctx.fillText('PX/S', 0, 20);
        ctx.restore();
    },

    _drawHealthBar(ctx, x, y, w, h, health, max) {
        const pct = Math.max(0, health / max);
        ctx.save();
        // Frame
        ctx.fillStyle = 'rgba(10,12,22,0.85)';
        ctx.fillRect(x - 4, y - 18, w + 8, h + 26);
        // Label
        ctx.fillStyle = '#8a91b4';
        ctx.font = '700 10px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('HEALTH', x, y - 14);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#fff';
        ctx.fillText(`${Math.round(health)} / ${max}`, x + w, y - 14);
        // Bar
        ctx.fillStyle = '#1c2138';
        ctx.fillRect(x, y, w, h);
        const color = pct > 0.5 ? '#39ff7a' : pct > 0.25 ? '#ffd400' : '#ff3355';
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.fillRect(x, y, w * pct, h);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.restore();
    },

    _drawPowerupSlot(ctx, x, y, w, h, slotId) {
        const type = slotId ? getPowerupType(slotId) : null;
        ctx.save();
        // Frame
        ctx.fillStyle = 'rgba(10,12,22,0.78)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = type ? type.color : 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 2;
        if (type) {
            ctx.shadowColor = type.color;
            ctx.shadowBlur = 16 + 4 * Math.sin(performance.now() / 200);
        }
        ctx.strokeRect(x, y, w, h);
        ctx.shadowBlur = 0;

        if (type) {
            // Pulsing icon background
            ctx.fillStyle = type.color + '22';
            ctx.beginPath();
            ctx.arc(x + w/2, y + h/2, 30, 0, Math.PI * 2);
            ctx.fill();

            // Big icon (font emoji centered)
            ctx.fillStyle = '#fff';
            ctx.font = '900 38px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(type.icon, x + w/2, y + h/2 + 2);

            // Name + hint
            ctx.fillStyle = type.color;
            ctx.font = '900 10px monospace';
            ctx.fillText(type.name.toUpperCase(), x + w/2, y + h + 12);
            ctx.fillStyle = 'rgba(255,255,255,0.75)';
            ctx.font = '700 9px monospace';
            ctx.fillText('[ SPACE ]', x + w/2, y + h + 26);
        } else {
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.font = '900 32px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('?', x + w/2, y + h/2 + 2);
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = '900 10px monospace';
            ctx.fillText('NO POWERUP', x + w/2, y + h + 12);
        }
        ctx.restore();
    },

    _drawOpponentBadge(ctx, x, y, w, h, ai) {
        ctx.save();
        ctx.fillStyle = 'rgba(10,12,22,0.78)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = 'rgba(255,51,85,0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);

        // Opponent name
        const data = getCarById(ai.id);
        ctx.fillStyle = '#ff3355';
        ctx.font = '800 11px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('OPPONENT', x + 10, y + 6);
        ctx.fillStyle = '#fff';
        ctx.font = '900 12px monospace';
        ctx.fillText((data?.name || ai.id).toUpperCase(), x + 10, y + 20);

        // Mini health bar
        const bx = x + 110, by = y + 14, bw = w - 120, bh = 6;
        const pct = Math.max(0, ai.health / ai.maxHealth);
        ctx.fillStyle = '#1c2138';
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = pct > 0.5 ? '#39ff7a' : pct > 0.25 ? '#ffd400' : '#ff3355';
        ctx.fillRect(bx, by, bw * pct, bh);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.strokeRect(bx, by, bw, bh);
        ctx.restore();
    },

    _drawCountdown(ctx, W, H) {
        const phase = this.countdown.phase;
        const labels = ['3', '2', '1', 'GO!'];
        const colors = ['#ff3355', '#ffd400', '#00eaff', '#39ff7a'];
        if (phase >= labels.length) return;
        const t = Math.min(1, this.countdown.timer);
        const scale = 1.4 - t * 0.6;
        const alpha = t < 0.7 ? 1 : Math.max(0, 1 - (t - 0.7) / 0.3);

        ctx.save();
        ctx.fillStyle = `rgba(0,0,0,${0.55 * alpha})`;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = colors[phase];
        ctx.shadowColor = colors[phase];
        ctx.shadowBlur = 50;
        ctx.font = `900 ${Math.floor(220 * scale)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labels[phase], W/2, H/2);
        ctx.restore();
    },

    _drawPause(ctx, W, H) {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#fff';
        ctx.shadowColor = '#00eaff';
        ctx.shadowBlur = 24;
        ctx.font = '900 96px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('PAUSED', W/2, H/2 - 20);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#8a91b4';
        ctx.font = '700 18px monospace';
        ctx.fillText('press [P] to resume', W/2, H/2 + 50);
        ctx.restore();
    },

    _drawFinish(ctx, W, H) {
        const winner = this.winner;
        const playerWon = winner === this.player;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, W, H);
        const color = playerWon ? '#39ff7a' : '#ff3355';
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 40;
        ctx.font = '900 120px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Explosion-based win/loss gets a different headline.
        const playerExploded = this.player.exploded;
        const aiExploded = this.ai.exploded;
        let headline;
        if (playerExploded)      headline = 'WRECKED';
        else if (aiExploded)     headline = 'KO!';
        else                     headline = playerWon ? 'YOU WIN!' : 'DEFEATED';
        ctx.fillText(headline, W/2, H/2 - 30);

        // Subtitle on explosion to make the cause clear
        if (playerExploded || aiExploded) {
            ctx.shadowBlur = 0;
            ctx.fillStyle = color;
            ctx.font = '900 30px sans-serif';
            const sub = playerExploded ? 'Your car was destroyed' : 'Opponent destroyed';
            ctx.fillText(sub, W/2, H/2 + 36);
        }
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#fff';
        ctx.font = '700 18px monospace';
        ctx.fillText('redirecting to results…', W/2, H/2 + 90);
        ctx.restore();
    }
};

// Auto-start when the page is ready.
if (document.readyState === 'complete') Race.init();
else window.addEventListener('load', () => Race.init());

if (typeof window !== 'undefined') window.Race = Race;
