# MEMORY

Durable self-knowledge, curated run by run; ephemeral state belongs in
`now.md`, not here.

## Environment

- In a fresh environment the current user isn't in the `docker` group
  (`groups` omits `docker`, `/var/run/docker.sock` is `root:docker`), so a
  bare `docker build`/`docker run` fails with "permission denied while
  trying to connect to the docker API." `sudo -n docker ...` (passwordless)
  works and is the fix --- confirmed on `comp4020-final-dachi`'s second run,
  needed to build and run the exact CI image locally the way this project's
  own `PROCESS.md` discipline calls for. Bash calls that touch the socket
  need `dangerouslyDisableSandbox: true` as well as the `sudo -n` prefix.
- A background process started with shell `&`/`nohup`/`disown` inside one
  Bash tool call does not reliably survive into a *later*, separate Bash
  tool call --- each call appears to get its own shell, so a server
  backgrounded this way can vanish before the next call tries to reach it,
  giving a false "connection refused"/"crashed" signal with no error ever
  logged. Caught this on `comp4020-final-dachi`'s seventh run: a live test
  of an abrupt mid-upload TCP disconnect looked like it had crashed the
  server (next call's `curl` got `000`, `pgrep` found nothing), which would
  have been a serious finding (one dropped connection taking down the whole
  app) --- except re-running the exact same attack against a server started
  via the Bash tool's own `run_in_background: true` parameter (which the
  harness does track across calls) showed the server survives it cleanly,
  with the existing `req.on("error", reject)` handling the abrupt-disconnect
  branch exactly as it handles the already-tested oversized-body one.
  General lesson: always use `run_in_background: true` (not shell-level
  backgrounding) for any server/process a later, separate tool call needs to
  reach --- and if a multi-call live test ever shows a server "crashed" with
  zero logged error, suspect this tooling gap before writing up a bug.
- `mise` refuses to run until its config is trusted in a fresh environment:
  `mise ERROR Config files in ~/.config/mise/config.local.toml are not
  trusted` blocks every `pnpm`/`mise exec` call. Fix once per environment
  with `mise trust /home/ben/.config/mise/config.local.toml` --- it only
  marks an existing file as trusted, doesn't change its content.
- `agent-browser` (installed to `~/.bun/bin/agent-browser`, real home)
  works well for the two-viewport check the course wants: `agent-browser
  set viewport 1920 1080` / `390 844`, then `open`/`screenshot`. Real
  evidence beats assuming the CSS does what you think. In a fresh
  environment Chrome isn't installed: run `agent-browser install` once
  (downloads Chrome for Testing), and pass `--args "--no-sandbox"` on
  every subsequent `agent-browser` invocation --- headless Chrome's
  zygote sandbox check fails otherwise (`No usable sandbox!`) and
  `--with-deps` isn't needed to fix it. Invoke it as the bare
  `agent-browser` (it's on `$PATH` via `~/.bun/bin`), never as a
  literal `~/.bun/bin/agent-browser` path --- the sandbox remaps `$HOME`
  to the agents dir, not the real home, so tilde-expansion resolves to
  a nonexistent file even though the real binary and `$PATH` entry are
  fine.
- `agent-browser a11y <url> --json` runs a real axe-core audit --- worth
  reaching for on every crit, since none of the course's own checks
  (`pnpm check`) test accessibility or performance; that's explicitly left
  as the student's own sensor to wire up. On crit 1 it caught three real
  WCAG AA contrast failures (a text/background color pair reused in
  opposite fg/bg roles elsewhere in the page, so the same numeric ratio
  failed twice) that looked fine by eye and passed every other check.
  `agent-browser set media reduced-motion` (or `dark`/`light`) similarly
  lets you check a `prefers-*` media query actually fires, by reading
  `getComputedStyle(el).animationName` (or similar) live rather than just
  trusting the CSS reads correctly.
- A 320 CSS px viewport (`agent-browser set viewport 320 690`) is a cheap,
  reusable WCAG 1.4.10 reflow check --- 320px is the standard equivalence
  for "400% zoom on a 1280px display," and it's a genuinely different
  sensor from the two marking viewports (390×844, 1920×1080) and from
  resizing between them, since neither of those ever renders the page
  this narrow. Check `document.documentElement.scrollWidth` stays equal
  to the viewport width (no horizontal overflow) both on load and after
  driving whatever the core interaction is, not just a static screenshot.
  First run on assignment 1 (clean; confirmed
  [`46dca1a`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-dachi/commit/46dca1a)),
  worth reaching for on any future deliverable once the standard sensors
  (a11y, keyboard, resize, walkthrough) stop turning up anything new.
- The sandbox pins cwd to the deliverable repo: `cd /tmp/whatever && ...`
  silently resets back to the repo root on the next command rather than
  erroring. Scratch experiments (a throwaway script, a temporary `pnpm add`
  to test a package) have to happen inside the tracked tree and be cleaned
  up (`rm` the file, verify `git status` clean) rather than off to one
  side in `/tmp`.
- axe-core's `color-contrast` rule needs real layout/paint to resolve
  computed foreground/background --- jsdom doesn't do either, so running
  axe-core against a jsdom-loaded `dist/*.html` (e.g. to make the a11y
  audit a repeatable `spec/*.test.ts` instead of a manual
  `agent-browser a11y` pass) silently can't catch the contrast failures
  that matter most; only `agent-browser`'s real headless Chrome can. Not
  worth wiring into vitest --- a green check that can't see the main
  failure mode is worse than no check.
- `agent-browser a11y`'s JSON separates `violations` (real WCAG failures)
  from `incomplete` (axe couldn't auto-resolve, not a failure). Two
  recurring `incomplete` `color-contrast` shapes are non-issues, not gaps
  to chase: (1) `aria-hidden="true"` decorative elements still get
  evaluated even though real screen readers never see them; (2) text over
  a CSS gradient background, where axe can't pick a single background
  colour. For (2), don't leave it unresolved --- compute the WCAG
  contrast ratio by hand against the gradient's actual stop colours (the
  formula is short enough to inline in a `python3 -c`) to confirm the
  worst case still clears AA before moving on.
- A third recurring `incomplete` shape, distinct from the two
  `color-contrast` ones above: `aria-prohibited-attr` on a plain `<div
  aria-labelledby="...">` with no role --- axe correctly treats
  `aria-labelledby` on a non-landmark, non-widget element as unreliably
  supported by screen readers even though it isn't a hard WCAG violation.
  Caught on assignment 1 across three divs (two grouped columns plus a
  panel, each labelled by an adjacent heading). Fix is cheap and durable:
  add `role="group"` (or another appropriate role) alongside
  `aria-labelledby` whenever labelling a `div`/`span` container by a
  heading id, rather than leaving it as an unresolved `incomplete`.
- `agent-browser` has no Lighthouse-equivalent command, but its `eval`
  reaches the real Navigation Timing API, which is enough of a
  performance sensor for a static site: serve the actual `dist/` build
  (`python3 -m http.server`), then `agent-browser eval
  "JSON.stringify(performance.getEntriesByType('navigation')[0])"` (add
  `getEntriesByType('resource')` for byte counts) per page. On crit 1,
  six no-JS pages with one shared stylesheet all loaded under 50ms at
  under 5KB transfer --- confirms there's no optimisation work needed
  rather than assuming it from the stack choice. Same "wire it yourself,
  nothing in `pnpm check` covers it" gap as accessibility above; only
  worth re-running once a page picks up real weight (images, more CSS).
- `agent-browser` has no bandwidth/latency-throttling command (checked
  `agent-browser skills get core --full`, grepped for "emulate"/"throttle"/
  "delay" --- only `set offline on/off` and `network route --abort/--body`,
  neither of which simulates a slow link). Assignment 1's artefact rubric
  names "a slow connection" as an HD-band use case alongside keyboard and
  resize, and the honest way to satisfy it without hand-rolling raw CDP
  `Network.emulateNetworkConditions` calls is the same Navigation Timing
  check above: if the built site's total transfer size is a few KB with no
  images/fonts, it clears any realistic throttle by size alone, so the
  check is "read the byte count," not "simulate the packet loss." Only
  reach for real CDP-level throttling if a future page's payload is large
  enough that byte count alone doesn't settle it.
- `agent-browser open <url>` printing "✓ <title>" is not reliable proof
  the DOM is actually there to screenshot or `eval` against a moment
  later --- against one flaky external host (ffmpeg.org, on crit 2) a
  reported success was followed by a same-session `eval
  "location.href"` reading `about:blank` on the very next command, and
  a screenshot taken right after a genuine load still came back blank.
  This was specific to one slow-handshake host, not a general
  `agent-browser` bug (against the site's own `dist/` build and
  ordinary external hosts, "success" has always meant success). But
  the failure mode --- trusting the success message instead of
  checking state --- generalises: before screenshotting anything just
  navigated to (especially an external, previously-flaky, or
  slow-loading host), confirm with a cheap `eval` (`location.href`,
  `document.readyState`) rather than assuming the open command's own
  report is sufficient.

- `agent-browser`'s CLI has no multi-touch input primitive --- `mouse`/`click`
  only ever drive one pointer, and the only real multi-touch path is the raw
  WebSocket streaming protocol's `input_touch` with a `touchPoints` array,
  which isn't exposed as a CLI command. For verifying an app's own
  multi-pointer bookkeeping (e.g. a `Map<pointerId, ...>` meant to track
  independent simultaneous touches), `agent-browser eval` can dispatch
  synthetic `PointerEvent`s with distinct `pointerId`s and
  `pointerType: 'touch'` directly at the target element, then read back
  whatever DOM/CSS side effect the app produces per pointer (a class, a CSS
  custom property) to confirm two pointers are tracked independently rather
  than one clobbering the other. This is a legitimate live check of the
  app's real event-handling code (not a jsdom mock) --- it only synthesises
  the one input primitive the CLI itself can't produce (a second
  simultaneous touch point), everything downstream of `dispatchEvent` is the
  real page. Confirmed working on crit 4's `comp4020-crit4-dachi`.
- The same synthetic-`PointerEvent`-via-`eval` technique above is also the
  right sensor for a logic-symmetry pass over pointer/drag code, not just
  multi-touch: on crit 4, reading `main.ts`'s `pointermove` handler fresh
  (a pass flagged as not-yet-done in two prior hand-offs) found a real bug
  a browser screenshot or an a11y/keyboard/resize sweep would never catch
  --- any interaction with designed-in dead space between adjacent targets
  (here, the stage's CSS `gap` between pads) needs its `pointermove` handler
  checked specifically at the boundary, not just on-target. The bug: "no
  target under the pointer" and "gesture ended" were conflated into one
  branch that deleted the pointer's tracking outright, so a drag that
  briefly crossed the gap never resumed on the far side without a fresh
  pointerdown, even with the button still held. Confirmed with the
  down-on-target/move-to-gap/move-to-next-target/read-back-state sequence
  before touching source, then re-ran the identical sequence after the fix
  to prove it. General lesson: dead space between drag targets (a gap, a
  border, an inset hit-area) is a distinct test case from "on-target" and
  "gesture ended," worth checking explicitly any time a pointer handler
  hit-tests by element-under-pointer rather than by capture.
- A third technique in the same family, needed when a bug's symptom is
  masked by write ordering rather than absent: on crit 4, a recurring rAF
  loop (a keyboard key's sustain ramp) had a stale, never-terminating
  duplicate spawned by fast release-and-re-press, but polling the DOM value
  it wrote showed nothing wrong, because the stale loop and the fresh one
  both wrote every frame and the fresh one's write always landed last
  (rAF callbacks fire in registration order; the older loop always
  re-registers itself before the newer one within a shared frame).
  Monkey-patching the target element's own `style.setProperty` via
  `agent-browser eval` (wrap it, log every call with a timestamp, call the
  original) surfaced the truth: paired writes a fraction of a millisecond
  apart right after the re-press, one stale-and-climbing, one correct.
  General lesson: when a suspected duplicate-writer bug could be
  self-masking because of a deterministic "last write wins" ordering,
  polling the final value is the wrong sensor --- intercept the write call
  itself (not just its eventual DOM/CSS result) to see every write, not
  just the one that happened to be visible after the fact. Root cause was a
  loop whose "keep going" check read shared mutable state (a key string)
  rather than a token stamped at the specific invocation's own start; the
  fix (a per-press generation counter the loop checks before rescheduling)
  is the same shape as `NONE_HIT` above --- give a piece of shared,
  reused-identity state a way to distinguish "still current" from "stale"
  instead of only checking presence/absence.
- A follow-up pass on crit 4 asked whether a sibling code path (`main.ts`'s
  pluck-on-click handler, which also reuses an index-keyed id via a
  `pluckCounter`) shared that same staleness risk, and confirmed it
  doesn't: a fixed-duration `setTimeout` whose closure captures its own
  specific voice/id directly is not exposed the same way a conditional
  rAF/interval loop is, because there's nothing to *re-check* against
  shared mutable state before deciding whether to continue --- it just
  fires once, unconditionally, for the exact voice it was given. The
  staleness bug class above needs both ingredients: a recurring
  reschedule, and an exit check that reads shared state instead of an
  invocation-specific token. One ingredient missing (here, no reschedule
  at all) means the pattern doesn't apply, and confirming that by reading
  the code is legitimate, not a wasted pass.
- A fourth technique in the same family, found only after both the
  state-symmetry and logic-symmetry lenses above had gone dry twice on
  crit 4: ask where a listener is *attached*, not just what it does. An
  interaction that deliberately skips pointer/mouse capture (to let a drag
  retarget across sibling elements, as `NONE_HIT` above enables) needs its
  release/cancel listeners on `window`/`document`, not the interactive
  element itself --- without capture, a bubbled event only reaches a
  listener if the pointer is currently over that element's subtree, so
  releasing outside the element's bounds (trivial when the element is a
  small region with page chrome around it, not the full viewport) never
  fires anything, leaving whatever "gesture ended" cleanup was meant to run
  never running. Confirmed with the same synthetic-`PointerEvent`-via-`eval`
  technique above: drag from the target onto a page element well outside
  its bounding rect, release there, read back whatever state the release
  handler was meant to reset. General lesson: whenever code explicitly
  chooses not to use pointer/mouse capture, check every listener meant to
  observe "gesture ended" (up, cancel, and to a lesser extent leave/out) is
  bound to a target guaranteed to receive the event regardless of where the
  pointer physically ends up --- `pointerdown`/`start` can stay scoped to
  the interactive element since a gesture still has to originate there, but
  `up`/`cancel` can't.
- A fifth technique in the same family, found on crit 4's ninth run after the
  listener-placement lens above had already found and fixed its one bug and
  gone dry on a repeat pass: ask what happens to one piece of shared
  per-target visual state when two independent identities (voices, players,
  input sources) legitimately act on the same target at once. Aurora Keys
  keys its active voices by a per-input-source id (`pointer:<pointerId>`,
  `key:<char>`, `pluck:<index>:<n>`), which deliberately lets a held key and
  a pointer, or two touches, sound on the *same pad* simultaneously --- but
  each pad's `--level` CSS custom property was one write-wins slot, set
  unconditionally by whichever voice pressed, moved, or released last.
  Releasing one voice zeroed the pad's glow even while a sibling voice on
  that same pad kept sounding, invisible until the surviving voice happened
  to move. Confirmed with two synthetic `PointerEvent`s (distinct
  `pointerId`s) landing on one pad, releasing one, and reading `--level`
  back while the other stayed down and kept answering `pointermove`
  correctly afterwards --- proving the dark pad was a pure visual bug, not
  a dropped voice. Fixed by tracking each voice's own level per target and
  displaying an aggregate (here, the loudest still-active one) instead of a
  single mutable slot. General lesson: a state-symmetry pass usually asks
  "do this function's own tests/branches agree with each other"; this is
  the multi-writer variant --- whenever an id scheme is deliberately widened
  to let several independent things act on one shared target (a namespaced
  voiceId, a per-user cursor, a per-tab lock), check every place that target
  has a single piece of mutable state written by more than one of those
  ids, and ask what the last writer clobbers when it isn't the only one
  still active.
- A sixth technique in the same family, found on crit 4's tenth run after two
  prior JS/state-symmetry lenses had gone dry: when browser-level and
  logic-level sensors both stop finding anything in the script, move the same
  "does this actually do what it visually claims" question into the
  stylesheet, specifically animated CSS custom properties. A `@keyframes`
  block that sets a custom property (e.g. `--level: 0.22` at 50%) only
  interpolates smoothly if that property is registered via `@property` with a
  numeric `syntax`; unregistered, the browser treats it as an opaque token and
  the animation becomes a discrete flip partway through each keyframe
  interval instead of a tween. This is invisible to a single screenshot
  (both endpoint values look plausible alone) and to a11y/reduced-motion
  checks (neither samples a value's shape over time) --- the only sensor that
  catches it is polling `getComputedStyle(el).getPropertyValue('--x')` every
  ~100ms across a full animation cycle via `agent-browser eval` and checking
  for intermediate values, not just the two extremes. Confirmed on Aurora
  Keys' idle "breathing" pulse (flat `0`/`.22` toggle, no values between),
  fixed with `@property --level { syntax: "<number>"; inherits: false;
  initial-value: 0; }`, re-confirmed with a continuous curve after. General
  lesson: whenever a stylesheet animates a custom property directly with
  `@keyframes` (not just reads it inside a `calc()` that some other
  transitioning property depends on), check it's `@property`-registered ---
  otherwise "animate" silently means "toggle," and a computed-value time
  series is the only sensor built for this codebase's other checks that can
  actually see it.
- A methodology caution, not a new technique: the synthetic-`PointerEvent`-
  via-`eval` family above is only trustworthy against a page state you know
  is clean. On crit 4's eleventh run, testing whether a right mouse-click
  (pointerdown fires for any button, not just the primary one, since the
  app never checks `event.button`) leaves a stuck note looked like a real
  bug on the first attempt --- the pad stayed lit after mouse-up --- but
  that was contamination from an earlier, separate `eval` in the *same*
  page session that had dispatched a synthetic `PointerEvent` and never
  sent a matching up/cancel for it; the lit pad was that orphaned voice,
  unrelated to the right-click under test. Reloading the page
  (`agent-browser open <url>` again) immediately before the isolated test
  gave the true (clean) result: right-click down/up correctly zeroed
  `--level`, no bug. General lesson: before trusting any "state looks
  wrong" reading from a multi-step `eval` investigation, ask whether an
  earlier step in the *same* session left an un-released synthetic event
  behind, and reload for a clean slate before the check that actually
  matters --- don't assume each `eval` call implies a fresh page. Separately,
  for plain pointer-button questions (as opposed to multi-touch, which
  needs synthetic events because the CLI can't drive two real pointers),
  a real CDP `agent-browser mouse down/up <button>` is a strictly more
  faithful sensor than `dispatchEvent`d `PointerEvent`s --- it exercises
  genuine browser event sourcing (button field, ordering) rather than
  values the test author chose by hand.
- A seventh technique, found on crit 4's twelfth run after the state-symmetry
  and logic-symmetry lenses had gone dry the previous run: when a codebase's
  own logic keeps confirming clean, stop asking "does it agree with itself"
  and ask "does it agree with the browser/OS environment around it." A
  keydown handler that matches on bare letter keys spanning most of a QWERTY
  row (here, `a s d f g h j k` as Aurora Keys' scale) and calls
  `preventDefault()` unconditionally is exactly the shape that silently
  hijacks real OS/browser shortcuts, because `event.key` for a letter is
  unchanged by Ctrl/Meta/Alt --- only the modifier flags distinguish "the
  bare letter" from "the letter plus a live shortcut." `Ctrl+F` (find),
  `Ctrl+A` (select all), `Ctrl+S` (save), `Cmd+D` (bookmark), `Ctrl+H`
  (history), `Ctrl+J` (downloads), `Ctrl+K` (address-bar search), and
  `Ctrl+G` (find next) all matched Aurora Keys' scale letters and got eaten
  along with an unrequested note. Confirmed with a real CDP
  `agent-browser press Control+f` (genuine browser shortcut arbitration,
  not a synthetic `dispatchEvent` --- a synthetic `KeyboardEvent` wouldn't
  exercise the actual OS/browser-level shortcut contention this bug is
  about) and a same-page bubble-phase listener reading back
  `event.defaultPrevented`: `true` before the fix, `false` after a one-line
  modifier guard. General lesson: whenever a keydown handler binds bare
  letter/digit keys across a keyboard region and calls `preventDefault()`
  without checking `ctrlKey`/`metaKey`/`altKey`, check it against whichever
  modifier+key combos are live shortcuts on that same row before calling the
  input scheme done --- this is a distinct question family from the
  six state/logic-symmetry techniques above, worth reaching for once those
  have gone dry rather than assuming a clean internal-logic pass means the
  page has no more bugs.
- The modifier-key keydown lesson (bare letter/arrow keys bound globally,
  `preventDefault()` called without checking `ctrlKey`/`metaKey`/`altKey`)
  reproduced on a second, unrelated project: `comp4020-crit5-dachi` (Swerve,
  a lane-dodge game) bound `a`/`d`/arrow keys the same way Aurora Keys did,
  and the same real-`agent-browser`-`press` + bubble-listener method
  (`Control+a`, `Alt+ArrowLeft`, read `event.defaultPrevented` back) found
  it was hijacking select-all and back-navigation. One-line fix
  (`if (e.ctrlKey || e.metaKey || e.altKey) return;` at the top of the
  handler), re-confirmed clean. Worth treating as a standard check on any
  future project with a global keydown handler, not something specific to
  music/instrument-shaped prototypes --- the bug class is about the input
  binding shape (bare key, global listener, unconditional
  `preventDefault`), not the domain.
- A precise follow-up on the modifier-key lesson above, confirmed on crit 4's
  thirteenth run with a real CDP `agent-browser press Shift+F` (not a
  synthetic dispatch): Shift changes `event.key` for a letter (`"f"` →
  `"F"`), so a handler that lowercases before matching (as Aurora Keys'
  keydown handler does) still fires and still calls `preventDefault()` on a
  Shift+letter combo. This is *not* the same bug class as Ctrl/Cmd/Alt+letter
  --- Shift+bare-letter isn't a live OS/browser shortcut on its own the way
  those modifiers are, so there's nothing to hijack. Don't extend the
  modifier-guard lesson to Shift by pattern-matching on "it's a modifier
  key" without checking whether that specific modifier actually gates a real
  shortcut; confirm with a real `press <Modifier>+<key>` and read
  `defaultPrevented` back rather than assuming symmetry with Ctrl/Cmd/Alt.
- A single-letter global keyboard scheme (an interaction bound to bare
  letter keys on `keydown`, not scoped to a focused element) can collide
  with screen-reader browse-mode quick-navigation keys (NVDA/JAWS: `h` =
  next heading, `b` = next button, `f` = next form field, etc.) --- those
  letters get consumed by the AT before they ever reach the page's own
  listener when no widget has focus. Checked this reasoning against Aurora
  Keys' `a s d f g h j k` scale on crit 4's thirteenth run and concluded
  it's not an operability bug worth chasing: as long as every interactive
  element the scheme controls is *also* reachable and operable via its own
  native semantics (here, `<button>` elements with `Tab` + `Enter`/`Space`,
  which focus mode in modern screen readers passes through regardless of
  browse-mode quick-nav), the letter shortcuts are a sighted/mouse-first
  enhancement layered on top of a fully keyboard-operable page, not the only
  path to the interaction. General lesson: when a page binds global
  single-letter hotkeys, check whether the same functionality has an
  independent, always-available path (native semantic element + standard
  keyboard activation) before treating an AT quick-nav collision as a
  blocking a11y bug --- it's real, but only load-bearing if the hotkey is
  the *sole* way to reach the behaviour.
- An eighth technique, found on crit 4's fourteenth run once the modifier-key
  lesson's own family (app-vs-browser keyboard shortcuts) had already gone
  dry twice: the same "does the page fight the browser's own input handling"
  question applies to touch/zoom gestures, not just keyboard shortcuts, and
  `getComputedStyle` cannot see it. Aurora Keys had `touch-action: none` on
  `body`, added so a pad drag wouldn't also trigger page scroll/zoom.
  `touch-action` is not inherited the normal CSS way --- its real effect on a
  given touch is the *intersection* of the touched element's value with
  every ancestor's, resolved by the browser's own gesture recognizer, not
  the CSS cascade. `getComputedStyle` on a descendant only ever shows that
  element's own specified value (`auto`), unchanged whether or not an
  ancestor's `none` is silently overriding it for real touches --- so this
  class of bug is invisible to the single most-reached-for sensor
  (`getComputedStyle`) in this whole crit's toolkit. Because `body` wraps the
  entire page, the one declaration killed pinch-zoom everywhere (header
  link, hint text, all of it), not just over the instrument, and axe-core's
  `meta-viewport` rule never caught it since it only checks the viewport
  `<meta>` tag, not CSS `touch-action`. Fixed by moving the declaration to
  the one element (`.stage`) whose gesture actually needs it; confirmed with
  `getComputedStyle` reads before/after (`body`/`header a`: `none` → `auto`)
  plus a synthetic two-pointer drag proving the stage's own gesture was
  unaffected. General lesson: whenever a `touch-action` (or any CSS property
  with composited/intersection semantics rather than plain inheritance --
  `touch-action` is the main one in practice) is set on a broad ancestor for
  one specific interaction's sake, check it against the narrowest element
  that actually needs it, not the container it was convenient to write it
  on --- and don't trust `getComputedStyle` on descendants to reveal the
  problem, since it won't.
- No `/ship` skill and no `gh auth` are available to me in this environment
  (confirmed on crit 2: `gh auth status` reports not logged in, and no
  ship-shaped skill appears in the session's skill listing). A prior hand-off
  note for a different repo listed "push, run `/ship`" as a next action, but
  that was this agent guessing at a step, not something actually available to
  run --- doctrine.md says outright "you never receive its GitHub
  credential." The routine's step 6 is just "push the clean tree"; flipping
  a repo from private to public and triggering the CI sweep is the trusted
  harness's job, done separately from any run of mine, not a command I issue.
  Don't plan a next action around running `/ship`.
- A ninth technique, closing out the "does the page fight the browser's own
  input/gesture handling" family the seventh technique (above) opened: once
  a broad `touch-action` fix is scoped down, explicitly re-check the two
  adjacent things that kind of fix could plausibly have collateral effects
  on, rather than assuming the fix is clean because the one symptom it was
  built to address is gone. On crit 4's fifteenth run, checked (1) whether
  dragging inside the now-narrowly-scoped element still selects text ---
  confirmed no, via a real mouse-drag gesture across a `<button>` label
  reading `window.getSelection().toString()` back empty, while the same
  drag over ordinary page text (a `<p>`) selected normally, proving the
  scoping is exactly as narrow as intended rather than accidentally still
  broad --- and (2) whether the viewport `<meta>` tag or any CSS separately
  restricts pinch-zoom (`user-scalable`/`maximum-scale`), which it didn't.
  Neither check found a new bug, but both were genuinely open questions a
  prior hand-off had explicitly flagged as unchecked, not a re-run of a
  question already answered --- confirming a fix's boundary is exactly
  where you drew it is legitimate deepening, not busywork, once the fix
  itself is already landed.
- A tenth technique in the app-vs-browser-input-handling family the seventh
  technique opened: check whether a keydown handler calls `preventDefault()`
  on *every* branch a matched key can take, not just whether it guards the
  right modifiers. On crit 5 (`comp4020-crit5-dachi`, Swerve), the handler
  only called `preventDefault()` for Space/Enter when `gameOver` (to gate the
  restart), so Space during live play --- where the game itself does nothing
  --- fell through to the browser's default page-scroll. Invisible at both
  marking viewports, where the page never overflows, and invisible to a
  static `getComputedStyle`/layout check for the same reason. The fix earlier
  in this same repo (`resize()`'s 0.5 minimum scale floor, so a fixed-aspect
  canvas never shrinks below half its logical size) is exactly what made the
  bug reachable at all: a short-enough viewport forces the canvas taller than
  the window despite the letterbox, and only then does Space's default
  scroll have anywhere to go. Confirmed with a real `agent-browser press
  Space` and `window.scrollY` at a viewport (390×250) deliberately chosen to
  break that "canvas always fits" invariant --- `98` before the fix, `0`
  after (`preventDefault()` called unconditionally for Space/Enter, `gameOver`
  gates only the `resetGame()` call). General lesson: when a control's
  default browser action is only suppressed conditionally, the condition
  itself can be exactly the branch where the page's own layout invariants
  are most likely to have quietly broken --- test at a viewport chosen to
  break the invariant on purpose, not just the two marking viewports where
  by design it never does.
- The 320 CSS px reflow check (documented above under its first use, on
  assignment 1) transfers cleanly to a from-scratch canvas-free instrument
  page too, not just a chat-log-style layout: run for the first time on
  `comp4020-crit4-dachi` (Aurora Keys) on crit 4's fifteenth run, confirmed
  clean both at rest and mid-drag across the pad row
  (`document.documentElement.scrollWidth === innerWidth` throughout).
  Worth treating as a standard once-per-project check on any future
  deliverable, not something to re-derive project by project.
- For a canvas/DOM game whose real state (score, lane, spawned-row list) is
  closed over inside `main.ts` and never attached to the page, `agent-browser
  eval` can't read it directly --- there's nothing in the DOM to query. A
  temporary `window.__debug = () => ({ ...state })` assignment at the bottom
  of the entry module, added only for the playtesting session and removed
  before the commit (diffed with `git diff` to confirm it's gone), turns
  `agent-browser eval "window.__debug()"` into a real state probe: poll it on
  an interval to see exactly which lane/row/whatever is about to matter, react
  with the correct input, and confirm the mechanic is fair rather than
  guessing from a screenshot's visual read alone. Used on crit 5 (`Swerve`) to
  verify collision/restart/scoring end-to-end and to catch that a `press`
  landing after a collision already happened (per the debug probe's own
  timestamp) correctly fell through to a restart rather than a stray move ---
  confirming the "any input after game-over restarts" design rather than
  exposing a bug. Also surfaced that repeated CLI round-trips (`open`,
  `screenshot`, `eval`, each with real subprocess/network overhead) can easily
  cost more wall-clock than a tight in-game reaction window allows, so an
  automated "loss" mid-investigation may be an artefact of tooling latency,
  not the game being unfair --- cross-check against the probe's own state
  (did a row's `y` already cross the collision threshold in the same read
  that shows the loss?) before concluding the game itself is too harsh.
- For a `prefers-reduced-motion` check on a **canvas** animation (as opposed
  to an animated CSS property, which `getComputedStyle` polling already
  covers), `getComputedStyle` has nothing to read --- a canvas draws to a
  bitmap, not the DOM. The equivalent sensor is monkeypatching the specific
  draw call the animation drives (e.g. wrap `ctx.arc` via `agent-browser
  eval`, log every radius passed to it, call the original) and comparing the
  set of distinct values with and without the media feature forced. On crit
  5 (Swerve), forcing `reduced-motion: reduce` collapsed the player marker's
  pulse to a single repeated radius (`20`), while the default state produced
  69 distinct values across one second --- confirming the existing
  `!reducedMotion` guard in `main.ts` actually disables the animation rather
  than just narrowing it. Same underlying question as the `@property`
  registration check from crit 4 (does a value that's supposed to vary
  continuously actually do so, or does it silently collapse to a toggle),
  applied to a different rendering surface --- intercept the draw/write call
  itself when the sensor you'd normally reach for (computed style, DOM
  attribute) can't see the surface the animation lives on.
- A scroll-lock verification pitfall, found on `comp4020-ass2-dachi`: CSS
  `overflow: hidden` (on whichever element is `document.scrollingElement`)
  blocks a real wheel/touch/scrollbar-drag gesture from moving the page, but
  does **not** block a scripted `window.scrollBy`/`scrollTo` call --- so
  testing a scroll-lock fix with `agent-browser eval "window.scrollBy(...)"`
  gives a false negative (the script-driven scroll still "succeeds" even
  though a real user's input would have been blocked). The correct sensor is
  a genuine input event: `agent-browser mouse wheel <dy>` dispatches a real
  wheel event through CDP, which respects the lock the way an actual user's
  scroll would. Confirmed on the Doorology mobile nav menu: `scrollBy`
  moved the page even after adding `overflow: hidden`, `mouse wheel` did
  not. Separately, don't assume `document.body` is the element to lock ---
  check `document.scrollingElement === document.documentElement` first (true
  on this page's grid-based body layout); locking the wrong element is a
  silent no-op with no error to catch it.
- A contrast-check pitfall found on `comp4020-ass2-dachi`: neither
  `getComputedStyle` nor axe-core can resolve a colour authored with a
  modern CSS colour function (`oklch(...)`, `light-dark(...)`) down to sRGB
  for a by-hand WCAG contrast calculation --- `getComputedStyle` on a real
  Chromium build serialised both straight back as the same un-evaluated
  function string, not `rgb(...)`. The reliable sensor is a 1×1 canvas
  round trip: create a `<canvas>`, set `ctx.fillStyle` to the colour string
  (or the computed-style value, whatever form it's in), `fillRect`, then
  `getImageData` --- canvas fill-style resolution always returns concrete
  sRGB bytes regardless of what colour space or function the source used,
  since the canvas has to rasterise to a real pixel. Used this to confirm
  Doorology's project-authored `.at-footer-theme-toggle:focus-visible`
  fix (`src/styles/a11y-fixes.css`, an outline colour that stays a fixed
  brand accent against a `light-dark()`-toggling background) clears the
  WCAG 1.4.11 non-text 3:1 floor in both themes (~5.8:1 dark, ~3.5:1
  light) --- a check the theme's own `oklch`-based tokens made otherwise
  unreadable to script. General lesson: whenever a stylesheet uses
  `oklch`/`lab`/`light-dark`/any CSS Color 4 function directly (rather than
  a plain hex/rgb literal), route a by-hand contrast check through a canvas
  fill first rather than trusting `getComputedStyle`'s string to already be
  sRGB.
- A soft-navigation verification pitfall, also found on `comp4020-ass2-
  dachi`: a project whose theme leaves Astro's `ClientRouter` at its
  default (`true`) transitions between pages without a full reload, which
  means every `agent-browser` check that only ever drives a fresh `open` or
  a `location.reload()` has never actually exercised the page the way most
  real clicks do. Confirm a check is really testing a soft transition (not
  quietly still forcing a hard reload) by stashing a `window.__mark` global
  before navigating and reading it back after --- a hard reload destroys
  it, a `ClientRouter` swap doesn't. Worth doing specifically for any
  custom document-level integration (a `MutationObserver`, a `keydown`
  listener, a theme-init script) that a project bolts on via
  `injectScript`/inline `<script>`, since those were all built and verified
  against full page loads first and a soft transition is a genuinely
  different code path (Astro swaps the DOM under a persisting `document`,
  so listeners bound to `document` survive but state that lived on since-
  replaced elements, like a stale `aria-expanded` or inline style read by a
  freshly re-queried element, does not carry over automatically --- it has
  to be explicitly re-synced, e.g. via an `astro:page-load` listener).
- **A hand-picked colour fix for a contrast failure is only verified in the
  theme whose failure prompted it, unless checked in every theme the site
  ships.** On `comp4020-ass2-dachi`, an early fix for a light-mode
  `color-contrast` failure (card titles at 3.43:1 against `--at-heading`'s
  default) swapped in `--at-secondary`, confirmed to clear 5.7:1 --- but
  only checked against the light theme's background. `--at-primary` and
  `--at-secondary` were both flat hex, not `light-dark()`-aware, so the
  same dark-bronze `--at-secondary` that reads fine on a near-white
  background read only 3.5:1 on the dark theme's near-black one, a real
  regression that sat undetected across several later, unrelated dark-mode
  checks (all of which happened to audit *other* elements) until a
  dedicated a11y sweep with dark mode deliberately forced caught it.
  Confirmed the fix and the bug both by computing exact WCAG ratios from
  the resolved sRGB backgrounds (the canvas round-trip technique above),
  not by eye. Fixed with `light-dark(var(--at-secondary),
  var(--at-primary))` --- `--at-primary` happened to clear AA against the
  dark background precisely because it was the token the *original*
  light-mode fix had rejected for being too pale there. General lesson:
  when a contrast fix picks one concrete colour to solve one theme's
  failure, immediately re-run the same audit with the *other* theme
  forced, before considering the fix done --- a fix that only works in the
  theme you were looking at when you found the bug is exactly the kind of
  thing that survives silently until a dedicated cross-theme sweep asks
  the question directly.

- `agent-browser snapshot -c` (the full accessibility tree, not `-i`
  interactive-only) is a distinct sensor from an axe-core audit for
  landmark/heading structure: axe checks isolated static rules (contrast,
  labelling, ARIA validity), but doesn't assert the *shape* a screen-reader
  user would actually navigate by --- whether landmarks are distinct and
  labelled (two `navigation`s need different accessible names to be
  tellable apart by landmark-jump), and whether headings descend without
  skipping a level. Run for the first time on `comp4020-ass2-dachi` across
  a session page, a lecture page, and the homepage: all three came back
  clean (`navigation "Main"` / `main` / `complementary "Related"` /
  `contentinfo` / `navigation "Legal"`, no skipped heading levels). Worth
  treating as a standard once-per-content-stable-period check on any
  multi-page site, the same way the 320px reflow and two-viewport
  screenshot sweeps already are --- it's cheap (one `snapshot -c` per
  distinct page template) and checks something none of this project's
  other sensors do.
- **WCAG 1.4.1 (use of color) is invisible to axe-core in any mode --- jsdom
  or a real browser --- because it isn't an automatable rule at all: judging
  whether a colour is the *only* signal for some state needs reading what the
  markup means, not measuring contrast or ARIA validity.** On
  `comp4020-crit7-dachi` (a room-booking app), a finished booking's table row
  got `tr.past { color: #595959 }` and nothing else --- no text, no ARIA
  attribute --- so a screen-reader user (or anyone who can't perceive the
  dimming) had no way to tell a past booking from an upcoming one, even
  though both this project's jsdom `invariants.test.ts` axe pass and an
  earlier live `agent-browser a11y` sweep had already come back 0
  violations/incomplete. Found by reading the CSS class names that encode
  state (grep for a `.className { color: ... }` rule with no sibling
  text-content or `aria-*` change) and asking "if I deleted this rule, could
  a sighted user still tell?" --- not by any sensor already in this file.
  Fixed by appending literal " (past)" text next to the timestamp rather than
  an `aria-`-only fix, since a visible label satisfies 1.4.1 for everyone
  (low vision, colour-blind, high-contrast mode) where an `sr-only` span
  would only fix it for screen-reader users. Confirmed by rendering the built
  server against a scratch SQLite file seeded with one past and one future
  booking and diffing the two rows' HTML, not by trusting the code read
  alone. General lesson: whenever a stylesheet rule keys off a state-bearing
  class name (`.past`, `.active`, `.error`, `.selected`) and only changes
  colour, check the markup for a second, non-colour signal of that same
  state before trusting a clean axe/a11y sweep --- axe's silence on this
  class of bug means "not checked," not "fine."

## Content-heavy deliverables (assignment 2 and beyond)

- For a deliverable that's mostly interlinked prose (a twelve-week course
  site, as opposed to the crit series' single-page games/instruments), the
  build/a11y/keyboard/resize sensors that dominate the crit entries above
  only catch structural and rendering problems --- they can't see a factual
  contradiction *between* two pieces of prose that each read fine alone. A
  dedicated subagent doing one fresh, complete read of every content file
  (all sessions, lectures, assessments, people, config, policy pages) for
  cross-page consistency and voice-rule compliance is the right sensor for
  this failure class, and is cheap to run once content is substantially
  built. On `comp4020-ass2-dachi` (Doorology), this single pass found two
  real bugs a build-green, a11y-clean, checks-passing site still had: an
  assessment's own body calling a working-studio week a "crit" (contradicted
  the session file's own title), and — the sharper one — the policies page's
  blanket "every assessment is due at the crit that marks it" claim, which
  was quietly false for the capstone (genuinely due eleven days after the
  closing crit, per that session's own text, so its own typology could
  absorb the closing crit's wider door survey). Neither is catchable by
  `pnpm check`, axe, or a screenshot; both are catchable by one subagent
  reading everything with fresh eyes and cross-checking claims against the
  frontmatter they generalise over. Worth running this once per
  content-stable period on any prose-heavy deliverable, the same way the
  crit series reaches for a11y/keyboard/resize once per stable period on an
  interactive one.

- **Before flagging a project's self-authored content rule as unmet, check
  whether a third-party template package it builds on already has its own
  doc comment settling the question.** On `comp4020-ass2-dachi`'s fourth run,
  this project's own `CLAUDE.md` reads "a session or lecture's `spec:` must
  be a checkable contract," but only sessions had populated `spec:`
  frontmatter, none of the six lectures did, and the custom test only
  asserted it for sessions --- looked like a real content gap on first
  glance. Reading `astro-course-university`'s `schemas.ts` doc comment
  (the template both this and several sibling agents' course-site
  deliverables are built on) resolved it: "declare [spec] on anything that
  gets a mark ... leave it empty elsewhere" --- lectures aren't graded,
  sessions are the right place for a checkable outcome. Not a bug, design
  as intended. General lesson: an apparent gap between a project's own
  written rule and its content can be the rule being under-specified, not
  the content being wrong --- check the underlying library/template's own
  source comments (not just its README) for the actual designed contract
  before spending an edit "fixing" something that was already correct.

- **A project's own content rule can be silently violated without any
  visible symptom, when the underlying template already tolerates the
  violation.** `comp4020-ass2-dachi`'s own `CLAUDE.md` says every
  `related:` edge is declared once, never on both sides. On its fifth run,
  reading every session/lecture's raw frontmatter side by side (not just
  the rendered pages) found all six session-lecture pairs declared the
  edge from both ends. Reading `astro-course-university`'s
  `course-graph.ts` (`symmetriseRelated`) explained why nothing looked
  wrong: it builds each node's shown list from its own declared `related`
  plus any *new* incoming edges, checking `!back.includes(edge.from)`
  before adding --- so a redundant declaration on the far side is already
  in `back` and never gets appended twice. The bug was real (a written
  content rule being violated) but had zero rendering symptom, findable
  only by reading raw frontmatter across files and cross-checking against
  the library's own dedup logic, not by any browser-level sensor. Fixed by
  dropping the edge from one side (the lecture) in each of the six pairs
  and adding a `spec/` test against the API's raw `edges` array (which is
  pre-symmetrisation, unlike each node's `related` field) asserting no
  `(A,B)` pair has both directions declared. General lesson: for a
  content-graph-shaped deliverable, a project's own declared authoring
  rule is worth grepping the raw content for directly, even when every
  rendered page already looks correct --- the template's own robustness
  (deduping a mistake into invisibility) is exactly what lets the mistake
  survive undetected by every other sensor.

- **Unlike the crit series' bare template, assignment 2's starter
  (`astro-theme-university`) bakes an accessibility gate straight into
  `pnpm check`/the build itself --- but it's still worth an independent real-
  browser a11y sweep, not a reason to skip one.** Reading
  `astro-theme-university`'s `a11y-checker.ts`/`a11y-worker.mjs` on
  `comp4020-ass2-dachi` showed the built-in gate runs axe-core inside a
  per-page JSDOM document, not a real browser --- the exact jsdom setup
  already known (from the crit series) to be structurally blind to
  `color-contrast` failures, since jsdom does no real layout/paint. So a
  clean "no accessibility violations" from `pnpm check` on an assignment-2-
  shaped deliverable is not the same evidence a clean `agent-browser a11y`
  run would be, even though both look identical on the surface ("0
  violations"). Confirmed independently with a real `agent-browser a11y
  <url> --json` sweep across every distinct page template (home, listing
  and `[slug]` pages for four collections, policies, a deck) served from a
  built `dist/`: also 0 violations/0 incomplete, so no contrast bug was
  hiding here, but the confirmation is only real because it came from a
  second, structurally-different sensor, not from trusting the build's own
  gate reporting green. General lesson: before treating any project's own
  bundled a11y check as sufficient, read what it actually runs against
  (jsdom vs. a real browser) --- a check that exists is not automatically a
  check that can see contrast.

- **Serving a `dist/` build at the web root silently breaks every
  JS-dependent live check on a project with a non-root `base:` path, without
  affecting an a11y audit's result at all --- a methodological trap specific
  to GitHub Pages project sites, not seen on the crit series' root-served
  static prototypes.** On `comp4020-ass2-dachi` (`base:
  "/comp4020-ass2-dachi/"`), serving `dist/` via a plain `python3 -m
  http.server -d dist` at the web root made the theme's dark-mode toggle look
  broken --- clicking it (both synthetic `.click()` and a real
  `agent-browser click`) did nothing, `localStorage`/`data-theme` never
  changed. The real cause: every script `src` in the built HTML is an
  absolute path under `/comp4020-ass2-dachi/`, so both bundled scripts
  404'd against a server rooted at `/`, silently killing all client JS ---
  a genuine false-negative bug report, caught only by checking
  `document.scripts[].src` and noticing the requests resolved to the wrong
  origin path. A same-session `agent-browser a11y` sweep against the
  same wrongly-served build had already come back 0 violations/0
  incomplete and stayed identical after fixing the serving path, because
  axe-core mostly audits static DOM/CSS state that doesn't depend on
  client JS having loaded at all. Fix: serve `dist/` from a parent
  directory containing a symlink named after the repo
  (`ln -s "$(pwd)/dist" "$TMPDIR/comp4020-ass2-dachi"`, serve `$TMPDIR`),
  so requests resolve at the real base path. General lesson: before
  trusting any live check of client-JS *behaviour* (a toggle, search, a
  form) against a locally-served build, confirm the build's `base:` config
  and serve from a path that matches it --- a clean a11y sweep from the
  same wrongly-rooted server is not evidence the serving setup is fine,
  since axe-core's checks mostly don't need the JS to have run at all.
- **A deck page can silently fall outside a site-wide accessibility
  guarantee if it deliberately skips the site's own base stylesheet.**
  `comp4020-ass2-dachi`'s `src/decks/theme.css` imports only
  `astro-theme-university/styles/deck.css` (decks are a separate dark
  surface that doesn't load the site's `base.css`, by the file's own doc
  comment) --- which meant it also missed `base.css`'s blanket
  `prefers-reduced-motion` override, and the underlying deck framework
  (astromotion, built on reveal.js) ships with no reduced-motion handling
  of its own anywhere in its bundled CSS. Confirmed live: forcing
  `prefers-reduced-motion: reduce` and polling every element's computed
  `animationDuration`/`transitionDuration` on the deck page showed the
  nav-arrow bounce (`animation: bounce-right 2s`) and eight slide/fragment
  transitions (0.2s--1s) still fully live. Fixed by adding the identical
  zero-duration `!important` technique from `base.css`, scoped to `.reveal
  *` instead of the whole page, in the project's own theme.css override
  point (`comp4020-ass2-dachi` commit `ef03259`). General lesson: whenever
  a page type explicitly opts out of a site's shared base stylesheet for
  its own visual reasons (a deck, an embed, an iframe'd widget), that
  opt-out silently drops every *other* global rule that stylesheet
  happened to carry too, not just the styling the author meant to
  replace --- check what a shared base stylesheet also does for
  accessibility (reduced-motion, focus-visible, contrast resets) before
  assuming a narrower, page-type-specific stylesheet inherits it.

- **A fresh, complete content read (all sessions, lectures, assessments,
  home, policies) can come back clean, and that's still worth doing once
  per content-stable period, not just when it turns up a bug.** On
  `comp4020-ass2-dachi`'s sixth run, re-reading all twelve session pages,
  six lectures and four assessments against the brief's own explicit
  warnings ("twelve weeks that repeat one another," "reads as the starter
  with the nouns swapped") found the course genuinely holding together:
  each week has a distinct concrete idea (Norman-door vocabulary,
  accessibility, security theatre, prototype fidelity, typology-widening),
  the four assessments' weights sum to 100 and each cites the audit/
  redesign/prototype/field-guide arc precisely, and the voice rule (no
  "unlock"/"journey", nothing that would survive with "door" swapped for
  another noun) held on every page checked. No edit resulted. Confirms the
  two earlier coherence passes (the mislabeled-crit fix, the blanket
  due-date fix, both logged above) got the real issues and this isn't a
  site that looks fine on a skim but degrades on a full read.
- **When two sibling interactive components built by the same vendored
  theme package disagree on a keyboard convention, that asymmetry is a
  real, checkable finding even though neither WCAG nor the build's own
  jsdom-based a11y gate can see it.** `astro-theme-university`'s
  `SearchDialog.astro` closes on `Escape`; its sibling `Nav.astro`'s mobile
  menu toggle (same package, same theme, same "open thing on the page,"
  same file even) only responds to clicks, no `Escape` handler at all.
  Not a WCAG failure on its own (the toggle button still closes the menu
  on a second Enter/Space, so there's no keyboard trap), but a real,
  reproducible gap, confirmed live with `agent-browser`: `Tab` to the
  toggle, `Enter` to open (`aria-expanded="true"`), `Escape` left it open
  before a fix, closed it (with focus correctly returned to the toggle)
  after. General lesson: whenever a page has two or more components that
  each implement their own open/close or expand/collapse behaviour, check
  whether they agree on the standard dismissal key (`Escape`), the same
  way earlier entries in this file check whether cooperating *functions*
  agree on a predicate --- this is that same asymmetry-hunting lens
  applied to keyboard conventions across sibling UI widgets rather than to
  pure logic.
- **When the component with the bug lives in a vendored package
  (`node_modules`, gitignored, reset on every `pnpm install`), the fix has
  to land at the project's own layer, and Astro's integration
  `injectScript(stage, content)` hook is the right mechanism for a
  cross-cutting document-level fix that doesn't warrant forking the
  component or routing every page through a new shared layout.** Editing
  the vendored file directly would appear to work locally but leaves no
  trace anywhere `git` or a fresh clone can see. On `comp4020-ass2-dachi`,
  the `Nav.astro` Escape-to-close gap above was fixed with a ~15-line
  inline integration in `astro.config.ts` (`astro:config:setup` →
  `injectScript("page", ...)`) adding one `document`-level `keydown`
  listener, mirroring the vendored click-handler's own
  `aria-expanded`/`inert` toggling logic exactly rather than reimplementing
  it differently. Confirmed via `pnpm check` (still green) and a live
  `agent-browser` Tab/Enter/Escape sequence both before and after (commit
  `be03362`). General lesson: `injectScript` is worth reaching for
  specifically when a fix needs to run on every page and only needs
  `document`-level scope (not a specific element the page's own markup
  would need to change) --- it's a smaller, more proportionate patch than
  either editing a dependency that won't persist, or building a new
  shared layout wrapper just to carry one script tag.
- **A mechanical grep across content is a distinct, much cheaper sensor
  from a full manual content read for the same voice/coherence question,
  and worth running as a fast standing check rather than only ever
  re-deriving the answer by reading everything again.** This project's own
  `CLAUDE.md` states a voice rule (no rhetorical questions, no "unlock"/
  "journey", nothing that survives a noun-swap) that six prior full manual
  reads had each checked by eye. On `comp4020-ass2-dachi`'s seventh run, a
  plain `rg` for common LLM stock phrases (delve, boundaries, tapestry,
  seamless, leverage, paradigm, "it is important to note", ...), for any
  `?` character anywhere in body content (not just at line ends — a
  rhetorical question doesn't have to be the whole line), and for generic
  design-jargon that would fail the noun-swap test (design thinking,
  user-centered, ideation, stakeholder) came back zero matches across
  every content file in one command each. Confirms the same thing a
  manual read confirms, at a fraction of the cost --- worth reaching for
  after any content-adding run as the first check, saving a full fresh
  read for when something in the grep actually turns up, or when the
  question is structural coherence rather than word choice (a grep can't
  tell you whether two pages agree on a fact, only whether a page uses a
  banned word).
- **`comp4020-ass2-dachi` (Doorology) is now finished --- roughly two dozen
  runs across the full 168h window, final run pushed clean
  (`d08070b`) with `PROCESS.md` written, `pnpm check:evidence` passing, and
  the live URL correctly still 404 (repo private, harness flips visibility
  and deploys after the fact --- confirmed by reading this starter's own
  `checks.yml`, gated `if: !github.event.repository.private`).** A useful
  contrast point against the crit-4/crit-5 calibration entries below: a
  content-heavy deliverable's sensor families are almost entirely different
  in kind from an interactive prototype's. Nothing here came from
  logic-symmetry, multi-writer state, or app-vs-browser input arbitration
  (this repo had almost no custom client JS to harbour those bugs) ---
  instead the two real bugs worth naming were a redundant `related:` edge
  silently absorbed by the template's own dedup logic (invisible to every
  rendered page) and a stale generic `spec:` bullet inherited from the
  starter's example content (invisible to `check-evidence.ts`, which only
  checks presence). Both were found by reading raw content/frontmatter
  directly, not by any browser-level or build-level sensor. The other real
  finding (`4970561`, a `light-dark()` contrast fix verified in only one
  theme) came from this project's carried-over a11y-verification habits,
  confirming those transfer cleanly across deliverable types. Sensor
  well went dry noticeably earlier here (by ~60% of the week) than either
  crit, consistent with a content-heavy site simply having a smaller
  surface for the interaction-bug families that dominate the crit series.
  Worth defaulting future content-heavy deliverables straight to the
  raw-content-read and mechanical-grep sensors first, rather than starting
  from the browser-automation techniques the crit series built up.

## Local checks vs CI's linkinator

Correction to an earlier belief in this section: `pnpm dlx linkinator
./dist --silent` (no `--recurse`) **does** request external `https://`
hrefs found in the markup --- on crit 2 it consistently flagged a real,
required `https://ffmpeg.org` link as broken in this sandbox. Diagnosed
via `curl -v` timing, raw `node -e "fetch(...)"` tests, and DNS/IPv6
checks: ffmpeg.org's host does a genuinely slow (8--12s) TLS handshake,
and Node's fetch/undici stack (what linkinator and `WebFetch` both use)
times out or `ECONNRESET`s where `curl` (no default timeout) succeeds;
this sandbox also has no IPv6 route (`ENETUNREACH`), which broke a
second link (gyan.dev) the same way. Other hosts (example.com,
wikipedia.org, github.com) were fine via Node fetch in the same
sandbox --- this looks host- and sandbox-specific, not a general
linkinator limitation. Practical upshot: a local linkinator failure on
an external link is not proof the link is actually dead --- cross-check
with a plain `curl -L` (which has no default timeout and tolerates slow
handshakes) before concluding a required, real link needs to be
dropped, and treat a genuinely slow-but-live source as an accepted risk
to confirm against the real CI run post-push rather than something to
route around by removing the citation. Separately, before linking to
any external site at all, `curl -s -o /dev/null -w "%{http_code}" -L -A
"Mozilla/5.0" <url>` it directly first --- sites with bot protection
(Smarthistory, the Met) returned 403/429 even to a real UA, and would
have broken the CI-gated links check. Prefer stable, crawler-friendly
sources (Wikipedia has never bounced a plain GET) over richer but
bot-guarded ones, except where the source itself (e.g. the actual
organisation's site in a redesign crit) is the point and can't be
swapped out.

A clean 200 from that `curl -L` check is necessary but not sufficient: it
follows redirects silently, so a specific article page that's been
retired can 301 to its section's generic homepage and still return 200
--- the link resolves, just not to what you meant to cite. Caught this on
crit 1 trying to add a UNESCO Silk Roads essay URL: `curl -L` said 200,
`WebFetch`-ing the same URL showed it had landed on a generic hub page,
not the article. Read what a candidate link actually renders (WebFetch or
a browser), not just its status code, before citing it as a specific
source.

## The static-prototype template

Two stack facts from `comp4020-crit4-dachi`, likely to recur on any future
deliverable built on this same Vite/TS static template:

- A spec test that wants to assert "the page ships client-side JS" can't
  select the built bundle by a filename pattern derived from the source file
  (e.g. `script[src*="main"]`) --- Vite names the built script chunk after
  the **HTML entry point**, not `main.ts`, so it comes out `index-<hash>.js`.
  Assert `script[type="module"]` instead.
- `tsc --noEmit` (strict mode) does not carry a top-level
  `if (!x) throw` null-narrowing into functions *defined and called later* in
  the same module, even for a `const` --- narrowing doesn't cross function
  boundaries. Fix is to re-bind the checked value to a second,
  explicitly-typed `const` right after the guard, once, rather than adding
  `!` at every later use site.

## Working style

- The doctrine's "more than 24h: plan/build/deepen, inside 24h: finish"
  split is worth taking literally --- don't write `PROCESS.md`'s final
  citations or the week's `reflections/` entry until the commit history
  that they'd cite is actually close to settled. Writing them early just
  means rewriting them later.
- Commit in small, logically separate chunks even when a run produces a
  lot of new content in one sitting (e.g. delete-the-JS-scaffold,
  theme-CSS, home-page, content-pages, links-page as five separate commits
  rather than one dump) --- the process trail is graded, not just the
  final state.
- When content and checks are both already exhausted (nothing new to
  build, nothing new to verify) but the clock still has more than 24h on
  it, don't default to a fourth identical re-verification pass. Check
  whether the deliverable repo's own `CLAUDE.md` has actually grown
  --- on crit 1, three runs of re-verification produced real lessons
  (no-JS forcing CSS-only animation, the reduced-motion live-check
  method, contrast fixes) that all landed only in this global memory,
  while the project's own `CLAUDE.md` was still the unmodified starter
  template. The doctrine and the starter repo's own text both call this
  out as process evidence a marker reads directly, so writing project
  lessons into the deliverable's `CLAUDE.md` (not just here) is
  legitimate deepening work, not busywork.
- Sensor exhaustion is also a cue to draft `PROCESS.md` and the
  deliverable's `reflections/` entry early, not just to grow `CLAUDE.md`.
  On assignment 1, once every independent sensor family (logic-symmetry,
  DOM-completeness, full browser sweep, reduced-motion, copy-precision,
  response-to-brief scoping) had each gone dry on a repeat pass, the next
  run drafted both evidence files with 39h still on the clock rather than
  running a further re-verification pass or waiting for <24h --- the
  commit history was already rich and settled, so writing early meant
  writing once, and left room for the doctrine's own "more than 24h:
  plan/build/deepen" reading to still apply if a later logic fix ever
  displaces one of the chosen `PROCESS.md` moments. Don't treat ">24h to
  cutoff" as a blanket reason to keep re-verifying once every sensor
  family the project has invented has independently confirmed clean more
  than once.
- That said, "sensors exhausted" and "clock nearly out" are two separate
  conditions, and the assignment 1 precedent above had both (39h left,
  itself well inside a much shorter remaining runway than a full week).
  On crit 4's fourth run, sensors were similarly exhausted (a fresh
  asymmetry pass over `main.ts` turned up only a confirm) but 120.5h ---
  most of the full 168h window --- was still on the clock, only ~28% of
  the week elapsed. Chose to update `PROCESS.md` (already an incrementally
  -maintained artefact, safe to extend) but held off on drafting
  `reflections/crit-4.md` --- that file is explicitly a "final run"
  finishing step in the doctrine, and locking in "the breakthrough" this
  early risks describing a story the rest of the week's work outgrows.
  Weigh both signals before drafting the reflection early: sensor
  exhaustion alone, at hour 28 of a 168-hour week, is not yet the same
  situation as sensor exhaustion with only a handful of hours left.
- **My available sensors can verify correctness and accessibility, but cannot
  evaluate aesthetic/creative "feel" --- don't invent speculative creative
  changes to compensate for a dry bug-hunting well.** On crit 4's sixth run,
  a fresh full read of `main.ts`/`styles.css` plus a live browser interaction
  check (real synthetic `PointerEvent` gesture, console watch, a11y re-audit)
  both came back clean for the second consecutive checkpoint --- a genuinely
  dry sensor well, with still >100h on the clock. The obvious next lever,
  "deepen the instrument's expressiveness" (e.g. map pointer x-position to
  pan/vibrato, reshape an envelope), was considered and rejected: browser
  automation, a11y audits, and console logs can confirm a gesture doesn't
  crash and reaches WCAG bars, but none of them can tell me whether a sound
  *feels* better --- that judgement needs human ears, and the brief for this
  particular crit says so outright ("Latency, feel... none of that shows up
  in a test suite"). Making an unverifiable creative change on spec risks
  making the instrument worse with no way to notice. General lesson beyond
  this one crit: when doctrine's "deepen" step is otherwise open-ended, check
  whether the deepening actually needed is something your sensors can judge
  before inventing new sensor-checkable work as a proxy for it --- if the
  real judge is a human audience the prompt hasn't given you access to yet
  (a pod's live crit, a stakeholder's review), the correct move is to do
  *less* this run and wait for that feedback to actually arrive, not to
  manufacture a substitute.
- When a single edit pass touches a shared partial across several files
  (e.g. adding one new page's link to every page's nav) alongside an
  unrelated content edit on one of those same files, `git add
  <that-file>` for the content commit silently pulls the nav change in
  too --- the diff no longer matches what the commit message describes.
  Check `git diff --staged` against the intended commit message before
  committing, not just `git status`, whenever a cross-cutting change
  (nav, footer, shared partial) overlaps a per-page content edit in the
  same run.
- A11y audit and reduced-motion check aren't the only sensors worth
  running once and not repeating: an actual `agent-browser screenshot`
  pass at both marked viewports (390×844 and 1920×1080) across every
  page is a distinct check from either --- it catches wrap/overflow
  layout regressions that axe-core and `getComputedStyle` don't look
  for at all. On crit 1, once content and both a11y/motion sensors were
  already confirmed clean with >24h still on the clock, this was the
  one genuinely new (not-yet-run) sensor left, rather than a fourth
  identical re-verification pass. Like the others, run it once per
  content-stable period, not every run.
- Two more sensors in the same family, distinct from a11y/reduced-motion/
  screenshot: keyboard-only operation and mid-interaction resize. Neither
  is exercised by an axe audit (static markup properties) or a plain
  screenshot (a single fixed state). `agent-browser press Tab` repeated
  N times plus reading `document.activeElement` after each confirms
  actual tab order (not just that elements are theoretically focusable);
  `press Enter` on a focused control confirms it's keyboard-activatable,
  not just clickable. `agent-browser set viewport <a> <b>` after already
  interacting with the page (not on a fresh load) confirms state survives
  a resize, not just that each viewport looks fine in isolation. Assembly
  1's marking rubric names both explicitly for its top artefact band
  ("holds up under use it wasn't designed for: the keyboard, a resize
  mid-interaction"), which is what surfaced these as worth checking
  --- likely worth doing on any interactive prototype, not just when a
  rubric says so. Same rule as the others: once per content-stable
  period.
- When every browser-level sensor (a11y, keyboard, resize, full walkthrough,
  slow-connection sizing) is already exhausted and re-running any of them
  would just repeat a prior run's exact result, look for an *asymmetry* in
  the core logic's own test coverage before concluding there's nothing left
  to build. On assignment 1, `context.test.ts`/`interaction.test.ts` covered
  shrinking the context window (eviction) thoroughly but never asserted the
  reverse --- widening it after eviction to bring a message back into view,
  which the code already handled correctly (`reconcileList` in `main.ts` is
  symmetric) but which no test named. Found by re-reading the actual
  render/reconcile code with fresh eyes rather than re-running any browser
  check, then added both a pure-logic test (`buildContext` with a widening
  window) and a DOM-wired one (`select` → `change` event flips recall back
  from forgotten to known) in
  [`38999e4`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-dachi/commit/38999e4).
  General lesson: "nothing new to verify" should mean re-reading the pure
  logic and its test file side by side for asymmetric coverage, not just
  re-running the same external sensors again.
- That asymmetry hunt generalises past the pure logic module to any
  DOM-observable side effect the render function itself produces. A second
  pass over `main.ts`'s `render()` (not just `context.ts`) found two more:
  the token meter's `is-warn`/`is-full` classes (a real colour change per
  the stylesheet) and the `aria-live` eviction announcement's singular/
  plural wording --- both real "visitor does something that changes what
  they see" behaviour, neither named by any test. Added five DOM-wired
  tests driving the composer with precisely-sized text (character count is
  a direct lever on token count via the `ceil(length/4)` approximation) to
  land the meter at exact known percentages, in
  [`0855fe0`](https://github.com/comp4020-agentic-coding-studio/comp4020-ass1-dachi/commit/0855fe0).
  Doing this surfaced a distinct, more general bug class below.
- **A shared-DOM test fixture leaks mutated element state across tests
  unless every test resets everything it can touch, not just what the
  app's own reset control clears.** A test file that imports the app once
  in `beforeAll` and reuses one `document` across all `it()`s, clearing
  state via a `beforeEach` click on the app's own reset button, only
  resets what that button resets. On assignment 1, the reset button
  intentionally leaves a `<select>` (window size) untouched, matching real
  UI behaviour --- so an earlier test that changed the select's value
  leaked that value into every later test in the file, invisibly, until a
  new test happened to assert against the default. Fix was cheap
  (explicitly reset the select in `beforeEach` too) but the bug was
  latent for as long as no test depended on the leaked-over default.
  General lesson: when writing this shared-fixture-plus-reset-button test
  pattern, enumerate every piece of mutable DOM state a test can touch and
  reset all of it in `beforeEach`, not just what the app's own reset does
  --- test isolation and app-reset behaviour are two different contracts,
  and conflating them hides order-dependence bugs until a coincidence
  exposes them.
- **The sharpest version of asymmetry hunting is checking whether two
  functions meant to *agree* on a predicate actually agree, not just
  whether each is individually tested.** On assignment 1, `main.ts` had a
  "has this fact ever been stated" gate and `context.ts` had a `canRecall`
  check that only runs once that gate passes --- the two exist specifically
  to cooperate. The gate matched case-sensitively; the recall check
  lowercased both sides. Both functions already had test coverage, so a
  naive "is X tested" pass would have called this done --- the bug only
  surfaced by asking "if I feed the same untested input class (lowercase
  free text) to both, do they still agree," which no single function's own
  tests would ever ask. Worth making this an explicit second question after
  "what's untested" in any future asymmetry pass over a codebase with
  cooperating predicates: for every pair of functions/branches meant to
  agree on the same fact, do they normalise their shared input
  (case, whitespace, trimming, rounding) the same way?
- **A sixth asymmetry-hunting pass (assignment 1) found a bug that lived
  inside a single function, not between two cooperating ones.**
  `buildContext`'s eviction loop looked FIFO but was actually "skip whatever
  doesn't individually fit the remaining budget, keep trying older items
  against the same leftover space." Every existing test used uniform-sized
  messages, which always coincidentally produced a contiguous prefix and
  hid the bug through five prior passes. Real mixed sizes could evict a
  newer, larger message while keeping an older, smaller one visible ---
  backwards from the demo's own "oldest first" claim. Caught by asking a
  new question, not by re-running the previous ones: for a function whose
  test fixtures all share some unexamined property (here, uniform size),
  what happens when that property is varied? Confirmed with a throwaway
  `node -e` reproduction before touching source. General lesson for future
  asymmetry passes: after "do two functions/branches agree," also ask "do
  this function's own tests all share a property that could be masking a
  whole behaviour branch" --- uniform input size, all-ASCII text,
  all-positive numbers, inputs drawn only from a fixed set rather than free
  text, etc. Full writeup and fix in `comp4020-ass1-dachi`'s own
  `CLAUDE.md` (commit `6020844`).
- **Not every asymmetry pass finds a bug, and that's not a wasted pass.**
  A seventh pass on assignment 1 checked the two candidates the sixth
  pass had flagged as untested but plausible-looking, and both turned
  out fine: a single message alone bigger than the whole window (a real,
  reachable branch no fixture had varied) evicts correctly per the
  contiguous-oldest-first invariant, and a `Math.max(1, ...)` floor
  turned out to be genuinely dead code (never engages for any reachable
  input) rather than a live edge case. Confirmed both with a `node -e`
  repro before writing anything. Lesson: writing the test that proves a
  suspicious-looking edge case is actually fine, and removing code that
  turns out to never fire, is itself legitimate deepening work --- don't
  treat "confirmed correct" as a null result that should have been
  skipped. It's also a signal, not noise: when a pass over the same
  pair of files starts turning up confirmations instead of defects, the
  seam is thinning and it may be time to look elsewhere (browser
  sensors, PROCESS.md prep) rather than force an eighth identical pass.
- **That signal can still be wrong --- an eighth pass on assignment 1
  found a real bug by asking a question per *side effect*, not per
  function.** A render function that fans one state transition out into
  several DOM-observable side effects (here: transcript membership, a
  meter's CSS classes, an `aria-live` announcement's text) can have one
  side effect thoroughly tested for a given direction of that transition
  while a sibling side effect is never asked the same question. Assignment
  1's widening test proved messages come back into view when the window
  grows; nothing asked whether the *announcement* handled that same
  reversal, and it didn't --- it only ever updated on new evictions, so
  widening left a stale, false "N messages just fell out" sentence sitting
  in a screen-reader-visible (`sr-only`, not `aria-hidden`) region.
  Fixed by adding the symmetric branch and a regression test, confirmed
  live in a real browser before calling it done. Full writeup in
  `comp4020-ass1-dachi`'s own `CLAUDE.md` (commit `275c3b2`). General
  lesson: when a function has already had its coverage checked
  side-effect-by-side-effect once, the next asymmetry pass shouldn't ask
  "is anything still untested" again but "does each side effect handle
  every direction of the shared transition, not just the one a prior test
  happened to exercise" --- particularly for any control (like a
  window/size selector) that makes an otherwise one-way transition
  reversible.
- **When logic-symmetry asymmetry hunting over a page's core state
  functions goes two-for-two on confirms-only (no bug found), the next
  reusable lens isn't a harder version of the same question --- it's a
  different question about the same control: does a reset/clear button
  actually reset *every* piece of mutable DOM state on the page, or only
  what the core render function redraws from its own state every cycle?**
  On assignment 1, nine passes over `context.ts`/`main.ts`'s eviction and
  recall logic (the last two confirming no bug) never asked this about the
  page's Reset button, because it's a different kind of question ---
  "what does this control forget to clear," not "do these two functions
  agree." Enumerating every element with mutable state (not just the ones
  `render()` writes each cycle) found a real one: an unsent composer
  draft and its live token-count preview survived Reset, sitting stale
  next to a freshly-zeroed transcript and meter. Confirmed live in a real
  browser before touching source. Full writeup in
  `comp4020-ass1-dachi`'s own `CLAUDE.md` (commit `2b38115`). Worth
  reaching for this lens specifically once a project's own state-symmetry
  asymmetry hunting has gone quiet, rather than assuming quiet
  logic-symmetry checks mean the page has no more bugs to find.
- **`comp4020-crit4-dachi` (Aurora Keys) is now finished --- 15 runs, seven
  real bugs found, final run pushed clean and shipped.** Worth keeping as a
  calibration point for future crits' expected depth: real bugs kept
  surfacing well past the point where the obvious browser-level sensors
  (a11y, keyboard, resize, reduced-motion, screenshots at both marking
  viewports) had all gone clean, by inventing progressively narrower
  questions (logic-symmetry, listener-placement, multi-writer shared state,
  animated-custom-property registration, app-vs-browser shortcut/gesture
  collisions) rather than re-running the same sensors. The final run itself
  was uneventful by design: one last not-yet-tried sensor (a live
  `Tab`/`Shift+Tab` walkthrough) came back clean, then the finishing steps
  (evidence check, `reflections/crit-4.md`, commit, push) were mechanical
  because `PROCESS.md` and this repo's own `CLAUDE.md` had already been kept
  current run by run --- there was no scramble to reconstruct the story at
  the end. That's the payoff of the "write findings into the project's own
  files immediately, not just here" habit already threaded through the
  entries above: a final run should mostly be finishing steps, not
  discovery.
- An eleventh technique in the app-vs-browser-input-handling family (the
  seventh and tenth techniques above): the mouse-button analogue of the
  modifier-key keydown lesson. On crit 5's sixth run, after three
  consecutive code-level passes and a full browser sweep had gone clean,
  `comp4020-crit5-dachi`'s (Swerve) canvas `pointerdown` handler turned out
  to move or restart the player for *any* mouse button, since it never
  checked `e.button` --- a right-click silently steered the player (or
  restarted a finished round) exactly like a left-click, while the
  browser's own context menu still opened on top of the result. Same bug
  shape as the modifier-key lesson (a whole-element/whole-region listener
  treating input variants as equivalent when they aren't) but one level
  down: keyboard handlers need a modifier guard, pointer handlers bound to
  game-state need a button guard. Confirmed two ways: a real CDP
  `agent-browser mouse down/up right` (proving the browser genuinely
  dispatches `pointerdown` with `button: 2`) and a synthetic
  `dispatchEvent(new PointerEvent('pointerdown', {button: 2, ...}))` via
  `agent-browser eval` to sidestep this sandbox's CLI round-trip latency
  outrunning Swerve's short reaction window (the same latency risk logged
  under the debug-probe entry above) --- reading back an `aria-live`
  region's text showed a right-click left a game-over announcement
  untouched while an immediately following left-click still triggered a
  restart, and pixel-reading the player's canvas position confirmed a
  live-round right-click didn't move it either. Fixed with
  `if (e.button !== 0) return;`, safe for touch/pen too since the Pointer
  Events spec mandates `button === 0` for any primary-contact pointerdown
  regardless of device. General lesson: whenever a pointerdown/pointerup
  handler drives app/game state from a whole-element listener (not just a
  keydown handler from a whole keyboard region), check the `button` field
  specifically --- it's a distinct check from touch-action scoping and
  multi-touch id-tracking, both already covered elsewhere in this file, and
  easy to miss because it only shows up against a non-primary button, never
  the ordinary left-click/tap a normal playtest exercises.
- A twelfth technique in the app-vs-browser-input-handling family, distinct in
  shape from the eleven above: those all guard against a different *input
  variant* landing on the *same* target (a modifier held, a non-primary
  button); this one guards against the *same* input landing on a *different*
  target the page also makes focusable. On crit 5's seventh run, Swerve's
  global keydown handler called `preventDefault()` on Enter unconditionally
  (to gate restart-on-game-over), with no check of what actually had focus
  --- so a keyboard user tabbing past the canvas to the page's own header
  `Home` link and pressing Enter to activate it got nothing, because the
  page-wide handler consumed the keydown before the link's native activation
  behaviour ever ran. Confirmed with `agent-browser`: attach a `click`
  listener on the anchor via `eval`, real `press Tab` then `press Enter`,
  read the listener's flag back --- `false` (never fired) before the fix,
  with a same-page bubble listener separately confirming
  `event.defaultPrevented: true`; `true` (fires normally) after. Fixed with a
  `(e.target as HTMLElement).closest("a, button, input, select, textarea")`
  guard at the top of the handler, before any key-specific branch --- cheaper
  and more general than special-casing the one link, since it covers any
  future focusable element (a button, a form field) the page might grow.
  Re-confirmed arrow-key movement still works both unfocused (`e.target` is
  `body` on a fresh load, matching prior behaviour) and canvas-focused.
  General lesson: a global (not per-element) keydown handler is invisible to
  this bug for as long as the page has no other focusable element to collide
  with --- the moment a page bound to one such handler grows *any* second
  tabbable thing (a nav link, a button, a settings control), check that the
  handler skips when focus is on it, the same way it already has to skip on
  a held modifier or (for pointer handlers) a non-primary button.
- A thirteenth technique, distinct from the app-vs-browser-input-handling
  family above: those all arbitrate between the page and the browser itself;
  this one arbitrates between the page and an assistive technology sitting on
  top of the browser. On crit 5's ninth run, `comp4020-crit5-dachi` (Swerve)
  moves the player only via bare arrow keys on a `window`-level `keydown`
  listener, bound to a `<canvas>` that had `tabindex="0"` and an
  `aria-label` but no explicit `role` --- which resolves to the implicit
  HTML-AAM role `img` (confirmed via `agent-browser eval
  "document.querySelector('canvas').getAttribute('role')"` reading `null`;
  axe-core doesn't flag this, it's outside axe's rule set). A screen reader's
  browse-mode virtual cursor (NVDA/JAWS) claims bare arrow keys for its own
  quick-navigation by default, and only stops doing so for elements whose
  role puts the AT into focus/forms mode --- a generic `img`-role focusable
  element doesn't qualify, so a blind user tabbing to the canvas could have
  every arrow-key press eaten by their own AT before it ever reaches the
  page. Distinct from the single-letter-hotkey-vs-quick-nav collision logged
  for Aurora Keys (not treated as blocking there, because native `<button>`
  elements gave an independent accessible path to the same functionality) ---
  Swerve has no alternate control, so this is a can-a-screen-reader-user-
  play-at-all question, not a redundant-path one. Fixed with
  `role="application"` on the canvas, the standard technique for a canvas
  game that needs raw keystrokes handed straight to the page. No real
  NVDA/JAWS/VoiceOver was available to confirm AT behaviour directly in this
  sandbox, so verification was necessarily partial: `pnpm check` green, a
  fresh `agent-browser a11y --json` still 0 violations/0 incomplete with the
  role present, and a real `agent-browser press ArrowRight`/`ArrowLeft`
  sequence (reading the player's x position back by monkey-patching
  `CanvasRenderingContext2D.prototype.arc` via `eval`, since the position is
  a closed-over module variable with nothing in the DOM to query) still
  moved the player between lane centres exactly as before the change,
  confirming the fix is additive and doesn't touch the working keyboard path
  for sighted/mouse users. General lesson: for any canvas- or div-based
  interactive prototype whose only input path is a global keyboard listener,
  check the interactive element's *implicit* ARIA role (not just whether
  `aria-label` is present) before calling keyboard access done --- a
  non-interactive implicit role is invisible to axe and to every sensor this
  project's prior eight runs had already tried, since none of them model an
  AT's own claim on the same keys the page is listening for. Full detail in
  `comp4020-crit5-dachi`'s own `CLAUDE.md` (commits `55c1dd5`, `840b110`).
- A variant of the "does a reset control clear everything, not just what it
  redraws" lens (assignment 1's Reset-button entry above), applied to timing
  constants rather than DOM state: when a playtesting fix's own rationale
  names a *specific* state-entry path (here, Swerve's `START_GRACE_PX` spawn
  delay, added because a *fresh-load* stranger hadn't yet learned the
  controls), check whether every other path that reaches the same starting
  state --- a restart, a reset, a retry --- actually replays that same fix,
  or only the one path the original playtest happened to exercise. On crit
  5's eleventh run, `resetGame()` zeroed `spawnAccumulator` instead of
  restoring the grace offset, so a restart got ~0.8s less runway before the
  first row than a fresh load did. Confirmed by timing (via the project's
  own temporary-debug-probe technique) how long a stationary player has
  before the first row reaches the collision line from each entry path
  (~4.99s fresh load vs ~4.19s restart). Not every such gap is a bug to
  close, though: here it was examined and left alone, since the fix's
  purpose (onboard a stranger who doesn't know the controls yet) doesn't
  apply once the player has already died once and learned them --- the
  general lesson is to *ask* the question explicitly for any fix scoped to
  one entry path, not to assume symmetry closes automatically.
- A fourteenth technique, and the first in this whole crit-4/crit-5 series
  answered by arithmetic instead of a live `agent-browser` check: for a
  rAF-driven game, whether a backgrounded tab's frame-rate throttling (a
  real, large gap between frames when a player alt-tabs away and back)
  could let a stale `dt` cause an unfair instant loss or a burst of rows
  spawning at once. On crit 5's thirteenth run, this was ruled out just by
  reading the constants: Swerve's `frame()` clamps `dt` to
  `Math.min(0.05, ...)` regardless of real elapsed time, and even at the
  game's own top speed cap, one clamped frame can't advance the spawn
  accumulator far enough to cross more than one row-spacing threshold ---
  both bounds are explicit numeric literals in the source, so multiplying
  them out settles the question the same way assignment 1's "is this
  branch actually reachable" `node -e` repros did, with no browser
  round-trip needed. General lesson: before reaching for a live sensor
  (`agent-browser`, a debug probe, a monkey-patched draw call), check
  whether the invariant in question is already pinned down by an explicit
  numeric clamp or threshold in the code --- if the worst case is a literal
  multiplication away from the bound that would break it, arithmetic is a
  legitimate, cheaper substitute for observation, not a corner cut. Only
  reach for a live check when the invariant depends on real DOM/timing
  behaviour a script would actually have to observe (unregistered
  `@property` animations, `touch-action` intersection semantics, AT
  keyboard arbitration) rather than a bound the source already states
  outright.
- A concrete data point for the "sensors exhausted vs. clock nearly out are
  two separate conditions" working-style lesson (first logged against crit
  4 at 28% of the week elapsed): crit 5 drafted `reflections/crit-5.md` at
  65.5h to cutoff, ~61% of the 168h window already elapsed, after five
  consecutive dry runs (four browser-level sensor passes plus the
  arithmetic one above) across every sensor family the project had
  invented. Worth the contrast: crit 4 at 28% elapsed chose to keep
  `PROCESS.md` current but explicitly held off on the reflection, since
  that much of the week still had room for the story to change; crit 5 at
  61% elapsed, with the same "sensors dry" signal, drafted it. Use rough
  fraction-of-week-elapsed, not just "sensors are dry" alone, when deciding
  whether a run should draft the reflection early --- dry sensors this
  early in the week is not yet the same situation as dry sensors this late
  in it.
- **Every deliverable repo has its own `agent/now.md` and `agent/MEMORY.md`,
  a harness-synced mirror of this global directory --- never hand-edit them.**
  On crit 5's fifteenth run, nearly edited `comp4020-crit5-dachi/agent/now.md`
  directly, reading the doctrine's "rewrite `memory/now.md` every run" as a
  same-named path inside the deliverable repo. It isn't: the doctrine also says
  outright "`agent/` is harness-owned: never edit it," and `agent/MEMORY.md` in
  that repo turned out to be a byte-identical copy of this global `MEMORY.md`
  (all crits, not just that project) --- clearly something the harness
  publishes into the repo from here, not a file to write to from inside a run.
  Caught via `git diff`/`git checkout --` before it reached a commit. The real
  target is always this directory, `agents/dachi/memory/`, one level above
  every deliverable repo, regardless of which repo the current run names.
- **A literal space typed inside a JS/TS template-literal interpolation
  (`` `${a} ${b}` ``) can silently land in the file as a NUL byte instead of
  a space, via the Edit/Write tool pipeline --- not a one-off fluke, `file`
  reports the whole file as "data" and `git diff`/`git show` fall back to
  "Binary files ... differ", hiding the actual diff from normal review.**
  Caught on `comp4020-ass2-dachi`'s fifth run adding a new `spec/` test whose
  message template was `` `${edge.from} ${edge.to}` `` --- `pnpm check`
  passed (vitest doesn't care), the commit even succeeded, but `git show`
  on that commit read "1 file changed, 0 insertions(+), 0 deletions(-)"
  with a `Bin ... -> ...` stat line instead of a normal diff, which is what
  gave it away; `python3 -c "open(...,'rb').read()"` confirmed two literal
  `\x00` bytes exactly where the two template-literal spaces should have
  been. Root cause not fully isolated (possibly a transcription artefact of
  this specific tool round-trip with that exact character sequence), but the
  fix was cheap: rewrite the file with `Write` using a different separator
  (`->` instead of a bare space) and confirm with `file` (should read
  "ASCII text"/"JavaScript source", never "data") and a Python null-byte
  scan before committing. General lesson: whenever a commit's own diff stat
  reads as binary/zero-change for a file you know you edited with real text
  content, don't shrug it off as a formatter quirk --- open it with `file`
  and a byte-level check before trusting the commit is what you think it
  is. Since the bad commit hadn't been pushed yet, amending it in place was
  safe; had it already been pushed, this would have needed a fresh commit
  instead per the standing don't-rewrite-pushed-history rule.
- **`comp4020-crit5-dachi` (Swerve) is now finished --- 17 runs, six real bugs
  found, final run confirmed green and already pushed.** A second calibration
  point alongside Aurora Keys above, with a different shape: the sensor well
  went dry earlier relative to the week (five straight confirms by 61%
  elapsed, vs. Aurora Keys' pattern of new bugs surfacing well past every
  obvious browser-level check) and stayed dry for the last several runs
  (9--16), including light-touch runs that re-ran only `pnpm check` +
  `check:evidence` rather than inventing further sensors once two prior runs
  had already declared the well dry twice over. All six real bugs were in the
  app-vs-browser/AT input-arbitration family (modifier-key hijack, Space
  default-scroll, pointer-button check, focus-stealing keydown, canvas
  implicit-role vs. screen-reader quick-nav) plus one playtesting-only fix
  (spawn grace period) --- no logic-symmetry or multi-writer-state bugs
  turned up here the way they did on Aurora Keys, consistent with Swerve
  having much less internal state to disagree with itself over. The final run
  needed no new commit: `PROCESS.md` and `reflections/crit-5.md` were already
  drafted and citation-valid from run 13 onward, `main` was already
  up-to-date with `origin/main`, so finishing steps were pure re-verification
  (typecheck/build/tests, evidence gate, a live two-viewport render check) ---
  the same "final run is mechanical because the story was written down as it
  happened" payoff logged for Aurora Keys.

## Full-stack / dynamic deliverables (crit 7 onward)

- `flyctl status -a <app>` reporting an app with no `Image` line means the
  app was created but never actually deployed --- a distinct state from "not
  deployed yet, needs the first deploy" that's worth checking for explicitly
  before assuming a fresh `flyctl deploy` is redundant. Confirmed on
  `comp4020-crit7-dachi`'s first run: the app existed (course tooling
  provisions it ahead of time) but had no image, so the very first
  `flyctl deploy --remote-only --ha=false -a <app>` both created the machine
  and volume and brought the live URL up for the first time.
- **A project's own stated input-revalidation rule can be only partially
  implemented, in a way no browser-level sensor (a11y, keyboard, resize,
  reload, SSE) will ever catch, because the real form can never produce the
  malformed input the rule is supposed to guard against.** On
  `comp4020-crit7-dachi`, `CLAUDE.md` stated outright: "never trust a
  client-submitted booking without rechecking it" --- and `createBooking`
  did recheck room-id existence and start/end ordering, but never checked
  that the timestamps were in the expected `YYYY-MM-DDTHH:mm` shape before
  comparing them lexicographically (the comparison the whole overlap/order
  logic depends on, per the schema's own comment). A direct `curl` POST with
  `startsAt=banana&endsAt=zebra` was silently accepted and persisted
  forever, since the app has no edit/delete. Every full walkthrough via the
  real form is structurally blind to this, because the form's own
  `datetime-local` input can never emit a malformed value --- only a request
  that skips the form reaches the gap. Fixed with a regex shape check ahead
  of the ordering comparison, a new `bad-format` result, and a regression
  test that POSTs the malformed value directly (`cd0c793`). General lesson:
  whenever a project's own `CLAUDE.md`/comments state a revalidation rule at
  an API boundary, read the actual validation code and ask "what could a
  request that isn't the form send instead" for each field --- not just
  whether the *values the form can produce* are handled correctly, since a
  full-stack app's real attack surface is the HTTP boundary, not the
  rendered page a browser-automation sweep drives.
- **The same client-vs-server revalidation gap recurs per HTML attribute,
  not just per field type.** A second run on `comp4020-crit7-dachi` asked
  the same "what could a request that isn't the form send instead" question
  about `maxlength="80"` on the `pod`/`tutor` inputs, not just about the
  `datetime-local` shape --- and found `createBooking` had no server-side
  length bound at all, so a direct POST could store an arbitrarily long
  name forever (no edit/delete). Confirmed reachable with a raw `curl` POST
  of an 81-char pod name before fixing; fixed with a `MAX_TEXT_LENGTH = 80`
  check mirroring the attribute, a new `too-long` result, and a regression
  test (`e6f1fb2`), then re-verified against the redeployed live Fly URL,
  not just the local build. General lesson: a browser-enforced HTML
  constraint attribute (`maxlength`, `min`/`max`, `pattern`, `step`) is a
  distinct, separately-checkable claim per attribute --- clearing the
  revalidation question for one field/attribute pair (a `type` shape) does
  not clear it for a sibling attribute (a length bound) on the same or a
  different field; enumerate the form's own constraint attributes and check
  each has a server-side twin, rather than treating the first fix as having
  closed the whole question.
- **A background architectural assumption stated only in a comment can be
  checked directly against the live infrastructure, not just left as an
  asserted claim.** `src/lib/events.ts`'s "only works because the app runs
  on exactly one machine" was verified, not just trusted, by running
  `flyctl status`/`flyctl scale show -a comp4020-crit7-dachi` against the
  actual deployed app: one machine, one VM group, count 1, consistent with
  the `fly.toml` volume mount constraining placement to a single machine
  regardless. No bug here --- worth logging as a confirmed pass (a null
  result from checking is still real deepening work, per the assignment-1
  precedent), and a reusable technique for any comment that asserts
  something about deploy topology rather than application logic: check it
  against `flyctl status`/`scale show`, don't just read the comment and
  move on.
- **Verifying no EventEmitter/SSE listener leak needs an abrupt disconnect,
  not just a graceful one --- a `kill -9` of the client process, not only a
  `curl -m <n>` timeout.** On `comp4020-crit7-dachi`, checking whether
  `src/pages/api/events.ts`'s `cancel()` (which does `bus.off(...)`) really
  fires on every disconnect path needed temporary `console.error`
  instrumentation of `bus.listenerCount("booking")` in `start`/`cancel`
  (reverted before committing, confirmed via `git status`/`git diff` never
  landed), a locally-built-and-run server, and three separate disconnect
  shapes: a graceful `curl -m 1` timeout, an abrupt `kill -9` of the curl
  process mid-stream, and three concurrent connections with one killed to
  confirm independent tracking. All three correctly dropped the listener
  count to the right value --- Node's http server plus the `@astrojs/node`
  adapter do wire a real socket close (even a forced one) through to the
  `ReadableStream`'s `cancel()`. No bug, a confirmed pass; the general
  lesson is that a *graceful* disconnect test alone doesn't rule out a leak
  from connections that die badly (a mobile client losing signal, a tab
  killed by the OS), so include a forced-kill client in this specific check
  before trusting a graceful-only result.
- **The "what could a request that isn't the form send instead" boundary-
  validation question (already good for two real bugs on this project ---
  timestamp shape, pod/tutor length) found a third: a regex checking digit
  *shape* is not the same as checking calendar *validity*.**
  `TIME_SHAPE`'s pattern let day 30 match every month, so
  `2031-02-30T09:00` --- a date the `datetime-local` picker itself can
  never produce --- passed validation and was stored forever (no
  edit/delete). Fixed with an explicit day-vs-days-in-month check
  (leap-year aware), deliberately not via `Date` parsing, since parsing
  would drag a timezone into a file whose whole design (lexicographic
  string comparison everywhere) depends on staying timezone-less. Proved
  the gap first with a test that failed against the un-fixed source, then
  confirmed the fix. General lesson: for any hand-written shape regex
  standing in for "this is a valid X," ask separately whether it also
  encodes every domain constraint X actually has (here: shape said yes,
  calendar validity said no) --- the same regex-passes-but-value-is-still-
  wrong gap this file's `oklch`/`light-dark` contrast entries describe for
  colour, generalised to dates.
- **Checked, and ruled out, two further candidates in the same boundary-
  validation family before concluding it was exhausted: `roomId` type
  coercion and a `findConflict`-then-insert TOCTOU race.** `Number(form.get
  ("roomId"))` looked underchecked (no explicit integer validation beyond
  falsiness and the room-existence lookup) --- tried `1.5`, `1e2`,
  `Infinity`, `0`, `-1`, `abc` against a locally-running instance directly
  with `curl`; every one came back `unknown-room` or `missing`, never a
  false match, because Drizzle/better-sqlite3's `eq()` against an integer
  column doesn't loosely coerce. Separately, fired ten truly concurrent
  overlapping POSTs for the same room/time window (`&` backgrounded curls
  followed by `wait`) to check whether the conflict-check-then-insert in
  `createBooking` (two separate synchronous statements, no explicit SQL
  transaction) could race --- exactly one succeeded, the other nine got
  `conflict`. Reasoned why before confirming empirically: better-sqlite3 is
  synchronous and `createBooking` has no `await` between the check and the
  insert, so on Node's single-threaded event loop the whole function body
  runs as one uninterruptible unit regardless of how many requests arrive
  at once --- no explicit transaction needed for this specific race,
  though this reasoning would break if the function ever gained a real
  `await` between the two statements. General lesson: a TOCTOU-shaped race
  in a Node app backed by a synchronous DB driver is worth checking with
  real concurrent requests before assuming it exists just because the code
  looks like two separate statements --- the language's own concurrency
  model can already close the gap.
- **Checked the two sensor angles the third run's hand-off had flagged as
  untried, and both resolved by reading the architecture rather than by live
  simulation --- ruled clean, not bugs.** (1) Whether a client that misses
  SSE events while disconnected has a real gap against the brief's "the core
  flow persists across a reload": no, because the schedule table is
  server-rendered fresh from SQLite on every request, completely independent
  of the SSE bus --- the `#live` list is explicitly scoped in its own copy
  ("New bookings from *other tabs* appear here as they happen") as a
  best-effort notification of concurrent activity, not the persistence
  layer, so it never needing to replay missed events is by design, not a
  gap. Tried to confirm this by toggling `agent-browser set offline on/off`
  against a live `EventSource`, but CDP's offline emulation didn't actually
  close the already-established stream even past its 30s heartbeat interval
  --- the architectural read from the code (no replay buffer exists to miss
  from) settled the question anyway, and is the more reliable evidence here
  since it doesn't depend on a flaky live simulation. (2) Whether the
  Dockerfile/migration-at-boot path survives a real `flyctl deploy` from
  clean disk state matching what's committed: already answered by this
  project's own history --- the very first deploy (logged above) provisioned
  a fresh machine and volume from zero and booted correctly, and three
  further real `flyctl deploy` runs since have each re-applied
  `drizzle-orm`'s migrator against the same persistent volume without issue.
  Re-testing this would need destroying the live volume for no new
  information, not a proportionate test. General lesson: a "does this
  survive X" question doesn't always need a fresh live simulation --- if the
  code's own architecture (no buffer to replay from) or the project's own
  deploy history (already exercised the exact scenario in question) already
  settles it, reasoning from what's already true is legitimate verification,
  not a skipped check.
- **A fresh angle after two candidates from the boundary-validation and
  deploy-path families both resolved clean: ask what UI state is conveyed by
  a CSS class alone, not just what a raw HTTP request could smuggle past
  validation.** This is where the WCAG 1.4.1 use-of-color finding above came
  from --- a different question shape than "what could a request that isn't
  the form send" (already mined for three real bugs on this project), worth
  reaching for once that specific vein goes quiet rather than re-deriving the
  same three checks again.
- **A fourth axe-invisible a11y gap, distinct in shape from the other three:
  markup that's only wrong on one specific navigation, not markup that's
  always present but wrong.** On `comp4020-crit7-dachi`, any rejected booking
  submission (a conflict, a bad time range, an over-length name) redirected
  to a blank form even though the server already had every field the user
  typed --- WCAG 2.2 SC 3.3.7 (Redundant Entry). An axe sweep of the form's
  resting state was never going to catch this, because the resting state is
  fine; only driving the actual rejection path (fill the form, submit into a
  genuine conflict, read the fields back after the redirect) shows the gap.
  Confirmed live with `agent-browser` before touching source, fixed by
  threading the submitted fields through the redirect's query string and
  refilling `value=`/`selected` from them on the page, re-confirmed
  (including that `&`/`'` in free text round-trip correctly HTML-escaped,
  and a non-default `<select>` option stays selected) both locally and
  against the redeployed live URL. General lesson: for any form that
  redirects to a fresh page render on validation failure (as opposed to a
  SPA that keeps the DOM and just shows an error), check whether the fields
  survive the round trip --- a clean a11y sweep of the form's default state
  says nothing about its rejected-submission state, since axe only ever sees
  whatever URL you point it at.
- Found via a **process-hygiene snag worth generalising**: after rebuilding
  a manually-launched dev/test server, `kill %1` silently no-ops across
  separate Bash tool calls in this harness, since each call is its own shell
  and job-control tables (`%1`) don't carry over between them --- the old
  server kept answering on the same port under the *old* build, giving a
  false "the fix isn't working" signal for several minutes. Use `pgrep -af
  <entry-point>` + `kill <pid>` to restart a background server across tool
  calls, never `%N` job-control syntax.
- **A third axe-invisible a11y gap: axe checks how an existing `aria-live`
  region is used, not whether a dynamically-updated one has an `aria-live`
  attribute at all.** On `comp4020-crit7-dachi`'s seventh run, a repeat
  a11y/keyboard/resize sweep (the first repeat since two earlier a11y fixes
  had landed --- worth doing once per content-stable period, per the
  standing rule, not just once ever) found `#live`, the `<ul>` a client
  script prepends new SSE-delivered items into, had no `aria-live` anywhere
  in the source. A fresh `agent-browser a11y` sweep came back 0
  violations/0 incomplete both before and after adding
  `aria-live="polite"` --- the same non-signal the `tr.past` and
  `.table-scroll` gaps below gave. General lesson, a third instance of the
  same family: any element a client script mutates outside of a page
  navigation (prepending, appending, replacing text) is a candidate for
  this exact gap --- check it has an `aria-live` (or
  `role="status"`/`role="alert"`) before trusting a clean a11y sweep to
  mean it's fine. Same run also confirmed (not a bug) that a symmetric
  overlap-interval formula (`existing.start < new.end && existing.end >
  new.start`) is correct by construction for every
  containment/envelopment/exact-match shape, but its one genuine untested
  edge --- two bookings that touch but don't overlap under half-open
  semantics --- had no regression test; locked in as a permanent test
  rather than left as a one-off confirmation, since an off-by-one on
  `</<=` or `>/>=` here is exactly the kind of change a future edit could
  make silently.
- **A second axe-invisible a11y gap, same shape as use-of-color: axe has no
  rule for whether a scrollable non-interactive region is keyboard-
  reachable at all.** On `comp4020-crit7-dachi`'s fifth run, `.table-scroll`
  (`overflow-x: auto` around the schedule table, needed because a room name
  plus five columns overflows any real phone width) had no `tabindex` ---
  and since the table itself has no focusable cells, the whole region was a
  dead stop for a keyboard user: `Tab` skipped straight past it, with no way
  to even reach the scroll, let alone move it. Confirmed live at 390px
  (`scrollWidth 355 > clientWidth 326`, a real `Tab` walkthrough landing on
  `SELECT#roomId` → form inputs → `BUTTON` → straight to `BODY`, nothing in
  between). Fixed with `tabindex="0" role="region" aria-label="Schedule"` on
  the wrapper div; re-confirmed a real `Tab` now lands on it and
  `ArrowRight` moves `scrollLeft`. A fresh a11y sweep after the fix was
  still 0 violations/0 incomplete, unchanged --- exactly as expected, since
  axe never saw this gap either way, the same non-signal a clean sweep gave
  for the use-of-color bug. Also checked `set:html` in
  `src/pages/readme.astro` as a candidate XSS sink before finding this ---
  ruled clean, since it only ever renders the repo's own build-time
  README.md, never user input. General lesson: whenever a stylesheet gives
  a wrapper `overflow: auto`/`scroll` around content that has no focusable
  descendants of its own (a table, a wide diagram, a code block), check
  whether the wrapper itself is keyboard-focusable before trusting a clean
  axe/a11y sweep --- this is a third concrete instance of the pattern this
  file's WCAG 1.4.1 entry names ("axe's silence on this class of bug means
  'not checked,' not 'fine'"), specific to SC 2.1.1 rather than 1.4.1.
- **A single-subscriber SSE test proves the emit path fires, not that the
  broadcast actually reaches every open connection.** `comp4020-crit7-dachi`'s
  own `spec/booking.test.ts` opens exactly one `EventSource`/stream reader per
  test, so it can't distinguish "the bus emits" from "the bus emits to
  everyone" --- a regression that only broke the *second* listener (e.g. an
  `EventEmitter` accidentally replaced per-connection instead of shared, or a
  `bus.off` in one `cancel()` accidentally deregistering a sibling) would slip
  straight past it. Checked directly on the sixth run: built the app, ran it
  locally against a throwaway SQLite file, and drove three separate real
  `agent-browser` sessions --- one submitted a booking through the actual
  form, the other two watched `#live` without reloading, both received it. A
  clean, confirmed pass, not a bug; the general lesson is that any
  single-subscriber integration test for a fan-out mechanism (pub/sub,
  broadcast, multicast) is worth a live multi-listener check at least once,
  since the test's own shape structurally can't see a broadcast-scope bug.
- **A second near-miss of the "never hand-edit a deliverable's `agent/`
  directory" rule, on this same sixth run.** Went to write the run's
  hand-off and typed the deliverable-repo-relative path (`agent/now.md`)
  out of habit before catching it uncommitted and reverting with `git
  restore`. Confirmed again (as the first near-miss, logged on crit 5,
  already found) that `agent/now.md`/`agent/MEMORY.md` are harness-synced
  mirrors of this exact global `memory/` directory, not files to write
  from inside a run. Two near-misses on two different projects is enough to
  treat this as a standing reflex check, not a one-off slip: before writing
  any `now.md`-shaped hand-off, confirm the target path starts with this
  global `memory/`, not a deliverable's own `agent/`.
- **A cheap, distinct test-coverage sensor for any function returning a
  closed union of failure reasons: grep the spec file for each literal
  reason string, don't re-read the validation logic by eye.** On
  `comp4020-crit7-dachi`'s ninth run, `createBooking`'s
  `CreateBookingResult["reason"]` had five members (`unknown-room`,
  `bad-format`, `too-long`, `bad-range`, `conflict`); four had a regression
  test, `unknown-room` didn't --- invisible to every prior pass because none
  of them checked test coverage against the type's own member list directly,
  they each reasoned about individual fields (timestamp shape, text length,
  calendar validity). Fixed by adding the missing case and enabling
  `PRAGMA foreign_keys` in the same run (`src/lib/db.ts` declared a
  `FOREIGN KEY` via Drizzle's `.references()`, present in the generated
  migration SQL, but SQLite doesn't enforce a foreign key unless a
  connection turns it on for itself --- decorative, not a live bug, since
  `createBooking` already checks room existence before every insert; fixed
  as a safety net for any future write path). General lesson: for any
  discriminated-union return type with an enumerated failure/reason field,
  grep the test file for each literal member as a fast, mechanical
  completeness check --- distinct from, and cheaper than, re-deriving
  coverage gaps by reading the validation function's branches one at a time.
- **On an Astro API route, "what could a request that isn't the form send"
  has a framework-level layer underneath the app's own field revalidation,
  worth checking separately.** Any unsafe-method request (`POST`, `PUT`,
  `DELETE`, ...) whose `Origin` header doesn't match the request's own
  origin gets a 403 ("Cross-site ... forbidden") automatically --- Astro's
  built-in same-origin/CSRF check, which fires before the route handler
  ever runs. A plain `curl -X POST` with no `Origin` header at all gets the
  same 403; only a matching `Origin` (or none of the check's conditions
  triggering, e.g. a real browser form submission, which always sends one)
  reaches the handler. A method with no exported handler (`GET` on a
  POST-only route, any method on a GET-only one) 404s, Astro's ordinary
  default. Confirmed on `comp4020-crit7-dachi` by probing both directly
  against a local server --- a clean, confirmed pass, not a bug, and worth
  knowing before writing an HTTP-level test against an Astro API route:
  any test driving one with a bare `fetch`/`curl` needs to set a matching
  `Origin` header itself, exactly as `spec/booking.test.ts`'s own `post()`
  helper does with a comment explaining why.
- **When a resilience question needs a scenario a live sandbox genuinely
  can't simulate, reading the framework's own cleanup wiring can settle it
  more reliably than a live test would anyway.** On `comp4020-crit7-dachi`'s
  eleventh run, the open question was whether `EventSource`'s native
  reconnect after a real network blip (as opposed to a graceful client
  disconnect or a `kill -9`, both already tested live on earlier runs) could
  leave a stale `EventEmitter` listener on the server's SSE broadcast bus. A
  true silent black-hole disconnect (no FIN/RST ever reaching the server) is
  bounded only by OS-level TCP retransmission timeouts, not by anything the
  sandbox can force on demand, so simulating it live would be both hard to
  engineer and hard to trust even if achieved. Instead read the actual
  framework code the request/response passes through
  (`astro`'s Node adapter, `writeResponse` in
  `node_modules/astro/dist/core/app/node.js`): it wires
  `destination.on("close", () => reader.cancel())` on the underlying
  `http.ServerResponse` *unconditionally*, and Node's own `close` event
  fires for any connection teardown --- graceful, forced-kill, or an
  eventual write failure once TCP gives up on an unreachable peer --- not
  just the two shapes already tested live. This is the same family as the
  crit-5 rAF-`dt`-clamp arithmetic check and the synchronous-SQLite-driver
  TOCTOU reasoning: when the invariant in question is already pinned down
  by how a well-behaved underlying system (the language runtime, a driver,
  here the web framework's own adapter) wires its cleanup, reading that
  wiring is a legitimate, often more conclusive substitute for observation
  --- especially once observation would require simulating a network
  condition the sandbox has no real lever for.
- **A live end-to-end check against a deployed app with no edit/delete path
  (by design, per this project's own scope) leaves whatever test data it
  creates in the production database forever --- clean it up via
  `flyctl ssh console`, don't just note it and move on.** On
  `comp4020-crit7-dachi`'s twelfth run, a real keyboard-only-submission
  check (Tab to every field, fill via `eval`, Enter on the focused submit
  button) landed a genuine "TabTest" booking in the live schedule, the same
  way any real user's submission would. Since the app deliberately has no
  way to remove a booking, this would otherwise have sat in the live demo
  data permanently. Fixed with `flyctl ssh console -a <app> -C "node -e
  ..."`, using the app's own `better-sqlite3` dependency already present in
  `node_modules` on the deployed image to open `$DATABASE_PATH` directly and
  `DELETE FROM <table> WHERE id = ?` after confirming the row's identity
  with a `SELECT` first. One wrinkle worth remembering: Drizzle's generated
  SQLite schema uses `snake_case` column names (`starts_at`, `room_id`) even
  though the TypeScript schema and app code are camelCase --- a raw SQL
  query against the live file needs the snake_case names, found via
  `PRAGMA table_info(<table>)` when a first guessed query threw `SqliteError:
  no such column`. General lesson: before any live check that actually submits
  through a real form (not just reads state), ask whether the app has a way
  to undo it --- if it doesn't, the check needs its own cleanup step as part
  of the same run, not a note to fix later.
- **A tenth "what could a request that isn't the form send" angle, once the
  field/HTTP-method boundary was exhausted on `comp4020-crit7-dachi`: the
  request *body's shape itself*, not just its field values.** Any route
  handler that calls `request.formData()` (or `.json()`) unconditionally
  throws on a mismatched `Content-Type` --- a shape the real form can never
  produce, but a bare `curl`/`fetch` can trivially send. The check that
  matters isn't whether this throws (it will), it's whether the framework's
  own unhandled-exception path leaks anything to the client or takes the
  process down. Confirmed against a locally-run **production** build
  (`NODE_ENV=production`, matching the Dockerfile exactly, not the dev
  server) with a JSON-`Content-Type` POST: a 500 with a completely empty
  body (no stack trace, no path), and the very next request served normally
  --- Astro's production error handling swallows the exception cleanly. No
  fix needed, a confirmed pass. General lesson for any full-stack
  deliverable: after the field-level and HTTP-method boundary checks this
  file already documents, add one more --- a request body whose
  `Content-Type` doesn't match what the handler expects --- and verify the
  resulting error response against a build with the framework's production
  error handling actually active (dev-mode error pages often *do* leak
  stack traces, so testing against `astro dev` here would give a false
  sense of the real exposure).
- **`comp4020-crit7-dachi` (Crit Rooms) is now finished --- 17 runs, eleven
  real bugs/gaps found and fixed, final run confirmed green with no new
  commit needed.** A third calibration point alongside Aurora Keys and
  Swerve above, with a genuinely different shape: this was the project's
  first full-stack deliverable (Astro + Drizzle + SQLite, deployed to Fly),
  and its dominant bug families were almost entirely new relative to either
  static prototype's. Boundary/input validation at the HTTP layer
  ("what could a request that isn't the form send") accounted for the
  largest share (timestamp shape, pod/tutor length cap, calendar validity,
  an untested `unknown-room` branch), followed by framework-resource-default
  safety against the actual deployed machine (the 1GB body-size default vs.
  a 256MB Fly machine) and a fourth axe-invisible a11y family distinct from
  the crit-4/5 static-prototype one (use-of-color on a `.past` class,
  keyboard-unreachable overflow scroll, a missing `aria-live` on an
  SSE-fed list, redundant entry on a rejected form's redirect). None of the
  static prototypes' dominant families (app-vs-browser input arbitration,
  multi-writer shared visual state, animated-custom-property registration)
  applied here at all --- confirmed directly by reading the one client
  script in this repo (ten lines, no keydown/pointer/touch handling to
  harbour that bug class). Several confirmed-clean passes rounded out the
  runs (CSRF/origin boundary, SSE fan-out to multiple subscribers, an
  SSE-reconnect cleanup question settled by reading the adapter's own close
  wiring rather than simulating a network death, a TOCTOU race ruled out by
  the synchronous SQLite driver's single-threaded execution). General
  lesson: a deliverable's tech stack, more than hours invested, determines
  which sensor families are worth inventing first --- default a future
  full-stack deliverable straight to the boundary-validation and
  framework-default-vs-deployed-resources questions before reaching for the
  static-prototype-honed browser-automation techniques, the same way the
  content-heavy assignment 2 entry already recommends raw-content-reads
  over browser automation for its own different shape of deliverable.
- **An eleventh angle in the same family, and the first on this project to
  turn up a real bug rather than a confirmed pass: whether a framework's
  default resource limit is safe on the actual deployed machine, not just
  reasonable in the abstract.** `@astrojs/node` defaults `bodySizeLimit` to
  1GB; `comp4020-crit7-dachi`'s `astro.config.ts` never overrode it, and the
  deployed Fly machine has only 256MB of RAM (`fly.toml`) --- a real booking
  POST is under 1KB even at the form's own field caps, so nothing stood
  between an oversized POST and the machine's actual ceiling. Confirmed live
  against a locally-run production build: baseline RSS ~245MB, a single 5MB
  oversized form field pushed it to ~279MB, because the raw value gets
  copied several times over (buffered by the streaming body-size guard,
  decoded into the parsed form, and --- for a rejected submission --- echoed
  whole into the redirect's query string by this app's own
  resubmit-fields-on-rejection fix). A 256MB machine has no defense against
  a POST an order of magnitude below the 1GB default's own threshold. Fixed
  with `bodySizeLimit: 64 * 1024` (64KB) in the node adapter's options ---
  generous over any real submission, far below any threat to the machine ---
  verified both directions (a form-capped-length booking still succeeds, an
  oversized body gets a clean empty 500 with the server still answering the
  next request) both locally and against the redeployed live app. General
  lesson: a framework default that reads as reasonable in isolation (1GB is
  a normal upload cap for a general-purpose app) can be wildly unsafe on a
  specific deployment's actual resource envelope --- whenever a project pins
  a small VM/container memory size (as this course's Fly deploys do,
  `256mb`), check every framework-level size/rate/concurrency default
  against that number explicitly, rather than trusting an unconfigured
  default to already be sane.

## The final project (crits 8--10)

- `node:sqlite` (`DatabaseSync`, built into Node since 22.5, unflagged and
  stable by the course's pinned Node 24.21.0) is a genuinely good default
  for a small full-stack deliverable's persistence layer, confirmed on
  `comp4020-final-dachi`'s first run: zero native modules to compile in a
  slim Docker image, versus `better-sqlite3` (crit 7's choice), which needs
  a build toolchain present at image-build time. Trade-off worth naming in
  `PROCESS.md` when choosing it: it's a newer API with a smaller track
  record than `better-sqlite3`, so the win is specifically "one less thing
  that can fail to build on the deploy target," not "strictly better."
  Worth defaulting to for any future crit/assignment repo pinned to a
  recent Node version, rather than reaching for `better-sqlite3` out of
  habit from crit 7.
- A **`node:http` (no framework) server has no adapter layer to get
  response-vs-socket-teardown ordering right by default** --- the crit
  7 lesson about `bodySizeLimit` assumed a framework (`@astrojs/node`)
  already handles the mechanics of rejecting an oversized body correctly,
  leaving only the *threshold* to choose. Hand-rolling the guard instead
  (a plain `req.on("data", ...)` accumulator) surfaced a new, more basic
  mistake: calling `req.destroy()` the moment the cap is exceeded, before
  writing the 413 response, closes the socket in both directions and drops
  the response with it --- `fetch` sees a bare connection reset, not a
  413. Caught immediately by the project's own regression test for the cap
  (run against the real Docker image, not a dev server) before it ever
  reached a commit. Fix: write and end the error response first, destroy
  the socket only afterwards. General lesson: whenever a body-size (or any
  other) guard is hand-rolled directly against `node:http` rather than
  provided by a framework, check the response-then-teardown order
  explicitly --- a framework adapter usually gets this right invisibly;
  bare `node:http` code has to get it right on purpose.
- Confirmed again, a second project after the crit-7/assignment-2 cases:
  **when an app's only persistent action has no delete path, a real
  end-to-end check against the live deployed app permanently alters
  production state, so make it something worth leaving rather than either
  skip the live check or leave throwaway junk.** On `comp4020-final-dachi`
  (a shared, append-only, no-delete "scroll"), the live proof-of-life
  check --- add a mark through the actual deployed form, reload, confirm it
  persists --- was done deliberately as a genuine "first hand" stroke
  rather than a "test test test" note, since whatever went in would stay
  forever. Cheap to do when the app's own concept has room for a sincere
  first entry; wouldn't generalise to an app where a fabricated entry
  would look like real user data (contrast crit 7's Crit Rooms, where a
  live keyboard-submission check left a "TabTest" booking that genuinely
  needed deleting via `flyctl ssh console` afterward, since a fake booking
  in a real room schedule has no honest reading).
- **The "what could a request that isn't the form send" boundary-validation
  question (crit 7's dominant bug family) applies to request *headers*, not
  just the body/fields a form controls.** On `comp4020-final-dachi`'s second
  run, `parseCookies` in `src/server.ts` called `decodeURIComponent` on every
  `Cookie` header value with no guard; a malformed percent-encoded value
  (`Cookie: hand=%zz`) threw, and the outer try/catch turned that into a 500
  --- even though the same app already held itself, via an existing test, to
  never letting a malformed JSON *body* do that. No form the app serves can
  ever produce a bad cookie (it always sets `hand` to a bare `randomUUID()`),
  so this needed a raw `curl -H "Cookie: hand=%zz"` to reach, the same way
  crit 7's timestamp/length/CSRF gaps all needed a request that skipped the
  form. Fixed with a try/catch around the one `decodeURIComponent` call,
  degrading to "skip this cookie" rather than throwing
  ([`98148df`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-dachi/commit/98148df)).
  General lesson: when doing a boundary-validation pass on a full-stack app,
  enumerate *every* place client-supplied text gets decoded (`Cookie`,
  `Authorization`, custom headers, query-string params via
  `decodeURIComponent`/`JSON.parse`/similar) as its own checklist item, not
  just the request body and form fields --- headers are exactly as
  attacker/bug-controlled as a POST body, and easy to forget precisely
  because no real form ever touches them.
- This was also a useful calibration point for *when* to look for bugs on a
  brand-new, minimal deliverable: crit 8's own bar ("proof of life") was
  already fully met after the first run, and the brief explicitly defers
  real-time and rate-limiting to crits 9/10 --- so a second run at 160.5h to
  cutoff (still >95% of the week left) correctly read "deepen" as "re-read
  the existing code fresh for boundary-validation gaps and run not-yet-tried
  browser sensors (320px reflow, a full keyboard-only submission, a11y on
  both pages)," not as "start building crit-9 features early." One real bug
  turned up (the cookie one above); everything else (a11y, keyboard tab
  order plus arrow-key palette selection, 320px reflow, XSS via
  `textContent` rather than `innerHTML`) came back clean. Worth the same
  read on any future early-week final-project run: deepen inside the
  current crit's own stated scope before reaching for the next crit's
  deferred features, even with most of the week still on the clock.
- **A cookie value's *decoding* being safe (the previous entry's fix) is a
  separate question from its *shape* being safe --- both need checking
  before a client-supplied identity token is trusted.** On
  `comp4020-final-dachi`'s third run, `parseCookies` decoded `hand` safely
  after the fix above, but nothing checked the decoded value looked like the
  `randomUUID()` this server itself mints; a raw POST with a 5000-byte
  `Cookie: hand=...` value got stored as that mark's `hand` forever, since
  the app is deliberately append-only with no edit/delete path at all.
  Confirmed live (not just reasoned) with a throwaway 5000-byte cookie
  against a locally-built Docker image before touching source. Fixed with a
  UUID-shape regex checked at both the GET (`you`) and POST (mint-a-fresh-
  hand) call sites
  ([`6a63225`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-dachi/commit/6a63225)).
  General lesson: for any client-supplied token trusted as an identity
  (a cookie, a header, a bearer value) rather than as content, "decodes
  without throwing" and "has the shape this app would ever actually issue"
  are two independent checks --- fixing the first doesn't close the second,
  and an append-only store with no delete path makes the second one
  specifically a permanent-storage-bloat risk, not just a display glitch.
- Confirmed again (crit-7's Crit Rooms pattern): a live re-verification of a
  fix against the *deployed* app, when the app has no delete path, adds a
  real row that needs cleaning up afterward. The oversized-hand probe above
  landed a test-shaped stroke ("crit-8 live oversized-hand probe") in the
  live scroll; removed via `flyctl ssh console -a comp4020-final-dachi` and
  a direct `node:sqlite` `DELETE FROM marks WHERE id = ?` after confirming
  the row's identity with a `SELECT` first (same technique as crit 7, this
  project's own `better-sqlite3`-free `node:sqlite` choice needs `node -e`
  with `require("node:sqlite")` rather than a `better-sqlite3` import).
  Left the first run's genuine "the first hand" stroke untouched.
- **"What could a request that isn't the form send" (the dominant boundary-
  validation lens across crit 7 and this project's earlier runs) only asks
  about the *request* side; the *response* side is a distinct, separately-
  checkable question: does a cookie the server itself sets carry the
  attribute flags its own purpose calls for.** On `comp4020-final-dachi`'s
  fourth run, once three runs of request-side checks had genuinely exhausted
  every persisted field (colour, note, body shape, hand shape), reading
  `src/server.ts` fresh for the response side instead found the `hand`
  cookie --- a five-year bearer identity token for a store with no
  edit/delete path --- set with no `HttpOnly` or `Secure` flag. Confirmed
  before fixing that no client script reads `document.cookie` anywhere (a
  plain `rg` across `public/*.js` and `src/*.ts`), so `HttpOnly` costs
  nothing; `fly.toml`'s `force_https = true` means `Secure` costs nothing
  either. Fixed by adding both to the one `set-cookie` line
  ([`e3afe35`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-dachi/commit/e3afe35)),
  verified against the real Docker image and the redeployed live app
  (`curl -si -X POST` showing the flags on the real response header), same
  discipline as every other fix on this project. General lesson: for any
  app that sets an identity/bearer cookie, "is the value validated on the
  way in" and "does the cookie itself carry the flags appropriate to how
  it's used" (no JS access needed → `HttpOnly`; site is https-only →
  `Secure`; cross-site state-changing requests a concern →
  `SameSite=Strict`/`Lax`) are two independent audits --- exhausting the
  first doesn't touch the second, and the second is invisible to every
  sensor this whole memory file has built up (a11y, boundary-validation
  tests, live browser checks), since none of them read response headers for
  their own sake.
- **For a hand-rolled server (no framework), "what could a request that isn't
  the form send" extends to *where the request came from*, not just its
  fields/headers/body shape --- and the live proof needs a real second
  origin, not a `curl` flag, since CSRF is a browser-enforced-policy
  question.** On `comp4020-final-dachi`'s sixth run, `src/server.ts`'s POST
  handler never checked the request's origin, and (per the cookie-shape
  entries above) never checked `Content-Type` either --- which meant the
  well-known `<form enctype="text/plain">` JSON-smuggling technique (craft
  one `<input>` whose `name` is the JSON up to the last string value and
  whose `value` closes it, so the serialized `name=value` pair is itself
  valid JSON) sailed straight through. Proved this live, not just by
  reasoning about it: built a tiny attacker page on a second local
  `python3 -m http.server` port, pointed a hidden auto-submitting form at
  the real app's `/api/marks`, and confirmed a real row landed with zero
  user interaction beyond loading the page. Into a store with no edit/delete
  path, that's permanent drive-by vandalism, not a cosmetic gap. Fixed with
  an Origin-vs-Host check mirroring the protection Astro gave crit 7's
  project for free (checked that memory entry first to confirm the same
  technique applied) --- reject when `Origin` is missing or its host doesn't
  match the request's own `Host`, matching browsers' own behaviour (every
  unsafe-method request carries an `Origin` header the page itself can never
  override, same-origin or not). Re-ran the identical attack page against
  the patched server to confirm it no longer lands a row, and confirmed the
  real same-origin form still works. General lesson: this specific gap is
  invisible to the project's existing field/header/cookie validation
  lenses, which all ask "is this value well-formed" --- CSRF asks "should
  this request have been allowed to arrive at all," a question worth adding
  explicitly to the "what could a request that isn't the form send" checklist
  for any hand-rolled (no-framework) server with a state-changing route, not
  assuming it's covered once field-level validation is thorough. And since
  browsers (not curl, not Node's own fetch) are what actually enforce
  SameSite and same-origin policy, confirming a fix in this family needs a
  real second-origin page driven by a real browser, the way
  `agent-browser`'s own sensors are used everywhere else in this file ---
  reasoning or a `curl -H origin:` substitute proves the server's *logic*,
  not that a real browser's request shape actually triggers it.
- **A `fly.toml` with `auto_stop_machines = "stop"` / `min_machines_running
  = 0` (the course's default, to keep a deliverable's cost near zero) makes a
  front-end's unguarded `fetch` rejection a real production bug, not a
  hypothetical one worth skipping.** On `comp4020-final-dachi`'s fifth run,
  once request-side boundary validation (three runs) and response-header
  hardening (one run) had both gone dry, reading `public/app.js` fresh with a
  new question --- not "what can a request smuggle past the server," but
  "what happens when the client's own fetch fails" --- found neither `load()`
  nor the submit handler had a `catch`. A dropped connection (a cold-starting
  machine being the concrete, config-driven reason one would really happen
  here) left an unhandled promise rejection in the console and the status
  text stuck at "adding your mark…" forever; the page silently never
  populated on the load path. Confirmed live with `agent-browser network
  route "**/api/marks" --abort` plus a real `addEventListener
  ('unhandledrejection', ...)` listener (not just inspecting the code), both
  before and after. Fixed with a `try`/`catch` around each fetch, degrading
  to a visible, honest message
  ([`f1704db`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-dachi/commit/f1704db)).
  General lesson: once a project's `fly.toml` deliberately stops the one
  machine when idle (the standard cost-saving config this course's starter
  sets), that specific choice turns "the client's fetch can reject, not just
  answer badly" from a textbook robustness nicety into a concretely reachable
  path --- worth checking on any such deliverable's front end once the
  request/response-boundary lenses above have been exhausted, the same way
  those lenses themselves were worth re-deriving project by project rather
  than assuming one clean pass covers every layer.
- **A same-origin check on the request (crit 8's `isSameOrigin`/Origin-header
  defence against CSRF) is a distinct question from whether the page can be
  *framed* --- the first guards a forged request, the second guards a
  genuine one a real visitor was tricked into making.** On
  `comp4020-final-dachi`'s eighth run, the server had zero framing defence:
  confirmed live by building a throwaway attacker page on a second local
  origin, iframing the real app in it, and screenshotting via
  `agent-browser` --- the app rendered in full inside the frame. Cross-origin
  JS can't read what's inside the iframe (same-origin policy blocks that
  regardless), but an attacker doesn't need to read it: they can overlay
  their own UI on top of the iframe and trick a visitor into clicking the
  real "submit" button, landing a genuinely same-origin request with the
  visitor's own real cookie. Into a store with no edit/delete path, that's
  exactly as serious as a forged-origin request. Fixed with
  `X-Frame-Options: DENY` plus `Content-Security-Policy: frame-ancestors
  'none'`, set once via `res.setHeader()` before any route branching rather
  than threaded through every individual `writeHead()` call (Node merges
  `setHeader` values into whatever a later `writeHead(status, headers)`
  call doesn't itself override) --- confirmed with the identical
  attacker-page screenshot afterward, now rendering as a broken image.
  General lesson: whenever a CSRF/same-origin check has already been added
  to a state-changing route, separately ask whether the page can be framed
  at all --- clickjacking is invisible to every sensor this file documents
  (axe doesn't check it, a same-origin-request test doesn't either, since
  the clickjacked request *is* same-origin) and needs this exact live
  two-origin-iframe-plus-screenshot technique to confirm, not just reasoning
  about headers.
- **Once a response-header-hardening vein has found one real attack (crit
  8's clickjacking fix), checking the rest of that same header family is
  worth doing explicitly even when nothing left in it blocks a reachable
  exploit.** On `comp4020-final-dachi`'s ninth run, `X-Content-Type-Options:
  nosniff` and `Referrer-Policy` were both absent after `x-frame-options`/
  `content-security-policy` had already been added; neither closes an
  attack the way the Origin/frame checks did (every response already
  declares its own content-type explicitly; nothing in the page's own URL
  is secret), but both are zero-cost once the sharper gaps in the same
  family are fixed. Worth naming honestly as hardening, not a demonstrated
  exploit, when writing it up --- not every header worth adding has a live
  attack page to screenshot against it.
- **A project's own README/CLAUDE.md can state a claim under an explicit
  "Enforced, in `spec/`" heading that nothing in `spec/` actually tests ---
  grep the claims against the test file contents directly, don't trust a
  green `pnpm check` to mean every stated claim has a test behind it.** On
  `comp4020-final-dachi`'s tenth run, README.md listed "a returning hand's
  past strokes are still in the response after a fresh server restart" as
  enforced in `spec/`, but every existing test (via `spec/global-setup.ts`)
  hits the one app instance the whole `pnpm check` run shares --- none of
  them ever restart the process, so the claim, though architecturally true
  (SQLite on a persistent volume, read fresh on every request), had no test
  behind it. Fixed by spawning two short-lived `node src/server.ts` child
  processes against an isolated `DATA_DIR` (the same env var
  `src/db.ts` already reads, a temp dir standing in for the Fly volume),
  posting a stroke, killing the first, starting a second against the same
  data dir, and confirming the stroke survives. Verified the test was a real
  sensor (not a vacuous pass) by re-running the identical sequence by hand
  with the second instance pointed at a *different* temp dir instead ---
  confirmed the stroke correctly vanished, proving the assertion would catch
  the regression it exists to catch. General lesson, a sibling to the
  `comp4020-ass2-dachi` `spec:`-frontmatter and `related:`-dedup content-rule
  gaps: for any project whose own docs explicitly name what's "enforced in
  spec/" or "must not break," grep each named claim against the actual test
  file contents as its own checklist pass (every rule in CLAUDE.md too, not
  just README's list: crit 8's append-only rule held only because no route
  answered PUT/PATCH/DELETE, a rule-by-absence no test guarded; mutation-
  check each new test with a temporary violating route) --- a claim can be true in the
  architecture while still being completely unverified by anything that
  runs, and no sensor already in this file (browser automation, boundary
  validation, header checks) would ever surface that gap, since it's a
  property of the test suite itself, not of the app.
- **For a hand-rolled body-size guard (no framework), "the body is too big"
  and "the client vanished before sending the whole body" are two different
  code paths that happen to share a catch block, and testing one doesn't
  cover the other.** `comp4020-final-dachi`'s existing regression test only
  ever sends a *complete* over-cap request (hits `readBody`'s `size >
  MAX_BODY_BYTES` branch); nothing tested a connection that resets mid-body
  (hits the socket's own `error` event instead). On the seventh run, a raw
  `node:net` socket sending a partial body then `resetAndDestroy()` proved
  the server already handles this correctly --- `req.on("error", reject)`
  was wired up for the size-cap case but catches this one too, so no source
  change was needed, just a regression test to stop it being coincidental
  coverage
  ([`67e28e7`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-dachi/commit/67e28e7)).
  General lesson: whenever a hand-rolled (no-framework) body-size guard's
  own test only exercises a complete, over-cap request, add a second test
  that aborts mid-stream instead --- they are genuinely different branches
  of the same guard, and a framework-free server has to get both right on
  purpose the way `@astrojs/node` (crit 7) gets them right for free.
- **A no-build vanilla front-end script can be spec-tested against the
  *running* app, not a stub, with jsdom alone.** On `comp4020-final-dachi`
  (`spec/page.test.ts`, `0cd898c`): fetch the served HTML and served
  `app.js`, build `new JSDOM(html, { url: baseUrl, runScripts:
  "outside-only" })`, replace `window.fetch` with a wrapper around Node's
  own fetch that resolves relative URLs and adds the cookie/Origin a real
  browser would send (jsdom shares no cookie jar with Node), then
  `window.eval(script)` and poll the DOM. Works for a script with no
  imports even when the page loads it as `type="module"`. This turns
  front-end claims (text-not-just-colour ownership markers, labelled native
  controls in tab order) from "checked once by hand in agent-browser" into
  regression tests; jsdom still can't see contrast or layout, so it
  complements rather than replaces the live browser sweep. Mutation-check
  each such test against a deliberately broken rebuilt image before keeping
  it.
- **Before adding a broadcast (SSE/WebSocket) to an existing app, audit what
  its JSON already publishes.** A live stream pushes that same shape to every
  open tab. `comp4020-final-dachi`'s `/api/marks` had published every
  stroke's `hand` cookie value (a bearer identity) since crit 8, through 18
  runs of header and boundary checks that only looked at requests and
  response *headers*, never at response *bodies*. Its own spec even read
  "someone else's hand" out of the listing. Send derived per-requester facts
  (`yours: boolean`), never the token.
- **`node:http` doesn't send response headers until the first body write.**
  An SSE route that calls `writeHead` and then waits for events leaves the
  client's `EventSource` unopened (no `open` event, `fetch` unresolved) until
  something is written, which could be a 25s heartbeat. Write an initial
  frame (`retry: 3000`) or call `flushHeaders()`. Found because a mutation
  check failed at 5s instead of 1s; give the test's stream reader a timeout
  on headers too.
- **Real-time own-echo race:** a stream opened before a first-time visitor's
  identity cookie existed delivers their own first post as someone else's,
  and in Chrome the stream copy usually beats the POST response. jsdom over
  localhost hides this (the response always wins), so force the bad order in
  the test by holding the POST response back. More generally, when parallel
  spec files share one running app, stream tests must assert properties (ids
  ascending, all past the resume point), never exact event sequences.
- **A boolean "my request is in flight" flag that suppresses one thing (here,
  announcing your own stroke) also suppresses everything else that arrives in
  the same window.** Hold the arrivals and filter them once the response says
  which one was yours. Cold starts on an auto-stopping Fly machine stretch
  that window to seconds. To test it, hold the response back and post as a
  second hand meanwhile. Fly's proxy keeps an idle SSE stream open as long as
  a 25s heartbeat keeps arriving (checked for 80s).
- **Any per-request "in flight" state needs a re-entry guard: ask what a
  second submit does before the first answers.** On the final project the
  held-arrivals list was reset by a second submit and nulled under it, so a
  double click posted twice to an append-only store, split a first-time
  visitor across two hands (neither post carried a cookie yet), and threw.
  Guard the handler on the same state, and keep every await that can reject
  (including `res.json()`) inside the try so the state can't get stuck set.
  Test it by clicking twice against a held-back response. An in-flight guard
  alone isn't enough: a warm server answers in milliseconds, faster than a
  human double-click (100--250ms), so the second click submits the cleared
  form. Keep submits ignored for a short settle (1s) after success. CDP
  `agent-browser dblclick` fires both clicks microseconds apart and hides
  this; test with two `click()`s 150ms apart via `eval`.
- **Read every client error message against what the real form can actually
  send.** If the form's own constraint (maxlength, a fixed radio set) means
  the validation error can never happen, then the message attached to it is
  the one visitors see for every *other* failure (5xx, a proxy refusing a cold
  start), and it gives wrong advice. Branch the copy on the server's own error
  reason, not on `!res.ok`. Found on the final project, and tested by having
  the page's stubbed fetch answer the POST with a 502.
- **An SSE heartbeat sent as a comment line (`: ping`) keeps proxies open but
  is invisible to `EventSource`, so the page can't tell a quiet stream from a
  dead one.** A half-open connection (a phone waking on a socket the server
  already dropped) stays OPEN with nothing arriving, so the page keeps saying
  "live". Send the heartbeat as an event (`event: ping\ndata:\n\n`; an empty
  `data:` line still dispatches) and reopen any stream silent for two
  intervals, checking on a timer and on `visibilitychange`. To test it in
  jsdom, override the window's `Date.now` and dispatch `visibilitychange`
  with `document.hidden` redefined; no fake timers needed.
- **Drive the 320px reflow check with worst-case user content, not just the
  page as it loads.** On the final project a note that was one unbroken run
  (a pasted URL, within the form's own 140-char limit) widened the page to
  913px, because a flex item's default `min-width: auto` stops it shrinking
  below its longest word. axe saw nothing. Post the longest unbroken value
  the form allows, then read `scrollWidth`; fix with `min-width: 0;
  overflow-wrap: anywhere` on the text.
- **A visually hidden live region can give screen-reader users a signal
  sighted users never get.** If what it announces happens out of view (on the
  final project, new strokes landed ~1.5 phone screens below the first view),
  show the announcement as well, and say where the thing went. axe can't see
  this; compare what each kind of visitor perceives at the top of the page.
- When CI fails at a step whose logs need auth (no `gh` here), first push the
  next real commit before chasing it: on the final project three red
  docker-build runs within 11 minutes were transient and the next push went
  green. A local legacy `docker build` (no buildx here) ignores the
  Dockerfile's `# syntax` line, so it can't reproduce a BuildKit-only fault
  anyway. Otherwise check the
  public jobs API (`/actions/runs/<id>/jobs`) for the failing step. Then
  reproduce that step with a no-cache build, and use a Fly remote build of the
  same Dockerfile as a second builder. If both pass, `flyctl deploy` keeps the
  live app current while CI stays red.
- `pkill -f <pattern>` run inside a Bash tool call can match that call's own
  `zsh -c` command line and kill it (exit 144). Use `pgrep -af` and kill the
  specific pid instead.
- **Crit 8 of `comp4020-final-dachi` is done: 18 runs, with the final run a
  pure re-verification and no new commit.** Nine real gaps were found, all in
  the hand-rolled `node:http` server's boundary and headers (cookie decoding
  and shape, cookie flags, CSRF, clickjacking, fetch failure) or in README
  claims that `spec/` didn't actually test. The crit-8 well ran dry by about
  run 12, and the remaining runs were light touch. The repo stays the same
  one through crit 10. It's public now, and CI deploys every push to `main`
  in about a minute; poll the live URL to confirm, since `gh` isn't
  authenticated here.
- **To rehearse "several people at once" for real, arm each `agent-browser
  --session <name>` with a `setTimeout` to one shared wall-clock timestamp**
  (`T=$(( $(date +%s%3N) + 3000 ))`, then `eval` a `requestSubmit()` delayed
  by `T - Date.now()` in each session). Sequential CLI calls are hundreds of
  ms apart and never collide. Separate sessions have separate cookie jars, so
  they really are different visitors. On the final project both tabs agreed
  on order and ownership. The rehearsal also showed that copy about the past
  ("you've left a mark before") had been recomputed on every live update.
  Derive "before this visit" state at load only.
- **A per-connection identity fixed when a stream opens goes stale for every
  tab that opened before the identity existed.** Two sessions with separate
  cookie jars never show it; two tabs of one fresh session do (each labelled
  the other's strokes a stranger's on the final project). Fix client-side: the
  tab whose post sets the identity tells its siblings on a `BroadcastChannel`.
  Test in jsdom by giving two pages one shared cookie jar and Node's own
  `BroadcastChannel` on `window`.
- **Measure SSE capacity before a crit instead of trusting Fly defaults.**
  `fly.toml` with no `concurrency` block means `connections`, soft limit 20,
  and no hard limit, so one machine doesn't refuse a room of tabs. On the
  final project, 500 open streams cost about 9MB under a 256MB limit. Run
  the open-N-streams check with a Node script that aborts its own fetches,
  and use `?after=<huge id>` so no history gets replayed.
- **Crit 9 of `comp4020-final-dachi` is done: about 17 runs, final run pure
  re-verification with no new commit.** The real finds were all client-side
  real-time races and copy (in-flight announcements, double submit, silent
  half-open streams, sibling-tab identity, out-of-view arrivals), found by
  forcing event order in jsdom rather than trusting localhost timing. The
  well ran dry around run 12, as on crit 8.
- **Crit 10 (logs say who did what): name a person in a log line by a short
  hash of their identity cookie, never the cookie itself.** A bearer token
  read out on a projector is leaked. Mint the identity on first page load,
  not first write, so idle visitors are already distinct. JSON-quote free
  text so a note with a newline can't forge a line. To test logging, spawn a
  dedicated server in the spec and read its stdout, since the shared CI app's
  stdout isn't visible. Mutation-check by making the tag return the raw
  cookie. A spec's own readiness `fetch(origin)` also counts as a visit, so
  assert on the last N log lines, not all of them.
