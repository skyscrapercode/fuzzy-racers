# Fuzzy Racers

An HTML5 racing game whose AI opponents are driven by a Mamdani-style fuzzy inference engine. Built as the coursework project for **ISP568 Fuzzy Logic Systems**.

The race world is rendered in **3D with Three.js** (vendored locally: no build step, no CDN); everything else: the menu, garage, HUD overlays, results page, and the **entire fuzzy engine**: is hand-written vanilla JavaScript + Canvas 2D. No images: every prop, car, and effect is procedural geometry. All inter-page state is persisted to `localStorage` under the `fuzzyRacers_` namespace.

## Quick start

This is a static site. Serve it with any local HTTP server, e.g.:

```bash
python3 -m http.server 8755
```

Then open <http://localhost:8755/index.html>.

> The Python dev server sends no cache headers, so after editing JS/CSS do a hard refresh (Cmd/Ctrl+Shift+R) to avoid a stale cache.

## Game flow

```
index.html  →  garage.html  →  race.html  →  results.html
   menu          select car           3D race          podium
                 customize                             stats
                 opponent                              fuzzy
                 difficulty                            summary
                 track
```

## Controls

| Key | Action |
|---|---|
| ↑ | Accelerate |
| ↓ | Brake while moving: keep holding once stopped to **reverse** (capped at ~40% of top speed) |
| ← / → | Steer (works in reverse too) |
| Space | Activate held powerup |
| P / Esc | Open the pause menu: **Resume** the race or **Restart** (back to the Garage) |
| F | Toggle the in-race AI Fuzzy Brain inspector |

If the AI gets wedged against a wall it auto-reverses for a moment to free itself, just like you can.

## Features

- **3D race world**: chase camera behind/above the player, per-track sky colour + fog, road ribbon with raised curbs, chequered start line, dashed centerline, and a soft contact shadow under every car.
- **Track-themed 3D scenery**: city skyline of lit-window buildings, desert saguaro cacti + rocks, mountain pine forest, plus red/white curb stripes on sharp corners. Layouts are deterministic per track.
- **Customization-matched car**: the 3D model mirrors your garage choices: chassis silhouette (sedan/muscle/compact/truck/wedge/coupe), body kit (aero rear wing / armored side bars / stealth low-profile), paint job pattern (racing stripes / flame / camo), and paint + accent colours.
- **8 powerups**: Speed Boost, Shield, Homing Missile (15 HP), Oil Slick, EMP Blast, Repair Kit, Tornado, and Nitro Surge (requires the Nitro Engine): each with a 3D in-world effect (missile, oil decal, EMP ring, tornado funnel, shield bubble, boost/nitro flames, particles).
- **Damage & explosions**: cars take damage from missiles and heavy collisions (`maxHealth = armor × 15`); reaching 0 HP detonates the car into a charred wreck and hands the win to the opponent (KO).
- **Live fuzzy inspector** and a **post-race fuzzy summary** (see below).

## The fuzzy engine

[`js/fuzzy.js`](js/fuzzy.js) implements Mamdani-style fuzzy inference with:

- **6 input variables**: distance, player_speed, corner, health, gap, powerup
- **5 output variables**: throttle, brake, steering, aggression, use_powerup
- **33 rules** in 6 groups (speed control, aggression, powerup usage, defensive, overtaking, steering)
- **Operators**: Zadeh `min` for AND, `max` for aggregation
- **Defuzzification**: centroid over 101 sample points

The fuzzy engine produces the AI's *intent*; three behaviours in [`js/ai.js`](js/ai.js) wrap it before it reaches the car: per-tick input **noise**, **rubber-banding** (throttle scaled by the gap), and **stuck-against-wall auto-reverse**. Champion difficulty additionally **predicts the player's powerups**.

The full rule base with plain-English explanations is documented in the header of [`js/fuzzy.js`](js/fuzzy.js) and rendered live from the engine inside the in-game **📖 Fuzzy Documentation** panel (button in the garage header): including axis-labelled membership-function charts and a per-variable quick-reference table.

## Difficulty tuning

| Difficulty | Fuzzy tick | Noise | Powerup aggressiveness | Rubber-banding | Predicts player |
|---|---|---|---|---|---|
| Rookie | 1.5 s | ±20 % | 0.20 | 0.25 | no |
| Racer | 0.8 s | ±10 % | 0.60 | 0.50 | no |
| Champion | 0.3 s | ±3 % | 0.95 | 0.85 | yes |

## In-race fuzzy inspector

Press **F** during a race to open the left-docked **AI Fuzzy Brain** panel, which visualises the full Mamdani pipeline live (~8 fps) from a dedicated visualisation engine so it stays consistent without disturbing the real AI:

1. **Fuzzification**: a membership-function chart per input, with a needle at the current crisp value and a dot where it crosses each fuzzy set (its membership degree), plus a live per-set legend.
2. **Rule activations**: the rules currently firing, ranked by firing strength, each with a strength bar.
3. **Defuzzification**: per output, the Mamdani aggregated-clipped membership area with a centroid line marking the crisp command.

## Post-race fuzzy summary

The results page shows:
- The top 5 most-fired rules of the race, with fire counts and why-comments
- A donut chart of the AI's average output distribution (Throttle / Brake / Aggression / Powerup Push)
- A modal with **every** rule the AI evaluated, ranked

## File layout

```
.
├── index.html          main menu + animated background
├── garage.html         car select → customize → opponent (3 steps) + fuzzy docs
├── race.html           3D world canvas + 2D HUD overlay canvas
├── results.html        podium + race stats + fuzzy summary
├── css/
│   ├── main.css        shared theme, modals, results page
│   ├── garage.css      garage 3-step UI, fuzzy docs panel
│   └── race.css        race HUD + fuzzy inspector
└── js/
    ├── vendor/
    │   └── three.min.js   Three.js r128 (vendored for offline use)
    ├── state.js        localStorage state (loaded first on every page)
    ├── fuzzy.js        Mamdani fuzzy inference engine + 33-rule base
    ├── car.js          car roster, customization registries, runtime physics
    ├── ai.js           fuzzy-driven AI controller (per-difficulty tick)
    ├── powerups.js     8 powerup types, boxes, projectiles, oil slicks, effects
    ├── renderer.js     track geometry generator + Canvas 2D helpers (HUD minimap, garage previews, particles)
    ├── world3d.js      Three.js scene: track, cars, scenery, powerups, FX, chase camera
    └── race.js         race manager, game loop, HUD, lap detection, fuzzy inspector
```
