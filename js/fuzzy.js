/* ============================================================================
 *  PROJECT     : Fuzzy Racers: AI Racing Game
 *  SUBJECT     : ISP568 Fuzzy Logic Systems
 *  FILE        : fuzzy.js
 *  DESCRIPTION : Mamdani-style fuzzy inference engine that drives every
 *                opponent in Fuzzy Racers.
 *
 *  ----------------------------------------------------------------------------
 *  HOW FUZZY LOGIC CONTROLS THE AI
 *  ----------------------------------------------------------------------------
 *  Conventional "if/else" racing AI struggles with continuous, conflicting
 *  signals: being a little behind on a fast car nearing a hairpin while
 *  carrying a powerup is not a single discrete case, it's a smear of
 *  partially-true facts. Fuzzy logic lets each fact have a degree of truth
 *  in [0,1], so the AI can lean on multiple soft rules at once and emit a
 *  smooth, defensible action.
 *
 *  Each AI tick the engine runs three stages:
 *
 *    1. FUZZIFICATION: Convert crisp race telemetry into degrees of
 *                          membership across the named fuzzy sets of each
 *                          input variable (e.g. "distance=80px" becomes
 *                          very_close=1.0, close=0.0, medium=0.0, …).
 *
 *    2. RULE EVALUATION: For every rule, compute its firing strength as
 *                          min() of its antecedent membership degrees
 *                          (Zadeh AND). Aggregate output activations
 *                          per output-variable+set via max().
 *
 *    3. DEFUZZIFICATION: For each output variable, build the Mamdani-
 *                          clipped aggregate membership function over 101
 *                          sample points and compute its centroid 
 *                          producing the crisp throttle, brake, steering,
 *                          aggression, and use_powerup commands.
 *
 *  ----------------------------------------------------------------------------
 *  INPUT VARIABLES (6)
 *  ----------------------------------------------------------------------------
 *    distance       (0..1000 px)   very_close, close, medium, far, very_far
 *    player_speed   (0..100)       slow, moderate, fast, very_fast
 *    corner         (0..100)       slight, moderate, sharp, hairpin
 *    health         (0..100)       critical, low, medium, high, full
 *    gap            (-100..100)    losing_badly, losing, even, winning,
 *                                  winning_by_a_lot
 *    powerup        (0..100)       no_powerup, powerup_ready
 *
 *  ----------------------------------------------------------------------------
 *  OUTPUT VARIABLES (5)
 *  ----------------------------------------------------------------------------
 *    throttle       (0..100)       off, light, medium, full
 *    brake          (0..100)       none, light, medium, hard
 *    steering       (-100..100)    hard_left, left, straight, right,
 *                                  hard_right
 *    aggression     (0..100)       low, medium, high, maximum
 *    use_powerup    (0..100)       no, save, ready, urgent
 *                                  (>70 → controller actually fires)
 *
 *  ----------------------------------------------------------------------------
 *  RULE BASE (33 rules: see _buildRules() for the live source of truth)
 *  ----------------------------------------------------------------------------
 *
 *  SPEED CONTROL  (corner-driven throttle and brake)
 *    R1   IF corner IS hairpin               THEN brake IS hard
 *           Hairpins require hard braking before turn-in.
 *    R2   IF corner IS hairpin               THEN throttle IS light
 *           Roll through hairpins on light throttle.
 *    R3   IF corner IS sharp                 THEN brake IS medium
 *           Sharp bends need solid brake load.
 *    R4   IF corner IS sharp                 THEN throttle IS light
 *           Trim throttle on sharp corners.
 *    R5   IF corner IS moderate              THEN brake IS light
 *           Moderate corners trail-brake lightly.
 *    R6   IF corner IS moderate              THEN throttle IS medium
 *           Carry medium throttle through moderate corners.
 *    R7   IF corner IS slight                THEN brake IS none
 *           Don't brake on near-straights.
 *    R8   IF corner IS slight                THEN throttle IS full
 *           Full throttle on near-straights.
 *
 *  AGGRESSION  (gap-driven race posture)
 *    R9   IF gap IS losing_badly             THEN aggression IS maximum
 *           Far behind: throw caution to the wind.
 *    R10  IF gap IS losing                   THEN aggression IS high
 *           Behind: push hard to close the gap.
 *    R11  IF gap IS even                     THEN aggression IS medium
 *           Even race: race clean but committed.
 *    R12  IF gap IS winning                  THEN aggression IS low
 *           Ahead: protect the lead.
 *    R13  IF gap IS winning_by_a_lot         THEN aggression IS low
 *           Comfortable lead: minimize risk.
 *
 *  POWERUP USAGE  (gap × powerup × health)
 *    R14  IF powerup IS no_powerup           THEN use_powerup IS no
 *           Can't use what you don't have.
 *    R15  IF gap IS losing_badly AND powerup IS powerup_ready
 *                                            THEN use_powerup IS urgent
 *           Far behind with a powerup ready: spend it now.
 *    R16  IF gap IS losing AND powerup IS powerup_ready
 *                                            THEN use_powerup IS ready
 *           Behind with a powerup: deploy it.
 *    R17  IF gap IS even AND powerup IS powerup_ready
 *                                            THEN use_powerup IS save
 *           Even race: hold the powerup for a high-impact moment.
 *    R18  IF gap IS winning AND powerup IS powerup_ready
 *                                            THEN use_powerup IS save
 *           Ahead: bank the powerup defensively.
 *    R19  IF health IS critical AND powerup IS powerup_ready
 *                                            THEN use_powerup IS urgent
 *           Critical health: fire shield/boost immediately.
 *    R20  IF corner IS slight AND gap IS losing AND powerup IS powerup_ready
 *                                            THEN use_powerup IS ready
 *           Long straight + behind + powerup: ideal boost moment.
 *
 *  DEFENSIVE BEHAVIOR  (low/critical health)
 *    R21  IF health IS critical AND distance IS very_close
 *                                            THEN aggression IS low
 *           One more hit means race over back off when contact is likely.
 *    R22  IF health IS critical              THEN brake IS medium
 *           Drive more conservatively at critical health.
 *    R23  IF health IS low AND distance IS very_close
 *                                            THEN aggression IS medium
 *           Banged up and near contact: race smart, not reckless.
 *
 *  OVERTAKING  (distance × player_speed × gap)
 *    R24  IF distance IS very_close AND gap IS losing
 *                                            THEN aggression IS maximum
 *           Tail of the player and behind: send the overtake.
 *    R25  IF distance IS close AND player_speed IS slow
 *                                            THEN throttle IS full
 *           Player is slowing: close on full throttle.
 *    R26  IF distance IS close AND player_speed IS slow
 *                                            THEN aggression IS high
 *           Player is slowing: press the pass.
 *    R27  IF distance IS very_close AND player_speed IS very_fast
 *                                            THEN aggression IS high
 *           Glued to a fast player: stay on them.
 *    R28  IF distance IS far AND gap IS losing
 *                                            THEN throttle IS full
 *           Behind and far: need outright pace.
 *    R29  IF distance IS very_far AND gap IS losing_badly
 *                                            THEN throttle IS full
 *           Way back: every meter counts.
 *
 *  STEERING MAGNITUDE  (sign is applied by the AI controller)
 *    R30  IF corner IS hairpin               THEN steering IS hard_right
 *           Hairpin → maximum steering input.
 *    R31  IF corner IS sharp                 THEN steering IS right
 *           Sharp corner → strong steering input.
 *    R32  IF corner IS moderate              THEN steering IS right
 *           Moderate corner → moderate steering input.
 *    R33  IF corner IS slight                THEN steering IS straight
 *           Near-straight → minimal steering.
 *
 *  ----------------------------------------------------------------------------
 *  INFERENCE OPERATORS
 *  ----------------------------------------------------------------------------
 *    AND (t-norm)  : min(a, b)        (Zadeh / Mamdani)
 *    OR  (t-conorm): max(a, b)
 *    NOT           : 1 - a
 *    Aggregation   : max() across rules targeting the same output set
 *    Defuzzify     : centroid over 101 sample points of clipped output
 *
 *  ----------------------------------------------------------------------------
 *  PUBLIC API
 *  ----------------------------------------------------------------------------
 *    new FuzzyEngine()
 *    engine.infer(crispInputs) → crisp outputs map
 *    engine.fuzzify(crispInputs) → membership map
 *    engine.evaluateRules(memberships) → { activations, activeRules }
 *    engine.defuzzify(varName, activations) → number
 *    engine.getFuzzyDebugInfo() → snapshot for the in-race inspector
 *    engine.getRules() → human-readable rule base
 *    engine.getVariableSchema() → input/output variable metadata
 *    FuzzyEngine.triangle(x, a, b, c)
 *    FuzzyEngine.trapezoid(x, a, b, c, d)
 *    FuzzyEngine.and / or / not
 * ============================================================================
 */

class FuzzyEngine {
    constructor() {
        this._inputs  = this._buildInputs();
        this._outputs = this._buildOutputs();
        this._rules   = this._buildRules();
        this._lastDebug = null;
    }

    // ============================================================
    // SECTION: Membership Functions
    // Each returns a degree of truth in [0, 1]. Provided as static
    // methods so they can be used standalone.
    // ============================================================

    /**
     * Triangular membership.
     *
     *           1 ┤           ╱╲
     *             │          ╱  ╲
     *           0 ┤_________╱    ╲_________
     *                       a  b  c
     *
     *   x ≤ a or x ≥ c   →   0   (outside support)
     *   a < x < b        →   linear ramp up from 0 to 1
     *   x = b            →   1   (peak)
     *   b < x < c        →   linear ramp down from 1 to 0
     *
     * a, b, c must satisfy a ≤ b ≤ c. Degenerate cases (a == b or b == c)
     * are handled: they collapse one side of the triangle to a vertical edge.
     */
    static triangle(x, a, b, c) {
        // Peak first so degenerate shoulders (a==b or b==c) report 1 at the
        // boundary x==b instead of dropping into the outside-support branch.
        if (x === b) return 1;
        if (x <= a || x >= c) return 0;
        if (x < b) return a === b ? 1 : (x - a) / (b - a);
        return       b === c ? 1 : (c - x) / (c - b);
    }

    /**
     * Trapezoidal membership.
     *
     *           1 ┤        _______
     *             │       ╱       ╲
     *           0 ┤______╱         ╲______
     *                    a  b   c  d
     *
     *   x ≤ a or x ≥ d   →   0   (outside support)
     *   a < x < b        →   ramp up
     *   b ≤ x ≤ c        →   1   (plateau)
     *   c < x < d        →   ramp down
     *
     * Useful for shoulder sets (saturating at one end of the universe) by
     * setting a == b (left shoulder) or c == d (right shoulder).
     */
    static trapezoid(x, a, b, c, d) {
        // Plateau check first so left shoulders (a==b) and right shoulders
        // (c==d) report 1 at the universe boundary instead of falling into
        // the outside-support branch.
        if (x >= b && x <= c) return 1;
        if (x <= a || x >= d) return 0;
        if (x < b) return a === b ? 1 : (x - a) / (b - a);
        return       c === d ? 1 : (d - x) / (d - c);
    }

    // T-norm / t-conorm / complement.
    // (Standard Mamdani uses min/max/1-x; alternatives like product/probor exist.)
    static and(a, b) { return Math.min(a, b); }
    static or(a, b)  { return Math.max(a, b); }
    static not(a)    { return 1 - a; }

    // ============================================================
    // SECTION: Variable Definitions (Inputs & Outputs)
    // ============================================================

    _buildInputs() {
        const tri  = (a, b, c)     => (x) => FuzzyEngine.triangle(x, a, b, c);
        const trap = (a, b, c, d)  => (x) => FuzzyEngine.trapezoid(x, a, b, c, d);

        return {
            // --- Distance from AI to player (px along/around the track) ---
            distance: {
                range: [0, 1000],
                sets: {
                    very_close: trap(0,    0,    80,   150),
                    close:      trap(100,  180,  260,  380),
                    medium:     tri (300,  500,  700),
                    far:        tri (550,  750,  900),
                    very_far:   trap(800,  900,  1000, 1000)
                }
            },

            // --- Player's car speed (0..100, percent of cap) ---
            player_speed: {
                range: [0, 100],
                sets: {
                    slow:      trap(0,  0,  20, 35),
                    moderate:  tri (25, 45, 65),
                    fast:      tri (55, 70, 85),
                    very_fast: trap(75, 90, 100, 100)
                }
            },

            // --- Corner sharpness ahead (0 = straight, 100 = hairpin) ---
            corner: {
                range: [0, 100],
                sets: {
                    slight:   trap(0,  0,  15, 30),
                    moderate: tri (25, 45, 60),
                    sharp:    tri (55, 70, 85),
                    hairpin:  trap(80, 90, 100, 100)
                }
            },

            // --- AI's own armor/health (0..100) ---
            health: {
                range: [0, 100],
                sets: {
                    critical: trap(0,  0,  10, 25),
                    low:      tri (20, 35, 50),
                    medium:   tri (40, 55, 70),
                    high:     tri (60, 75, 90),
                    full:     trap(85, 95, 100, 100)
                }
            },

            // --- Position gap to player. Negative = behind, positive = ahead. ---
            gap: {
                range: [-100, 100],
                sets: {
                    losing_badly:     trap(-100, -100, -70, -45),
                    losing:           tri (-60,  -30,  -5),
                    even:             tri (-15,  0,    15),
                    winning:          tri (5,    30,   60),
                    winning_by_a_lot: trap(45,   70,   100, 100)
                }
            },

            // --- Whether the AI is holding a powerup (0 = empty, 100 = ready) ---
            powerup: {
                range: [0, 100],
                sets: {
                    no_powerup:    trap(0,  0,  20, 45),
                    powerup_ready: trap(55, 80, 100, 100)
                }
            }
        };
    }

    _buildOutputs() {
        const tri  = (a, b, c)    => (x) => FuzzyEngine.triangle(x, a, b, c);
        const trap = (a, b, c, d) => (x) => FuzzyEngine.trapezoid(x, a, b, c, d);

        return {
            // Throttle pedal (0..100)
            throttle: {
                range: [0, 100],
                sets: {
                    off:    trap(0,  0,  5,  20),
                    light:  tri (15, 35, 55),
                    medium: tri (45, 65, 85),
                    full:   trap(80, 95, 100, 100)
                }
            },

            // Brake pedal (0..100)
            brake: {
                range: [0, 100],
                sets: {
                    none:   trap(0,  0,  5,  15),
                    light:  tri (10, 30, 50),
                    medium: tri (45, 60, 75),
                    hard:   trap(70, 85, 100, 100)
                }
            },

            // Steering magnitude bias (-100..100). Direction sign is applied by
            // the AI controller in ai.js based on track tangent vs car heading;
            // the fuzzy engine just decides how hard to turn.
            steering: {
                range: [-100, 100],
                sets: {
                    hard_left:  trap(-100, -100, -75, -50),
                    left:       tri (-60,  -35,  -10),
                    straight:   tri (-15,  0,    15),
                    right:      tri (10,   35,   60),
                    hard_right: trap(50,   75,   100, 100)
                }
            },

            // Behavior dial used by ai.js to bias maneuver choices.
            aggression: {
                range: [0, 100],
                sets: {
                    low:     trap(0,  0,  20, 40),
                    medium:  tri (30, 50, 70),
                    high:    tri (60, 75, 90),
                    maximum: trap(85, 95, 100, 100)
                }
            },

            // Powerup usage urgency. Controller fires powerup when crisp > 70.
            use_powerup: {
                range: [0, 100],
                sets: {
                    no:     trap(0,  0,  20, 35),
                    save:   tri (25, 45, 60),
                    ready:  tri (55, 70, 80),
                    urgent: trap(75, 90, 100, 100)
                }
            }
        };
    }

    _buildRules() {
        // Helper for compact rule construction.
        // antecedents: array of [varName, setName] tuples joined by AND.
        // consequent : [outputVar, outputSet].
        // why        : human-readable explanation surfaced by the debug inspector.
        const R = (antecedents, consequent, why) =>
            ({ id: this._ruleId++, antecedents, consequent, why });

        this._ruleId = 1;

        return [
            // ===== SPEED CONTROL: corner-driven throttle & brake =====
            R([['corner', 'hairpin']],                       ['brake', 'hard'],
              'Hairpins require hard braking before turn-in.'),
            R([['corner', 'hairpin']],                       ['throttle', 'light'],
              'Roll through hairpins on light throttle.'),
            R([['corner', 'sharp']],                         ['brake', 'medium'],
              'Sharp bends need solid brake load.'),
            R([['corner', 'sharp']],                         ['throttle', 'light'],
              'Trim throttle on sharp corners.'),
            R([['corner', 'moderate']],                      ['brake', 'light'],
              'Moderate corners trail-brake lightly.'),
            R([['corner', 'moderate']],                      ['throttle', 'medium'],
              'Carry medium throttle through moderate corners.'),
            R([['corner', 'slight']],                        ['brake', 'none'],
              'Don\'t brake on near-straights.'),
            R([['corner', 'slight']],                        ['throttle', 'full'],
              'Full throttle on near-straights.'),

            // ===== AGGRESSION: gap-driven =====
            R([['gap', 'losing_badly']],                     ['aggression', 'maximum'],
              'Far behind: throw caution to the wind.'),
            R([['gap', 'losing']],                           ['aggression', 'high'],
              'Behind: push hard to close the gap.'),
            R([['gap', 'even']],                             ['aggression', 'medium'],
              'Even race: race clean but committed.'),
            R([['gap', 'winning']],                          ['aggression', 'low'],
              'Ahead: protect the lead.'),
            R([['gap', 'winning_by_a_lot']],                 ['aggression', 'low'],
              'Comfortable lead: minimize risk.'),

            // ===== POWERUP USAGE =====
            R([['powerup', 'no_powerup']],                   ['use_powerup', 'no'],
              'Can\'t use what you don\'t have.'),
            R([['gap', 'losing_badly'], ['powerup', 'powerup_ready']],
                                                              ['use_powerup', 'urgent'],
              'Far behind with a powerup ready: spend it now.'),
            R([['gap', 'losing'], ['powerup', 'powerup_ready']],
                                                              ['use_powerup', 'ready'],
              'Behind with a powerup: deploy it.'),
            R([['gap', 'even'], ['powerup', 'powerup_ready']],
                                                              ['use_powerup', 'save'],
              'Even race: hold the powerup for a high-impact moment.'),
            R([['gap', 'winning'], ['powerup', 'powerup_ready']],
                                                              ['use_powerup', 'save'],
              'Ahead: bank the powerup defensively.'),
            R([['health', 'critical'], ['powerup', 'powerup_ready']],
                                                              ['use_powerup', 'urgent'],
              'Critical health: fire shield/boost immediately.'),
            R([['corner', 'slight'], ['gap', 'losing'], ['powerup', 'powerup_ready']],
                                                              ['use_powerup', 'ready'],
              'Long straight + behind + powerup: ideal boost moment.'),

            // ===== DEFENSIVE BEHAVIOR =====
            R([['health', 'critical'], ['distance', 'very_close']],
                                                              ['aggression', 'low'],
              'One more hit means race over back off when contact is likely.'),
            R([['health', 'critical']],                      ['brake', 'medium'],
              'Drive more conservatively at critical health.'),
            R([['health', 'low'], ['distance', 'very_close']],
                                                              ['aggression', 'medium'],
              'Banged up and near contact: race smart, not reckless.'),

            // ===== OVERTAKING =====
            R([['distance', 'very_close'], ['gap', 'losing']],
                                                              ['aggression', 'maximum'],
              'Tail of the player and behind: send the overtake.'),
            R([['distance', 'close'], ['player_speed', 'slow']],
                                                              ['throttle', 'full'],
              'Player is slowing: close on full throttle.'),
            R([['distance', 'close'], ['player_speed', 'slow']],
                                                              ['aggression', 'high'],
              'Player is slowing: press the pass.'),
            R([['distance', 'very_close'], ['player_speed', 'very_fast']],
                                                              ['aggression', 'high'],
              'Glued to a fast player: stay on them.'),
            R([['distance', 'far'], ['gap', 'losing']],
                                                              ['throttle', 'full'],
              'Behind and far: need outright pace.'),
            R([['distance', 'very_far'], ['gap', 'losing_badly']],
                                                              ['throttle', 'full'],
              'Way back: every meter counts.'),

            // ===== STEERING (magnitude only; sign applied by ai.js) =====
            R([['corner', 'hairpin']],                       ['steering', 'hard_right'],
              'Hairpin → maximum steering input.'),
            R([['corner', 'sharp']],                         ['steering', 'right'],
              'Sharp corner → strong steering input.'),
            R([['corner', 'moderate']],                      ['steering', 'right'],
              'Moderate corner → moderate steering input.'),
            R([['corner', 'slight']],                        ['steering', 'straight'],
              'Near-straight → minimal steering.')
        ];
    }

    // ============================================================
    // SECTION: Inference Pipeline
    // ============================================================

    /**
     * Fuzzify a set of crisp inputs.
     * Returns a nested object: { varName → { setName → degree in [0,1] } }
     * Any input variable not provided is treated as the midpoint of its range.
     */
    fuzzify(crispInputs) {
        const memberships = {};
        for (const varName in this._inputs) {
            const v = this._inputs[varName];
            const [min, max] = v.range;
            const x = (crispInputs && varName in crispInputs)
                ? crispInputs[varName]
                : (min + max) / 2;
            memberships[varName] = {};
            for (const setName in v.sets) {
                memberships[varName][setName] = v.sets[setName](x);
            }
        }
        return memberships;
    }

    /**
     * Evaluate every rule against the fuzzified inputs.
     * For each rule the firing strength is the min() of its antecedent degrees
     * (Mamdani / Zadeh AND). For each output variable+set we keep the max()
     * firing across all rules that target it (output aggregation).
     */
    evaluateRules(memberships) {
        const activations = {};
        const activeRules = [];

        for (const outVar in this._outputs) {
            activations[outVar] = {};
            for (const setName in this._outputs[outVar].sets) {
                activations[outVar][setName] = 0;
            }
        }

        for (const rule of this._rules) {
            let firing = 1;
            for (const [v, s] of rule.antecedents) {
                const mu = memberships[v] ? memberships[v][s] : 0;
                firing = Math.min(firing, mu || 0);
                if (firing === 0) break;
            }
            if (firing > 0) {
                const [oVar, oSet] = rule.consequent;
                if (activations[oVar] && (oSet in activations[oVar])) {
                    activations[oVar][oSet] = Math.max(activations[oVar][oSet], firing);
                }
                activeRules.push({
                    id: rule.id,
                    firing,
                    antecedents: rule.antecedents.map(([v, s]) => `${v} IS ${s}`),
                    consequent: `${rule.consequent[0]} IS ${rule.consequent[1]}`,
                    why: rule.why
                });
            }
        }

        return { activations, activeRules };
    }

    /**
     * Centroid (centre-of-gravity) defuzzification for one output variable.
     *
     *   crisp = Σ(x · μ(x))  /  Σ(μ(x))
     *
     * For each sample point we take the Mamdani-clipped aggregated membership:
     * for each output set, clip its membership at the rule firing strength,
     * then OR (max) across all sets.
     *
     * Falls back to the midpoint of the range if no rule fired (Σμ = 0) so
     * the output is well-defined.
     */
    defuzzify(varName, activations) {
        const out = this._outputs[varName];
        const [min, max] = out.range;
        const STEPS = 100;
        let num = 0, den = 0;

        for (let i = 0; i <= STEPS; i++) {
            const x = min + (max - min) * (i / STEPS);
            let mu = 0;
            for (const setName in activations) {
                const fired = activations[setName];
                if (fired === 0) continue;
                const setMu = Math.min(fired, out.sets[setName](x));
                if (setMu > mu) mu = setMu;
            }
            num += x * mu;
            den += mu;
        }

        if (den === 0) return (min + max) / 2;
        return num / den;
    }

    /**
     * One-shot inference: crisp inputs → crisp outputs.
     * Also stores a debug snapshot so getFuzzyDebugInfo() can read it back.
     */
    infer(crispInputs) {
        const memberships = this.fuzzify(crispInputs);
        const { activations, activeRules } = this.evaluateRules(memberships);

        const outputs = {};
        for (const v in this._outputs) {
            outputs[v] = this.defuzzify(v, activations[v]);
        }

        this._lastDebug = {
            inputs: Object.assign({}, crispInputs),
            memberships,
            activations,
            activeRules: activeRules.sort((a, b) => b.firing - a.firing),
            outputs
        };

        return outputs;
    }

    // ============================================================
    // SECTION: Introspection (for inspector + results page)
    // ============================================================

    /** Returns metadata for UIs that want to render the variable structure. */
    getVariableSchema() {
        const flatten = (obj) => {
            const out = {};
            for (const v in obj) {
                out[v] = { range: obj[v].range, sets: Object.keys(obj[v].sets) };
            }
            return out;
        };
        return { inputs: flatten(this._inputs), outputs: flatten(this._outputs) };
    }

    /** Returns the full rule base in a readable shape. */
    getRules() {
        return this._rules.map(r => ({
            id: r.id,
            antecedents: r.antecedents.map(([v, s]) => `${v} IS ${s}`),
            consequent: `${r.consequent[0]} IS ${r.consequent[1]}`,
            why: r.why
        }));
    }

    /**
     * Returns the most recent fuzzification + rule firings + outputs, structured
     * for the in-race fuzzy inspector overlay. `null` if infer() hasn't been
     * called yet.
     *
     * Membership degrees and activations are rounded to 3 decimal places to
     * keep the inspector readable.
     */
    getFuzzyDebugInfo() {
        if (!this._lastDebug) return null;
        const d = this._lastDebug;
        const round = (n) => Math.round(n * 1000) / 1000;
        const mapDeep = (obj) => {
            const out = {};
            for (const k in obj) {
                if (typeof obj[k] === 'object' && obj[k] !== null) out[k] = mapDeep(obj[k]);
                else if (typeof obj[k] === 'number') out[k] = round(obj[k]);
                else out[k] = obj[k];
            }
            return out;
        };
        return {
            inputs:      mapDeep(d.inputs),
            memberships: mapDeep(d.memberships),
            activations: mapDeep(d.activations),
            outputs:     mapDeep(d.outputs),
            active_rules: d.activeRules.map(r => ({
                id: r.id,
                firing: round(r.firing),
                antecedents: r.antecedents,
                consequent: r.consequent,
                why: r.why
            }))
        };
    }
}

// Expose globally for non-module pages.
if (typeof window !== 'undefined') window.FuzzyEngine = FuzzyEngine;
