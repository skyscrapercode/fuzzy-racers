/* ============================================================================
 *  PROJECT     : Fuzzy Racers: AI Racing Game
 *  SUBJECT     : ISP568 Fuzzy Logic Systems
 *  FILE        : device-guard.js
 *  DESCRIPTION : Blocks play on mobile / touch-only devices, because the game
 *                is driven entirely by the keyboard (arrow keys, Space, P, F).
 *                Shows a full-screen themed "Desktop Only" overlay.
 *
 *                Detection targets devices with NO fine pointer (phones,
 *                tablets): touchscreen laptops with a trackpad/mouse are
 *                allowed. A subtle "continue anyway" escape hatch covers the
 *                rare false positive (e.g. a tablet with a Bluetooth keyboard);
 *                the choice is remembered for the browser session.
 *
 *                Self-contained: injects its own styles + DOM. Add the single
 *                <script src="js/device-guard.js"> tag to every page.
 * ============================================================================
 */
(function () {
    'use strict';

    const SKIP_KEY = 'fuzzyRacers_skipDeviceGuard';

    // Already dismissed this session? Don't block.
    try { if (sessionStorage.getItem(SKIP_KEY) === '1') return; } catch (e) {}

    // ------------------------------------------------------------------------
    // Detection: treat as "mobile / keyboardless" when the device has a
    // coarse pointer (touch) and NO fine pointer (mouse/trackpad), or matches
    // a mobile user-agent, or is an iPad reporting as desktop Safari.
    // ------------------------------------------------------------------------
    function needsDesktop() {
        const mm = window.matchMedia ? window.matchMedia.bind(window) : null;
        const coarseOnly = mm
            && mm('(any-pointer: coarse)').matches
            && !mm('(any-pointer: fine)').matches;

        const ua = navigator.userAgent || '';
        const uaMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet|Silk|Kindle|Phone/i.test(ua);

        // iPadOS 13+ presents as "MacIntel" but reports multiple touch points.
        const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;

        return !!(coarseOnly || uaMobile || iPadOS);
    }

    if (!needsDesktop()) return;

    // ------------------------------------------------------------------------
    // Overlay (styles injected so the guard is fully self-contained).
    // ------------------------------------------------------------------------
    function build() {
        const style = document.createElement('style');
        style.textContent = `
            #device-guard {
                position: fixed; inset: 0; z-index: 99999;
                display: flex; align-items: center; justify-content: center;
                padding: 24px;
                background:
                    radial-gradient(ellipse at 50% 35%, #0b0f1f 0%, #04050a 70%);
                color: #e8ecff;
                font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
                -webkit-font-smoothing: antialiased;
            }
            #device-guard .dg-card {
                width: min(92vw, 440px);
                background: #0c0e1a;
                border: 1px solid rgba(0, 234, 255, 0.35);
                border-radius: 16px;
                box-shadow: 0 12px 40px rgba(0,0,0,0.6), 0 0 40px rgba(0,234,255,0.18);
                padding: 2.4rem 1.8rem;
                text-align: center;
            }
            #device-guard .dg-icon {
                font-size: 3rem; line-height: 1; margin-bottom: 0.6rem;
                filter: drop-shadow(0 0 12px rgba(0,234,255,0.6));
            }
            #device-guard .dg-brand {
                font-size: 0.72rem; letter-spacing: 0.32em; text-transform: uppercase;
                color: #00eaff; margin-bottom: 1rem; opacity: 0.85;
            }
            #device-guard .dg-title {
                margin: 0 0 0.8rem;
                font-size: 1.8rem; font-weight: 900; letter-spacing: 0.06em;
                text-transform: uppercase; color: #fff;
                text-shadow: 0 0 10px rgba(0,234,255,0.7), 0 0 26px rgba(0,234,255,0.4);
            }
            #device-guard .dg-text {
                margin: 0 0 0.8rem; font-size: 0.98rem; line-height: 1.6;
                color: #c7cdee;
            }
            #device-guard .dg-text b { color: #ffd400; }
            #device-guard .dg-hint {
                margin: 0 0 1.4rem; font-size: 0.82rem; color: #8a91b4;
            }
            #device-guard .dg-continue {
                background: none; border: none; cursor: pointer;
                color: #5a6088; font: inherit; font-size: 0.78rem;
                letter-spacing: 0.03em; text-decoration: underline;
                text-underline-offset: 3px; padding: 6px;
            }
            #device-guard .dg-continue:hover { color: #00eaff; }
        `;
        document.head.appendChild(style);

        const guard = document.createElement('div');
        guard.id = 'device-guard';
        guard.setAttribute('role', 'dialog');
        guard.setAttribute('aria-modal', 'true');
        guard.innerHTML =
            '<div class="dg-card">'
          +   '<div class="dg-icon">⌨️</div>'
          +   '<div class="dg-brand">Fuzzy Racers</div>'
          +   '<h1 class="dg-title">Desktop Only</h1>'
          +   '<p class="dg-text">This game is driven with the <b>arrow keys</b>, so it needs a '
          +     'physical keyboard. Please open it on a laptop or desktop computer.</p>'
          +   '<p class="dg-hint">Mobile and tablet controls aren\'t supported yet.</p>'
          +   '<button class="dg-continue" type="button">I have a keyboard: continue anyway</button>'
          + '</div>';
        document.body.appendChild(guard);

        // Stop the page scrolling behind the overlay.
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';

        guard.querySelector('.dg-continue').addEventListener('click', function () {
            try { sessionStorage.setItem(SKIP_KEY, '1'); } catch (e) {}
            guard.remove();
            document.documentElement.style.overflow = '';
            document.body.style.overflow = '';
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', build);
    } else {
        build();
    }
})();
