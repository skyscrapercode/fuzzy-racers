/* ============================================================================
 *  PROJECT     : Fuzzy Racers: AI Racing Game
 *  SUBJECT     : ISP568 Fuzzy Logic Systems
 *  FILE        : device-guard.js
 *  DESCRIPTION : Device detection. The game used to BLOCK touch-only devices
 *                (it was keyboard-only); it now ships on-screen touch controls
 *                (see js/touch-controls.js), so phones and tablets can play.
 *
 *                This script no longer blocks anything: it just tags the
 *                <html> element with capability classes that CSS / JS can key
 *                off:
 *                  .has-touch      device has any touch input
 *                  .touch-primary  touch is the primary input (phone / tablet:
 *                                  coarse pointer and no fine pointer, a mobile
 *                                  user-agent, or iPadOS reporting as desktop)
 *
 *                Loaded first (before other scripts) on every page so the
 *                classes are available immediately.
 * ============================================================================
 */
(function () {
    'use strict';

    const root = document.documentElement;
    const mm = window.matchMedia ? window.matchMedia.bind(window) : null;

    // Any touch capability at all (covers hybrid touchscreen laptops too).
    const hasTouch = (mm && mm('(any-pointer: coarse)').matches)
        || navigator.maxTouchPoints > 0;

    // Touch is the PRIMARY input: a coarse pointer with no fine pointer, a
    // mobile/tablet user-agent, or iPadOS 13+ (which reports as MacIntel but
    // exposes multiple touch points).
    const coarseOnly = mm
        && mm('(any-pointer: coarse)').matches
        && !mm('(any-pointer: fine)').matches;
    const ua = navigator.userAgent || '';
    const uaMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|Tablet|Silk|Kindle|Phone/i.test(ua);
    const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    const touchPrimary = !!(coarseOnly || uaMobile || iPadOS);

    if (hasTouch) root.classList.add('has-touch');
    if (touchPrimary) root.classList.add('touch-primary');

    // Expose for other scripts (e.g. touch-controls.js) without re-detecting.
    window.DeviceInfo = { hasTouch: hasTouch, touchPrimary: touchPrimary };
})();
