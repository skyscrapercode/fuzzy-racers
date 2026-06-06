/* ============================================================================
 *  PROJECT     : Fuzzy Racers: AI Racing Game
 *  SUBJECT     : ISP568 Fuzzy Logic Systems
 *  FILE        : audio.js
 *  DESCRIPTION : Fully procedural sound, synthesised with the Web Audio API.
 *                There are NO audio files: every sound (engine, powerups,
 *                collisions, countdown, tyre screech) and the looping music
 *                are generated live from oscillators and filtered noise. This
 *                matches the project's all-procedural approach (the only static
 *                asset is the favicon) and keeps everything offline.
 *
 *  SIGNAL CHAIN
 *  ------------
 *      oscillators / noise ─┬─> sfxGain ──┐
 *                           └─> musicGain ─┴─> masterGain ─> destination
 *
 *  The masterGain is driven by the Settings "Master Volume" toggle, so that
 *  control (previously inert) now actually mutes / unmutes the game.
 *
 *  AUTOPLAY POLICY
 *  ---------------
 *  Browsers start an AudioContext "suspended" until a user gesture. We create
 *  the context lazily and resume it on the first key press / pointer down,
 *  then (optionally) kick off the music.
 *
 *  PUBLIC API
 *  ----------
 *      AudioManager.attachUnlock(opts)   wire first-gesture resume (+ music)
 *      AudioManager.setEnabled(bool)     master mute / unmute (volume toggle)
 *      AudioManager.isEnabled()
 *      Engine:  startEngine() / updateEngine(speedFrac) / stopEngine()
 *      Music:   startMusic(theme) / stopMusic()
 *      SFX:     pickup() activatePowerup(typeId) hit() explosion()
 *               collision(intensity) countdownBeep(n) go() lap() finish()
 *               screech(amount)
 * ============================================================================ */

const AudioManager = {
    ctx: null,
    masterGain: null,
    musicGain: null,
    sfxGain: null,
    enabled: true,
    level: 0.7,            // 0..1 master volume level (the Settings slider)
    _unlocked: false,

    // Engine voice (continuous while a race runs).
    _engine: null,

    // Music scheduler state.
    _music: null,

    // ------------------------------------------------------------------------
    // Context lifecycle
    // ------------------------------------------------------------------------

    /** Create the context + gain buses on demand. Reads the saved Master Volume
     *  on/off + level so we start matching the Settings controls. */
    _ensure() {
        if (this.ctx) return true;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;                 // no Web Audio → silently no-op
        this.ctx = new AC();

        this.masterGain = this.ctx.createGain();
        this.musicGain  = this.ctx.createGain();
        this.sfxGain    = this.ctx.createGain();
        this.musicGain.gain.value = 0.22;      // music sits under the SFX
        this.sfxGain.gain.value   = 0.8;
        this.musicGain.connect(this.masterGain);
        this.sfxGain.connect(this.masterGain);
        this.masterGain.connect(this.ctx.destination);

        // Honour the persisted settings (toggle defaults on, level defaults 0.7).
        let on = true;
        try {
            if (typeof State !== 'undefined' && State.get('settings')) {
                const s = State.get('settings');
                on = s.volume !== false;
                if (typeof s.volumeLevel === 'number') this.level = s.volumeLevel;
            }
        } catch (e) { /* ignore */ }
        this.enabled = on;
        this.masterGain.gain.value = on ? this.level : 0;
        return true;
    },

    /** Resume the context after a user gesture (required by autoplay policy). */
    _resume() {
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },

    /** Wire a one-time first-gesture unlock. Pass { music: 'race'|'menu' } to
     *  start that music loop as soon as the page is allowed to play sound. */
    attachUnlock(opts) {
        opts = opts || {};
        const unlock = () => {
            if (this._unlocked) return;
            if (!this._ensure()) return;
            this._unlocked = true;
            this._resume();
            if (opts.music) this.startMusic(opts.music);
            window.removeEventListener('keydown', unlock);
            window.removeEventListener('pointerdown', unlock);
        };
        window.addEventListener('keydown', unlock);
        window.addEventListener('pointerdown', unlock);
    },

    // ------------------------------------------------------------------------
    // Master mute / unmute (the Settings toggle)
    // ------------------------------------------------------------------------

    setEnabled(on) {
        this.enabled = !!on;
        this._applyGain();
    },

    /** Set the master volume level (0..1) from the Settings slider. */
    setVolume(level) {
        this.level = Math.max(0, Math.min(1, level));
        this._applyGain();
    },

    /** Drive the master gain from the current enabled + level state. */
    _applyGain() {
        if (!this.ctx) return;                 // applied when context is created
        const g = this.masterGain.gain;
        const t = this.ctx.currentTime;
        g.cancelScheduledValues(t);
        g.setTargetAtTime(this.enabled ? this.level : 0, t, 0.02);
    },

    isEnabled() { return this.enabled; },
    getVolume() { return this.level; },

    // ------------------------------------------------------------------------
    // Low-level voices
    // ------------------------------------------------------------------------

    /** One enveloped oscillator note. */
    _tone(freq, when, dur, opt) {
        if (!this.ctx) return;
        opt = opt || {};
        const bus = opt.bus || this.sfxGain;
        const osc = this.ctx.createOscillator();
        const g   = this.ctx.createGain();
        osc.type = opt.type || 'square';
        osc.frequency.setValueAtTime(freq, when);
        if (opt.glideTo) osc.frequency.exponentialRampToValueAtTime(opt.glideTo, when + dur);
        const peak = opt.vol != null ? opt.vol : 0.3;
        const atk  = opt.attack != null ? opt.attack : 0.005;
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(peak, when + atk);
        g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        osc.connect(g); g.connect(bus);
        osc.start(when);
        osc.stop(when + dur + 0.02);
    },

    /** A burst of filtered noise (collisions, explosions, screech). */
    _noise(when, dur, opt) {
        if (!this.ctx) return;
        opt = opt || {};
        const n = Math.floor(this.ctx.sampleRate * dur);
        const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        const filt = this.ctx.createBiquadFilter();
        filt.type = opt.filter || 'lowpass';
        filt.frequency.setValueAtTime(opt.freq || 1200, when);
        if (opt.freqTo) filt.frequency.exponentialRampToValueAtTime(opt.freqTo, when + dur);
        if (opt.q != null) filt.Q.value = opt.q;
        const g = this.ctx.createGain();
        const peak = opt.vol != null ? opt.vol : 0.4;
        g.gain.setValueAtTime(peak, when);
        g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
        src.connect(filt); filt.connect(g); g.connect(opt.bus || this.sfxGain);
        src.start(when);
        src.stop(when + dur + 0.02);
    },

    _now() { return this.ctx ? this.ctx.currentTime : 0; },

    // ------------------------------------------------------------------------
    // Engine (continuous voice: a layered roar that revs with speed)
    // ------------------------------------------------------------------------
    //
    // Rather than a single rising oscillator (which whines at speed), the
    // engine is built from three layers summed into an amplitude-modulated bus:
    //   1. band-passed looping noise  -> airy "roar" that brightens with speed
    //   2. a low sawtooth "growl"     -> engine body (kept low + lowpassed)
    //   3. a sub triangle             -> rumble
    // An LFO modulates the bus gain to create the "chug"; its rate rises with
    // speed, so accelerating sounds like a faster rev, not a higher pitch.

    startEngine() {
        if (!this._ensure() || this._engine) return;
        const ctx = this.ctx;

        // (1) Looping noise = engine texture.
        const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        const noise = ctx.createBufferSource();
        noise.buffer = buf; noise.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 160; bp.Q.value = 1.1;

        // (2) Low sawtooth growl, lowpassed so it never becomes a thin whine.
        const growl = ctx.createOscillator();
        growl.type = 'sawtooth'; growl.frequency.value = 60;
        const growlLP = ctx.createBiquadFilter();
        growlLP.type = 'lowpass'; growlLP.frequency.value = 220;

        // (3) Sub rumble.
        const sub = ctx.createOscillator();
        sub.type = 'triangle'; sub.frequency.value = 44;
        const subGain = ctx.createGain(); subGain.gain.value = 0.5;

        // Sum bus, amplitude-modulated by the LFO (the "chug").
        const mix = ctx.createGain(); mix.gain.value = 0.55;
        const lfo = ctx.createOscillator();
        lfo.type = 'sine'; lfo.frequency.value = 22;
        const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 0.4;
        lfo.connect(lfoDepth); lfoDepth.connect(mix.gain);

        // Tame the top, then overall level (ramped in updateEngine).
        const outLP = ctx.createBiquadFilter();
        outLP.type = 'lowpass'; outLP.frequency.value = 700;
        const out = ctx.createGain(); out.gain.value = 0.0;

        noise.connect(bp);      bp.connect(mix);
        growl.connect(growlLP); growlLP.connect(mix);
        sub.connect(subGain);   subGain.connect(mix);
        mix.connect(outLP); outLP.connect(out); out.connect(this.sfxGain);

        noise.start(); growl.start(); sub.start(); lfo.start();
        this._engine = { noise, bp, growl, sub, lfo, outLP, out };
    },

    /** speedFrac in [0,1]: idle rumble at 0, brighter/faster roar at speed. */
    updateEngine(speedFrac) {
        if (!this._engine || !this.ctx) return;
        const f = Math.max(0, Math.min(1, speedFrac || 0));
        const e = this._engine, t = this.ctx.currentTime, tc = 0.12;
        e.bp.frequency.setTargetAtTime(150 + f * 520, t, tc);   // roar opens up
        e.bp.Q.setTargetAtTime(1.0 + f * 1.2, t, tc);
        e.growl.frequency.setTargetAtTime(58 + f * 70, t, tc);  // stays low
        e.sub.frequency.setTargetAtTime(42 + f * 26, t, tc);
        e.lfo.frequency.setTargetAtTime(20 + f * 55, t, tc);    // revs faster
        e.outLP.frequency.setTargetAtTime(520 + f * 1500, t, tc);
        e.out.gain.setTargetAtTime(0.05 + f * 0.07, t, tc);     // subtle overall
    },

    stopEngine() {
        if (!this._engine || !this.ctx) return;
        const e = this._engine, t = this.ctx.currentTime;
        e.out.gain.setTargetAtTime(0.0001, t, 0.06);
        const stopAt = t + 0.4;
        try { e.noise.stop(stopAt); e.growl.stop(stopAt); e.sub.stop(stopAt); e.lfo.stop(stopAt); }
        catch (_) { /* already stopped */ }
        this._engine = null;
    },

    // ------------------------------------------------------------------------
    // One-shot SFX
    // ------------------------------------------------------------------------

    pickup() {
        const t = this._now();
        this._tone(660, t,        0.10, { type: 'square', vol: 0.25 });
        this._tone(990, t + 0.08, 0.14, { type: 'square', vol: 0.22 });
    },

    /** Per-powerup activation cue (a short, type-flavoured motif). */
    activatePowerup(typeId) {
        if (!this._ensure()) return;
        const t = this._now();
        switch (typeId) {
            case 'boost':
            case 'nitro':
                this._tone(300, t, 0.35, { type: 'sawtooth', vol: 0.28, glideTo: 900 });
                break;
            case 'shield':
                this._tone(520, t, 0.30, { type: 'sine', vol: 0.3, glideTo: 780 });
                break;
            case 'repair':
                this._tone(523, t,        0.12, { type: 'sine', vol: 0.28 });
                this._tone(784, t + 0.10, 0.20, { type: 'sine', vol: 0.28 });
                break;
            case 'missile':
                this._noise(t, 0.4, { filter: 'bandpass', freq: 1400, freqTo: 300, vol: 0.4, q: 1 });
                break;
            case 'oil':
                this._noise(t, 0.3, { filter: 'lowpass', freq: 500, freqTo: 160, vol: 0.35 });
                break;
            case 'emp':
                this._tone(180, t, 0.45, { type: 'square', vol: 0.3, glideTo: 1500 });
                break;
            case 'tornado':
                this._tone(220, t, 0.5, { type: 'triangle', vol: 0.28, glideTo: 660 });
                break;
            default:
                this._tone(440, t, 0.2, { type: 'square', vol: 0.25 });
        }
    },

    hit() {
        const t = this._now();
        this._noise(t, 0.18, { filter: 'bandpass', freq: 900, vol: 0.4, q: 0.8 });
        this._tone(140, t, 0.16, { type: 'square', vol: 0.25, glideTo: 70 });
    },

    explosion() {
        const t = this._now();
        this._noise(t, 0.6, { filter: 'lowpass', freq: 1400, freqTo: 120, vol: 0.6 });
        this._tone(90, t, 0.5, { type: 'sawtooth', vol: 0.4, glideTo: 40 });
    },

    /** intensity in [0,1] scales loudness of a collision thud. */
    collision(intensity) {
        const t = this._now();
        const v = 0.2 + Math.max(0, Math.min(1, intensity || 0.5)) * 0.4;
        this._noise(t, 0.14, { filter: 'lowpass', freq: 800, freqTo: 200, vol: v });
        this._tone(120, t, 0.1, { type: 'square', vol: v * 0.6, glideTo: 60 });
    },

    /** Countdown tick: n = 3,2,1 → same pitch; use go() for "GO!". */
    countdownBeep() {
        this._ensure();
        this._tone(700, this._now(), 0.18, { type: 'square', vol: 0.3 });
    },

    go() {
        const t = this._now();
        this._tone(880, t, 0.35, { type: 'square', vol: 0.35, glideTo: 1320 });
    },

    lap() {
        const t = this._now();
        this._tone(784, t,        0.10, { type: 'square', vol: 0.28 });
        this._tone(1047, t + 0.09, 0.16, { type: 'square', vol: 0.28 });
    },

    finish() {
        const t = this._now();
        const seq = [523, 659, 784, 1047];     // C-E-G-C fanfare
        seq.forEach((f, i) => this._tone(f, t + i * 0.12, 0.22, { type: 'square', vol: 0.3 }));
    },

    /** amount in [0,1]: brief tyre screech (rate-limited by the caller). */
    screech(amount) {
        const t = this._now();
        const v = 0.06 + Math.max(0, Math.min(1, amount || 0.5)) * 0.14;
        this._noise(t, 0.18, { filter: 'bandpass', freq: 2200, vol: v, q: 6 });
    },

    // ------------------------------------------------------------------------
    // Music: a small generative loop, scheduled with look-ahead timing.
    // ------------------------------------------------------------------------

    // Scale-degree → semitone (natural minor), used to read the patterns below.
    _SCALE: [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19],

    _SONGS: {
        // Driving, slightly tense loop for races.
        race: {
            tempo: 126, stepsPerBeat: 2, root: 110 /* A2 */,
            // null = rest. Numbers index _SCALE.
            bass: [0, null, 0, 0,  -2, null, -2, -2,  3, null, 3, 3,  -2, null, 4, 4],
            lead: [7, 9, 11, 9,    7, 5, 7, null,     11, 9, 7, 9,    11, 12, 11, 9],
            bassType: 'square', leadType: 'triangle'
        },
        // Calmer, brighter loop for the menu.
        menu: {
            tempo: 92, stepsPerBeat: 2, root: 131 /* C3 */,
            bass: [0, null, null, 0,  3, null, null, 3,  4, null, null, 4,  3, null, 2, null],
            lead: [7, null, 9, null,  11, null, 9, null, 12, null, 11, null, 9, null, 7, null],
            bassType: 'triangle', leadType: 'sine'
        }
    },

    _degHz(root, deg) {
        // deg may be negative (octave-down) or beyond the table length.
        const tbl = this._SCALE;
        const oct = Math.floor(deg / 7);
        const idx = ((deg % 7) + 7) % 7;
        const semi = tbl[idx] + oct * 12;
        return root * Math.pow(2, semi / 12);
    },

    startMusic(theme) {
        if (!this._ensure()) return;
        this.stopMusic();
        const song = this._SONGS[theme] || this._SONGS.race;
        const m = {
            song, step: 0,
            nextTime: this.ctx.currentTime + 0.12,
            timer: null
        };
        const secPerStep = 60 / song.tempo / song.stepsPerBeat;
        m.timer = setInterval(() => {
            if (!this.ctx) return;
            // Schedule any steps falling within the look-ahead window.
            while (m.nextTime < this.ctx.currentTime + 0.12) {
                const i = m.step % song.bass.length;
                const b = song.bass[i];
                const l = song.lead[i];
                if (b != null) {
                    this._tone(this._degHz(song.root, b) / 2, m.nextTime, secPerStep * 0.9,
                        { type: song.bassType, vol: 0.5, bus: this.musicGain, attack: 0.01 });
                }
                if (l != null) {
                    this._tone(this._degHz(song.root, l), m.nextTime, secPerStep * 0.8,
                        { type: song.leadType, vol: 0.32, bus: this.musicGain, attack: 0.01 });
                }
                m.nextTime += secPerStep;
                m.step++;
            }
        }, 25);
        this._music = m;
    },

    stopMusic() {
        if (this._music && this._music.timer) clearInterval(this._music.timer);
        this._music = null;
    }
};

if (typeof window !== 'undefined') window.AudioManager = AudioManager;
