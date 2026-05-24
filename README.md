# Fuzzy Racers

A vanilla HTML5 + Canvas 2D racing game whose AI opponents are driven by a Mamdani-style fuzzy inference engine. Built as the coursework project for **ISP568 Fuzzy Logic Systems**.

No frameworks, no libraries, no images — every visual is drawn on canvas, all inter-page state is persisted to `localStorage` under the `fuzzyRacers_` namespace.

## Quick start

This is a static site. Serve it with any local HTTP server, e.g.:

```bash
python3 -m http.server 8755
```

Then open <http://localhost:8755/index.html>.

## Game flow

```
index.html  →  garage.html  →  race.html  →  results.html
   menu          select car           race            podium
                 customize                            stats
                 opponent                             fuzzy
                 difficulty                           summary
                 track
```

## Controls

| Key | Action |
|---|---|
| ↑ | Throttle |
| ↓ | Brake / reverse |
| ← / → | Steer |
| Space | Activate held powerup |
| P | Pause / resume |
| F | Toggle in-race fuzzy inspector |

## File layout

```
.
├── index.html          main menu + animated background
├── garage.html         car select → customize → opponent (3 steps)
├── race.html           full-screen race canvas
├── results.html        podium + race stats + fuzzy summary
├── css/
│   ├── main.css        shared theme, modals, results page
│   ├── garage.css      garage 3-step UI, fuzzy docs panel
│   └── race.css        race HUD + fuzzy inspector
└── js/
    ├── state.js        localStorage state (loaded first on every page)
    ├── fuzzy.js        Mamdani fuzzy inference engine + 33-rule base
    ├── car.js          car roster, customization registries, runtime physics
    ├── ai.js           fuzzy-driven AI controller (per-difficulty tick)
    ├── powerups.js     8 powerup types, boxes, projectiles, oil slicks
    ├── renderer.js     track geometry generator + canvas drawing helpers
    └── race.js         race manager, game loop, HUD, lap detection
```

## The fuzzy engine

[`js/fuzzy.js`](js/fuzzy.js) implements Mamdani-style fuzzy inference with:

- **6 input variables** — distance, player_speed, corner, health, gap, powerup
- **5 output variables** — throttle, brake, steering, aggression, use_powerup
- **33 rules** in 6 groups (speed control, aggression, powerup usage, defensive, overtaking, steering)
- **Operators** — Zadeh `min` for AND, `max` for aggregation
- **Defuzzification** — centroid over 101 sample points

The full rule base with plain-English explanations is documented in the header block of [`js/fuzzy.js`](js/fuzzy.js) and is also rendered live from the engine inside the in-game **📖 Fuzzy Documentation** panel (button in the garage header).

## Difficulty tuning

| Difficulty | Fuzzy tick | Noise | Powerup aggressiveness | Rubber-banding | Predicts player |
|---|---|---|---|---|---|
| Rookie | 1.5 s | ±20 % | 0.20 | 0.25 | no |
| Racer | 0.8 s | ±10 % | 0.60 | 0.50 | no |
| Champion | 0.3 s | ±3 % | 0.95 | 0.85 | yes |

## In-race fuzzy inspector

Press **F** during a race to open a semi-transparent right-side panel showing the AI's live fuzzy state: crisp inputs, membership degrees per linguistic variable (active ones highlighted green), the currently firing rules ranked by firing strength, and the defuzzified output commands. Refreshes every 500 ms.

## Post-race fuzzy summary

The results page shows:
- The top 5 most-fired rules of the race, with fire counts and why-comments
- A donut pie chart of the AI's average output distribution (Throttle / Brake / Aggression / Powerup Push)
- A modal with **every** rule the AI evaluated, ranked
