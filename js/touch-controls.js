/* ============================================================================
 *  PROJECT     : Fuzzy Racers: AI Racing Game
 *  SUBJECT     : ISP568 Fuzzy Logic Systems
 *  FILE        : touch-controls.js
 *  DESCRIPTION : On-screen touch controls for the race, so phones and tablets
 *                (iPhone / iPad / Android) can play without a keyboard.
 *
 *                Each control simply dispatches the SAME synthetic keyboard
 *                events the desktop game already listens for (ArrowUp/Down/
 *                Left/Right, Space, P, F), so there is a single input path and
 *                zero duplicated game logic:
 *                  - hold buttons (steer / accelerate / brake) fire keydown on
 *                    press and keyup on release
 *                  - tap buttons (powerup / pause / fuzzy inspector) fire a
 *                    keydown+keyup pair
 *
 *                Pointer Events + setPointerCapture give reliable multi-touch
 *                (steer while accelerating) and release even if a finger slides
 *                off a button. Only built on touch-primary devices, so desktop
 *                is completely unaffected. Self-contained: injects its own CSS
 *                and DOM. Load on race.html only.
 * ============================================================================
 */
(function () {
    'use strict';

    // Show the controls on touch-primary devices (phones / tablets). On a
    // desktop with a keyboard we do nothing, EXCEPT when ?touch=1 is in the URL
    // (a manual override for testing the controls on a laptop, or demoing them).
    const forced = /[?&]touch=1(?:&|$)/.test(location.search);
    const touchPrimary = forced ||
        (window.DeviceInfo && window.DeviceInfo.touchPrimary) ||
        (window.matchMedia &&
         window.matchMedia('(any-pointer: coarse)').matches &&
         !window.matchMedia('(any-pointer: fine)').matches);
    if (!touchPrimary) return;

    function key(type, k) {
        window.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true }));
    }

    function injectStyles() {
        const css = `
        #touch-controls {
            position: fixed; inset: 0; z-index: 100;
            pointer-events: none;          /* container is transparent to taps */
            -webkit-user-select: none; user-select: none;
            -webkit-tap-highlight-color: transparent;
        }
        #touch-controls .tc-btn {
            position: absolute;
            pointer-events: auto;
            touch-action: none;
            display: flex; align-items: center; justify-content: center;
            border-radius: 50%;
            background: rgba(10, 14, 26, 0.55);
            border: 1.5px solid rgba(0, 234, 255, 0.55);
            color: #cdeaff;
            box-shadow: 0 0 14px rgba(0, 234, 255, 0.25), inset 0 0 12px rgba(0, 234, 255, 0.08);
            backdrop-filter: blur(2px);
            -webkit-backdrop-filter: blur(2px);
            font-size: 30px; line-height: 1;
            transition: transform 0.06s ease, background 0.1s ease, box-shadow 0.1s ease;
        }
        #touch-controls .tc-btn.tc-on {
            background: rgba(0, 234, 255, 0.28);
            box-shadow: 0 0 22px rgba(0, 234, 255, 0.7), inset 0 0 16px rgba(0, 234, 255, 0.25);
            transform: scale(0.94);
        }
        /* Big driving buttons */
        #touch-controls .tc-big { width: 84px; height: 84px; }
        /* Small utility buttons (pause / inspector) */
        #touch-controls .tc-small {
            width: 46px; height: 46px; font-size: 20px;
            background: rgba(10, 14, 26, 0.45);
            border-color: rgba(0, 234, 255, 0.35);
        }
        .tc-power { border-color: rgba(255, 212, 0, 0.7) !important; color: #ffe680; }
        .tc-power.tc-on { background: rgba(255, 212, 0, 0.28) !important;
            box-shadow: 0 0 22px rgba(255, 212, 0, 0.7), inset 0 0 16px rgba(255,212,0,0.25) !important; }

        /* Positions (with iPhone safe-area insets). */
        .tc-left   { bottom: calc(26px + env(safe-area-inset-bottom)); left:  calc(24px + env(safe-area-inset-left)); }
        .tc-right  { bottom: calc(26px + env(safe-area-inset-bottom)); left:  calc(122px + env(safe-area-inset-left)); }
        .tc-gas    { bottom: calc(26px + env(safe-area-inset-bottom)); right: calc(24px + env(safe-area-inset-right)); }
        .tc-brake  { bottom: calc(26px + env(safe-area-inset-bottom)); right: calc(122px + env(safe-area-inset-right)); }
        .tc-power  { bottom: calc(124px + env(safe-area-inset-bottom)); right: calc(40px + env(safe-area-inset-right)); width: 64px; height: 64px; font-size: 26px; }
        .tc-pause  { top: calc(14px + env(safe-area-inset-top)); right: calc(14px + env(safe-area-inset-right)); }
        /* Inspector sits below pause on the right, clear of the lap HUD (top-left). */
        .tc-inspect{ top: calc(70px + env(safe-area-inset-top)); right: calc(20px + env(safe-area-inset-right)); }

        /* Portrait: racing wants landscape, so prompt a rotate and hide the
         * controls (which need the extra width). */
        #tc-rotate {
            display: none;
            position: fixed; inset: 0; z-index: 300;
            flex-direction: column; align-items: center; justify-content: center;
            gap: 1rem; padding: 2rem; text-align: center;
            background: radial-gradient(ellipse at 50% 40%, #0b0f1f 0%, #04050a 75%);
            color: #cdeaff; font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
        }
        #tc-rotate .tc-rotate-icon { font-size: 3.4rem; filter: drop-shadow(0 0 12px rgba(0,234,255,0.6)); animation: tcRotate 2.4s ease-in-out infinite; }
        #tc-rotate .tc-rotate-title { font-size: 1.3rem; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; color: #fff; text-shadow: 0 0 12px rgba(0,234,255,0.7); }
        #tc-rotate .tc-rotate-text { font-size: 0.95rem; color: #8a91b4; max-width: 24ch; line-height: 1.5; }
        @keyframes tcRotate { 0%,55% { transform: rotate(0deg); } 80%,100% { transform: rotate(-90deg); } }
        @media (orientation: portrait) {
            #touch-controls { display: none; }   /* hide controls until rotated */
            #tc-rotate { display: flex; }
        }
        `;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    function build() {
        injectStyles();
        const root = document.createElement('div');
        root.id = 'touch-controls';
        root.innerHTML =
            '<button class="tc-btn tc-small tc-inspect" data-tap="f"  aria-label="AI brain">🧠</button>'
          + '<button class="tc-btn tc-small tc-pause"   data-tap="p"  aria-label="Pause">⏸</button>'
          + '<button class="tc-btn tc-big tc-left"  data-hold="ArrowLeft"  aria-label="Steer left">◀</button>'
          + '<button class="tc-btn tc-big tc-right" data-hold="ArrowRight" aria-label="Steer right">▶</button>'
          + '<button class="tc-btn tc-big tc-brake" data-hold="ArrowDown"  aria-label="Brake / reverse">▼</button>'
          + '<button class="tc-btn tc-big tc-gas"   data-hold="ArrowUp"    aria-label="Accelerate">▲</button>'
          + '<button class="tc-btn tc-power" data-tap=" " aria-label="Use powerup">⚡</button>';
        document.body.appendChild(root);

        // Portrait rotate prompt (shown via the @media query above).
        const rotate = document.createElement('div');
        rotate.id = 'tc-rotate';
        rotate.innerHTML =
            '<div class="tc-rotate-icon">📱</div>'
          + '<div class="tc-rotate-title">Rotate your device</div>'
          + '<div class="tc-rotate-text">Fuzzy Racers plays best in landscape. Turn your device sideways to race.</div>';
        document.body.appendChild(rotate);

        // Hold buttons: keydown on press, keyup on release.
        root.querySelectorAll('[data-hold]').forEach(el => {
            const k = el.getAttribute('data-hold');
            el.addEventListener('pointerdown', e => {
                e.preventDefault();
                try { el.setPointerCapture(e.pointerId); } catch (_) {}
                el.classList.add('tc-on');
                key('keydown', k);
            });
            const release = () => { el.classList.remove('tc-on'); key('keyup', k); };
            el.addEventListener('pointerup', release);
            el.addEventListener('pointercancel', release);
        });

        // Tap buttons: a keydown+keyup pair (powerup / pause / inspector).
        root.querySelectorAll('[data-tap]').forEach(el => {
            const k = el.getAttribute('data-tap');
            el.addEventListener('pointerdown', e => {
                e.preventDefault();
                el.classList.add('tc-on');
                key('keydown', k);
                key('keyup', k);
            });
            const off = () => el.classList.remove('tc-on');
            el.addEventListener('pointerup', off);
            el.addEventListener('pointercancel', off);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', build);
    } else {
        build();
    }
})();
