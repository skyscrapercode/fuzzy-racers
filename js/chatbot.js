/* ============================================================================
 *  PROJECT     : Fuzzy Racers: AI Racing Game
 *  SUBJECT     : ISP568 Fuzzy Logic Systems
 *  FILE        : chatbot.js
 *  DESCRIPTION : "Fuzzy Logic Assistant": a deterministic Q&A that replaces
 *                the old "How Fuzzy Logic Works" menu button. Launched from a
 *                themed icon in the bottom-right corner.
 *
 *                The assistant only accepts predefined questions (shown as
 *                quick-reply buttons: there is no free-text input):
 *                  • What is it?
 *                  • Why use it for racing AI?
 *                  • The 3-step pipeline
 *                  • What in this game is fuzzy?
 *                  • Credits
 *
 *                Answers are fixed, built-in content (no LLM, no network, no
 *                API key): deterministic and offline, so it always shows the
 *                same correct, on-message explanation. The only inputs are
 *                buttons, matching the project's input constraint.
 *
 *                Self-contained: builds its own DOM and appends it to <body>.
 * ============================================================================
 */
(function () {
    'use strict';

    // ========================================================================
    // CREDITS: fill in your details (shown by the "Credits" button).
    // ========================================================================
    const CREDITS = {
        name:      'SHEIKH ADAM BAJUNID BIN MOHD FAISAL',
        studentId: '2025241314'
    };
    // ========================================================================

    // The ONLY inputs the assistant accepts (rendered as quick-reply buttons).
    const QUESTIONS = [
        'What is it?',
        'Why use it for racing AI?',
        'The 3-step pipeline',
        'What in this game is fuzzy?',
        'Credits'
    ];

    // Fixed answers, grounded in this game's actual fuzzy engine. Plain text;
    // line breaks are preserved by the bubble's white-space: pre-wrap.
    const ANSWERS = {
        'What is it?':
            "Fuzzy logic reasons with degrees of truth instead of hard yes/no answers. "
          + "A fact like \"the player is close\" can be 0.7 true rather than simply true or "
          + "false, so many soft conditions blend together into one smooth decision.",
        'Why use it for racing AI?':
            "Race telemetry is continuous and messy distance, speed, cornering, health, gap. "
          + "A traditional if/else AI either explodes with edge cases or jerks between behaviours "
          + "at hard thresholds. A fuzzy controller weighs every signal at once and produces a "
          + "smooth, defensible action exactly what you want from a believable opponent.",
        'The 3-step pipeline':
            "1) Fuzzification: raw telemetry becomes degrees of membership in fuzzy sets like "
          + "very_close, fast, and critical.\n"
          + "2) Rule evaluation: 33 IF/THEN rules fire in parallel; each rule's strength is the "
          + "min() of its conditions (Mamdani AND), and outputs are aggregated by max().\n"
          + "3) Defuzzification: the aggregated curve is collapsed to one crisp number via the "
          + "centroid method, becoming the AI's throttle / brake / steering command.",
        'What in this game is fuzzy?':
            "• Speed control: throttle and brake from corner sharpness and distance.\n"
          + "• Powerup timing: when to fire, from gap, health, and \"powerup ready\" together.\n"
          + "• Aggression: a defensive-vs-attacking blend of gap, health and proximity.\n"
          + "• Braking under risk: at critical health the AI brakes earlier and softens.\n"
          + "Press F during a race to watch the engine think live.",
        'Credits':
            "FUZZY RACERS\n"
          + "\n"
          + "Name: " + CREDITS.name + "\nRole: Creator, Developer & Maintainer\n"
          + "Student ID: " + CREDITS.studentId + "\n"
          + "\n"
          + "Goal: an interactive demonstration of fuzzy logic for the ISP568 Fuzzy Logic "
          + "Systems course. The AI opponents drive using a Mamdani-style fuzzy inference "
          + "engine (6 inputs, 5 outputs, 33 rules, centroid defuzzification), so you can "
          + "watch fuzzy reasoning make smooth, human-like decisions in real time.\n"
          + "\n"
          + "Built with:\n"
          + "• HTML5, CSS3 & vanilla JavaScript (no game framework)\n"
          + "• Canvas 2D: menus, HUD, garage previews & fuzzy charts\n"
          + "• Three.js: the 3D race world\n"
          + "• A hand-written fuzzy inference engine & arcade physics\n"
          + "• Git & GitHub for version control, Cloudflare Pages for hosting\n"
          + "• Claude Code used for assistance, with model Opus 4.7/4.8"
    };

    // ------------------------------------------------------------------------
    // DOM build
    // ------------------------------------------------------------------------
    let panel, messagesEl, chipsEl, fab, busy = false;

    function build() {
        // Launcher (bottom-right), themed to match the old menu button.
        fab = document.createElement('button');
        fab.className = 'fla-fab';
        fab.type = 'button';
        fab.setAttribute('aria-label', 'Fuzzy Logic Assistant');
        fab.innerHTML = '<span class="fla-fab-icon">🧠</span>'
                      + '<span class="fla-fab-label">Fuzzy Logic Assistant</span>';
        document.body.appendChild(fab);

        // Chat panel.
        panel = document.createElement('div');
        panel.className = 'fla-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Fuzzy Logic Assistant');
        panel.innerHTML =
            '<div class="fla-header">'
          +   '<span class="fla-title"><span class="fla-title-icon">🧠</span> Fuzzy Logic Assistant</span>'
          +   '<button class="fla-close" type="button" aria-label="Close">✕</button>'
          + '</div>'
          + '<div class="fla-messages" id="flaMessages"></div>'
          + '<div class="fla-chips" id="flaChips"></div>'
          + '<div class="fla-foot">Pick a question to learn how the AI thinks.</div>';
        document.body.appendChild(panel);

        messagesEl = panel.querySelector('#flaMessages');
        chipsEl    = panel.querySelector('#flaChips');

        // Quick-reply chips (the only accepted inputs).
        for (const q of QUESTIONS) {
            const chip = document.createElement('button');
            chip.className = 'fla-chip';
            chip.type = 'button';
            chip.textContent = q;
            chip.addEventListener('click', () => ask(q));
            chipsEl.appendChild(chip);
        }

        // Greeting.
        addMessage('bot',
            "Hi! I can explain the fuzzy logic powering this game's AI. Tap a question below.");

        // Events.
        fab.addEventListener('click', toggle);
        panel.querySelector('.fla-close').addEventListener('click', close);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && panel.classList.contains('open')) close();
        });
    }

    function toggle() { panel.classList.contains('open') ? close() : open(); }
    function open()   { panel.classList.add('open'); fab.classList.add('active'); }
    function close()  { panel.classList.remove('open'); fab.classList.remove('active'); }

    // ------------------------------------------------------------------------
    // Messages
    // ------------------------------------------------------------------------
    function addMessage(who, text) {
        const row = document.createElement('div');
        row.className = 'fla-msg fla-msg-' + who;
        const bubble = document.createElement('div');
        bubble.className = 'fla-bubble';
        bubble.textContent = text;                  // textContent → no HTML injection
        row.appendChild(bubble);
        messagesEl.appendChild(row);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return bubble;
    }

    function showTyping() {
        const row = document.createElement('div');
        row.className = 'fla-msg fla-msg-bot fla-typing';
        row.innerHTML = '<div class="fla-bubble"><span></span><span></span><span></span></div>';
        messagesEl.appendChild(row);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return row;
    }

    function setBusy(state) {
        busy = state;
        chipsEl.querySelectorAll('.fla-chip').forEach(c => { c.disabled = state; });
    }

    // ------------------------------------------------------------------------
    // Ask flow: deterministic lookup, with a brief typing beat for feel.
    // ------------------------------------------------------------------------
    function ask(question) {
        if (busy) return;
        addMessage('user', question);
        setBusy(true);
        const typing = showTyping();
        setTimeout(() => {
            typing.remove();
            addMessage('bot', ANSWERS[question] || '');
            setBusy(false);
        }, 350);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', build);
    } else {
        build();
    }
})();
