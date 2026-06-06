/* ============================================================================
 *  PROJECT     : Fuzzy Racers: AI Racing Game
 *  SUBJECT     : ISP568 Fuzzy Logic Systems
 *  FILE        : state.js
 *  DESCRIPTION : Shared cross-page game state, persisted to localStorage.
 *                Loaded first on every page so the rest of the scripts can
 *                read State.get(...) synchronously.
 *
 *  All persisted keys live under the "fuzzyRacers_" namespace.
 * ============================================================================
 */

// ============================================================
// SECTION: State store
// ============================================================

const State = {
    KEY: 'fuzzyRacers_state_v1',
    LEGACY_KEYS: ['fuzzyRacers.state.v1'],   // older key formats to migrate from

    _defaults: {
        selectedCarId: null,
        selectedCarStats: null,
        customization: {
            engine: 'stock',
            tires: 'standard',
            bodyKit: 'stock',
            paint: '#00eaff',
            accent: '#ff2bd6',
            pattern: 'stripes'
        },
        opponentCarId: null,
        difficulty: 'racer',
        trackId: 'city',
        settings: {
            volume: true,
            quality: 'high'
        },
        lastResult: null
    },

    _cache: null,

    load() {
        if (this._cache) return this._cache;
        try {
            let raw = localStorage.getItem(this.KEY);
            // Migrate any legacy keys to the current namespaced key.
            if (!raw) {
                for (const legacy of this.LEGACY_KEYS) {
                    const old = localStorage.getItem(legacy);
                    if (old) {
                        raw = old;
                        localStorage.setItem(this.KEY, old);
                        localStorage.removeItem(legacy);
                        break;
                    }
                }
            }
            const parsed = raw ? JSON.parse(raw) : {};
            this._cache = Object.assign({}, this._defaults, parsed);
        } catch (e) {
            this._cache = Object.assign({}, this._defaults);
        }
        return this._cache;
    },

    save() {
        try {
            localStorage.setItem(this.KEY, JSON.stringify(this._cache));
        } catch (e) {
            // localStorage unavailable; fall back to in-memory only
        }
    },

    get(key) {
        return this.load()[key];
    },

    set(key, value) {
        this.load();
        this._cache[key] = value;
        this.save();
    },

    reset() {
        this._cache = Object.assign({}, this._defaults);
        this.save();
    }
};

// Eagerly hydrate so pages can read State.get() synchronously.
State.load();

if (typeof window !== 'undefined') window.State = State;
