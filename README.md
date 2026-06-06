# Fuzzy Racers

An HTML5 racing game whose AI opponents are driven by a Mamdani-style fuzzy inference engine. Built as the coursework project for **ISP568 Fuzzy Logic Systems**.

The race world is rendered in **3D with Three.js** (vendored locally, so there is no build step and no CDN dependency). Everything else (the menu, garage, HUD overlays, results page, and the **entire fuzzy engine**) is hand-written vanilla JavaScript and Canvas 2D. Every in-game prop, car, and effect is procedural geometry; the only static asset is an SVG favicon. All cross-page state is saved to `localStorage` under the `fuzzyRacers_` namespace.

> **Desktop + keyboard required.** The game is controlled entirely with the keyboard, so touch-only phones and tablets are blocked with a "Desktop Only" screen (`js/device-guard.js`).

## Quick start

This is a static site (no build, no backend). Serve it with any local HTTP server, e.g.:

```bash
python3 -m http.server 8755
```

Then open <http://localhost:8755/index.html> on a desktop/laptop.

> The Python dev server sends no cache headers, so after editing JS/CSS do a hard refresh (Cmd/Ctrl+Shift+R) to avoid a stale cache.

## Game flow

```
index.html  ->  garage.html  ->  race.html  ->  results.html
   menu          select car          3D race         podium
                 customize                           stats
                 opponent                            fuzzy
                 difficulty                          summary
                 track
```

## Controls

| Key | Action |
|---|---|
| Up | Accelerate |
| Down | Brake while moving; keep holding once stopped to **reverse** (capped at ~40% of top speed) |
| Left / Right | Steer (works in reverse too) |
| Space | Activate held powerup |
| P / Esc | Open the pause menu: **Resume** the race or **Restart** (back to the Garage) |
| F | Toggle the in-race AI Fuzzy Brain inspector |

If the AI gets wedged against a wall it auto-reverses for a moment to free itself, just like you can.

## Features

- **3D race world**: chase camera behind/above the player, per-track sky colour and fog, a road ribbon with raised curbs, a chequered start line, a dashed centerline, and a soft contact shadow under every car.
- **Track-themed 3D scenery**: city skyline of lit-window buildings, desert saguaro cacti and rocks, mountain pine forest, plus red/white curb stripes on sharp corners. Layouts are deterministic per track.
- **Customization-matched car**: the 3D model mirrors your garage choices, including chassis silhouette (sedan/muscle/compact/truck/wedge/coupe), body kit (aero rear wing, armored side bars, or stealth low-profile), paint-job pattern (racing stripes, flame, or camo), and the paint plus accent colours.
- **8 powerups**: Speed Boost, Shield, Homing Missile (15 HP), Oil Slick, EMP Blast, Repair Kit, Tornado, and Nitro Surge (requires the Nitro Engine). Each has a 3D in-world effect (missile, oil decal, EMP ring, tornado funnel, shield bubble, boost/nitro flames, particles).
- **Damage and explosions**: cars take damage from missiles and heavy collisions (`maxHealth = armor x 15`); reaching 0 HP detonates the car into a charred wreck and hands the win to the opponent (a KO).
- **Pause menu**: P or Esc opens a themed overlay to Resume or Restart the race.
- **Fuzzy Logic Assistant**: an in-page chatbot that explains the fuzzy logic (see below).
- **Live fuzzy inspector** and a **post-race fuzzy summary** (see below).

## The fuzzy engine

[`js/fuzzy.js`](js/fuzzy.js) implements Mamdani-style fuzzy inference with:

- **6 input variables**: distance, player_speed, corner, health, gap, powerup
- **5 output variables**: throttle, brake, steering, aggression, use_powerup
- **33 rules** in 6 groups (speed control, aggression, powerup usage, defensive, overtaking, steering)
- **Operators**: Zadeh `min` for AND, `max` for aggregation
- **Defuzzification**: centroid over 101 sample points

The fuzzy engine produces the AI's *intent*. Three behaviours in [`js/ai.js`](js/ai.js) wrap it before it reaches the car: per-tick input **noise**, **rubber-banding** (throttle scaled by the gap), and **stuck-against-wall auto-reverse**. Champion difficulty additionally **predicts the player's powerups**.

The full rule base with plain-English explanations is documented in the header of [`js/fuzzy.js`](js/fuzzy.js) and rendered live from the engine inside the in-game **Fuzzy Documentation** panel (the button in the garage header), including axis-labelled membership-function charts and a per-variable quick-reference table.

## Difficulty tuning

| Difficulty | Fuzzy tick | Noise | Powerup aggressiveness | Rubber-banding | Predicts player |
|---|---|---|---|---|---|
| Rookie | 1.5 s | ±20 % | 0.20 | 0.25 | no |
| Racer | 0.8 s | ±10 % | 0.60 | 0.50 | no |
| Champion | 0.3 s | ±3 % | 0.95 | 0.85 | yes |

## In-race fuzzy inspector

Press **F** during a race to open the left-docked **AI Fuzzy Brain** panel, which visualises the full Mamdani pipeline live (about 8 fps) from a dedicated visualisation engine, so it stays consistent without disturbing the real AI:

1. **Fuzzification**: a membership-function chart per input, with a needle at the current crisp value and a dot where it crosses each fuzzy set (its membership degree), plus a live per-set legend.
2. **Rule activations**: the rules currently firing, ranked by firing strength, each with a strength bar.
3. **Defuzzification**: per output, the Mamdani aggregated-clipped membership area with a centroid line marking the crisp command.

## Fuzzy Logic Assistant

The main menu's old "How Fuzzy Logic Works" button is now a chatbot launched from the neon icon in the bottom-right corner ([`js/chatbot.js`](js/chatbot.js)). It accepts **only predefined questions** as quick-reply buttons (no free-text input), matching the project's "buttons or sliders only" input rule:

- What is it?
- Why use it for racing AI?
- The 3-step pipeline
- What in this game is fuzzy?
- Credits

Answers are fixed, built-in content (deterministic, offline, no network or API key), so the explanation is always correct and on-message. Fill in your name and student ID in the `CREDITS` object at the top of `js/chatbot.js`.

## Post-race fuzzy summary

The results page shows:
- The top 5 most-fired rules of the race, with fire counts and why-comments
- A donut chart of the AI's average output distribution (Throttle / Brake / Aggression / Powerup Push)
- A modal with **every** rule the AI evaluated, ranked

## Requirements

- A desktop or laptop with a **physical keyboard** (touch-only devices are blocked).
- A modern browser with WebGL (for the Three.js race world) and SVG favicon support.
- No installation or build step; it is plain static files.

## File layout

```
.
├── index.html          main menu + animated background + chatbot
├── garage.html         car select -> customize -> opponent (3 steps) + fuzzy docs
├── race.html           3D world canvas + 2D HUD overlay canvas
├── results.html        podium + race stats + fuzzy summary
├── assets/
│   └── favicon.svg     themed neon top-down car favicon
├── css/
│   ├── main.css        shared theme, modals, results page
│   ├── garage.css      garage 3-step UI, fuzzy docs panel
│   ├── race.css        race HUD, fuzzy inspector, pause menu
│   └── chatbot.css     Fuzzy Logic Assistant launcher + panel
└── js/
    ├── vendor/
    │   └── three.min.js   Three.js r128 (vendored for offline use)
    ├── device-guard.js  desktop-only guard (loaded first on every page)
    ├── state.js         localStorage state (loaded first on every page)
    ├── fuzzy.js         Mamdani fuzzy inference engine + 33-rule base
    ├── car.js           car roster, customization registries, runtime physics
    ├── ai.js            fuzzy-driven AI controller (per-difficulty tick)
    ├── powerups.js      8 powerup types, boxes, projectiles, oil slicks, effects
    ├── renderer.js      track geometry generator + Canvas 2D helpers (HUD minimap, garage previews, particles)
    ├── world3d.js       Three.js scene: track, cars, scenery, powerups, FX, chase camera
    ├── race.js          race manager, game loop, HUD, lap detection, fuzzy inspector, pause menu
    └── chatbot.js       Fuzzy Logic Assistant (deterministic Q&A)
```
