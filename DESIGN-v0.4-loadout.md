# Ball Blaster — v0.4 Proposal: Gear and Loadouts

Oct 12, 2026 · **Approved** (owner: "this is good"; recommendations on the six questions taken as decided; Poison, Explosive and more passives added at the owner's request). Builds on v0.3 (one tree, worlds). Nothing here changes combat rules; it changes what the player brings to a run.

## The idea in one line

The tree keeps making you stronger; **gear** changes *how you play*. Gear is unlocked on the tree, upgraded on the tree, and **equipped before a run** into a small loadout. Slots are scarce, so a loadout is a build.

## Why

- Today every effect you buy is always on. By mid-game you have lightning, split and spitter all at once and no decisions left to make between runs. Scarce slots turn "buy everything" into "bring the right things".
- Stages now have visible modifiers (ranged, dark, big rack…). A loadout is the natural answer to a modifier: the map shows the problem, the loadout screen is where you solve it.
- It gives the grind a second axis. Stat nodes are "more"; gear is "different". Unlocking a cue feels like a new toy, not a bigger number.

## Slots

| Slot | What it is | Count | Unlocked |
|---|---|---|---|
| **Ball** | the projectile's physics (exists today) | 1 | from the start |
| **Cue** | how the shot itself behaves — the "weapon" | 1 | first cue unlockable after the first boss kill (3 emeralds) |
| **Relic** | a rule-changing passive effect | 2 (3rd at world 4) | slot 1 with the first relic; slot 2 at world 2 |
| **Counter** | the current world's counter relic (Grip on ice, Lantern on dark worlds…) | 1, auto-equipped on that world | with the world's graft; does not use a relic slot |
| **Trick** | one active, no targeting, limited uses per run | 1 | world 2 |

A fresh player has nothing to equip and never sees the loadout screen; the first unlock is the tutorial. That keeps run 1 as simple as it is now (handbook: depth without overwhelm).

## Gear catalogue (launch set)

**Balls** (existing, unchanged): Standard · Heavy (mass 2, +1 dmg, slower) · Light (fast, barely shoves) · Sticky (stun shot: stops on first contact, +1 stagger — this is the "stun cue", so there is none). **Comet** (burning trail) is Ember Pit's graft gear, not launch set.

**Cues** — change the shot, not the numbers. No new gestures: still drag-anywhere, release.

| Cue | Effect | Trade |
|---|---|---|
| Standard | — | — |
| Break | +35 % launch speed | aim preview off; min power 50 % (every shot is a slam) |
| Jump | the ball passes over the first enemy in its path and lands behind it | −1 damage on the first contact after landing |
| Draw | after the first contact the ball pulls back toward where it was shot from (backspin) | 20 % less power |
| Follow | after the first contact the ball keeps going at 60 % speed (topspin) | hero takes +1 from charges this run |

**Relics** — the always-on effects become relics (this is the big change): **Lightning**, **Split**, **Spitter** move off the tree's passive list into relic unlocks, with their level nodes behind them. New relics:

Each relic anchors a build. Launch set (13):

| Relic | Effect | Upgrade (cash level nodes) | Build |
|---|---|---|---|
| Lightning | (existing) arcs to nearby enemies | arcs, range, damage | chain |
| Split | (existing) ball splits on first contact | children | chain |
| Spitter | (existing) emits spat balls while rolling | interval, life | chain |
| **Poison** | every ball contact adds 1 poison stack; at the start of each enemy phase a poisoned enemy takes damage equal to its stacks, then loses 1 stack. Ignores shields; never staggers. Max 5 stacks | +1 stack per contact; stacks don't decay | attrition — hit many things lightly |
| **Explosive** | the first hit of each shot explodes: half your damage (rounded up) to every enemy within 40 px of the impact, +1 stagger each. The blast costs the ball half its speed | radius 50 → 60; keep full speed | racks — one slam into the cluster |
| **Chill** | a hit chills an enemy for the next enemy phase: charge speed and reach −40 %, Advance halved | lasts 2 phases | control — buy time against brutes |
| **Shrapnel** | every kill by the ball releases 2 shards (0.8 s, 1 damage, free hits) | 3 shards | kill chains |
| **Static** | an enemy that becomes staggered takes 1 damage | 2 damage | stagger builds (Heavy Hits, Sticky) |
| Ricochet | +1 damage per rail bounce before the first hit (max +3) | max +5 | bank shots |
| Lantern | counters *dark*: intents always visible | +1 reach on the glyph colouring | dark stages |
| Thorns | an enemy that lands a charge on you takes 2 | 3 | tank |
| Momentum | each consecutive shot that hits ≥ 2 enemies adds +1 damage (max +3; resets on a shot with fewer) | max +5 | consistency |
| **Mirror** | 30 % of ranged shots are reflected: no damage to you, 1 to the shooter | 50 % | ranged stages |

Later (not launch): Magnet (pull enemies toward where the ball stops), Decoy (a dummy ball charges target), Bulwark (first charge each phase blocked), Greed (+30 % cash, −2 max HP), Impact (hard hits shove 2×).

**Status rendering:** poison = green bubbles + a stack digit under the HP pips; chill = pale-blue outline + a snowflake over the intent glyph; explosions reuse the blast ring.

**Tricks** — one button on the run HUD, no targeting, N uses per run, usable only during aim.

| Trick | Effect | Uses |
|---|---|---|
| Recall | teleport the ball to the bottom-centre safe spot | 1 |
| Time Stop | skip the next enemy phase | 1 |
| Rack 'Em | pull every enemy 20 px toward the table centre (makes a cluster) | 1 |
| Shockwave | +1 stagger to every enemy within 60 px of the ball | 2 |

## How gear lives on the tree

- **Gear nodes are one-shot unlocks on the diagonals** (where the emerald keystones are now), **priced in emeralds** — bosses stay the reason to farm. Balls and relics on the NW/SE diagonals, cues NE, tricks SW.
- **Emerald pacing:** income is 3 + stage index per first boss kill (repeat kills decay), so a player has ~3 emeralds after the first boss (~run 7), ~10 by world 2, ~30 by world 3. Prices: the first cue and first relic cost **3** each (the first boss kill buys your first toy), later cues/relics **5–8**, balls **4–6**, tricks **10–15**, relic slot 3 is a graft capstone. Nothing is equippable before the first boss kill, so the opening stays as simple as it is now.
- **Behind each gear node, 1–3 cash-priced level nodes** improve it (Lightning II: +1 arc; Jump II: no damage penalty; Recall II: 3 uses). Levelling stays "levels on nodes".
- Lightning/Split/Spitter: their current tree positions become the *unlock* node (anyone who bought them keeps them) and their existing level nodes stay as the upgrades. What changes is that only two of them can be *equipped* at once — a player who owns all three loses the always-on stack. This is cheap to decide now (the owner's save has no effect nodes yet) and costs more with every run played.
- Grafts gain one gear node each: the world's **counter** becomes a relic that auto-equips in the Counter slot while you are on that world (it never competes with the two relic slots). Buying it is still a choice; equipping it is not.

## Equip flow

- **Loadout screen**, reached from the map's stage panel and from the tree (a LOADOUT button where SET is). Five slots across the top with the equipped item's icon; tap a slot → the owned items for that slot as a horizontal strip, tap one → EQUIP. Locked slots show their unlock condition.
- **The map shows each stage's modifiers as small icons** on the pip, so you can read "dark · ranged" and bring Lantern + Bulwark.
- Equip is pre-run only. No in-run swaps (keeps the v0.1 "no in-run picks" cut).
- The run HUD shows the trick button (bottom-left, opposite fast-forward) with its remaining uses.

## Balance notes

- Slots are the balance lever: with 2 relic slots, no single stack (Lightning + Split + Spitter + Momentum) exists until world 4.
- Tricks are the riskiest: **Time Stop** is a free turn (cuts against "every enemy phase hurts") and **Recall** undoes a bad leave (cuts against "every shot is a leave"). Both start at 1 use and a high price; the bot must verify no stage drops below rtc 3 with any trick equipped. If either still trivialises a stage, it goes.
- The progression bot needs a loadout policy: try a fixed set of 4 loadouts per stage (pure damage, pure control, pure defence, counter-the-modifier) and take the best; the gate uses the best, the "no trivial stage" check uses all four.
- Art: ~20 new 9×9 icons, one new ball sprite, a trick button. Haiku, one pass.

## What gets simpler

- The emerald tree stops being "obstacles and ball types"; it becomes "gear". Obstacles (bumpers, crates, chests, shrine) stay passive keystones.
- Counters stop being hidden passives.
- The loadout screen replaces equipping balls from the tree.

## Open questions for the owner

1. **Lightning / Split / Spitter become relics** (you choose 2 of them plus the new ones) — or stay always-on and only *new* effects are relics? I recommend relics: the choice is the point.
2. **Tricks in or out?** A single no-target button fits "one thumb, one shot"; targeting would not. I recommend in, with 1 slot.
3. **Cues: outcome-only** (as above) or allow one new gesture later (a curve/masse shot by dragging an arc)? I recommend outcome-only for v0.4.
4. **Emeralds for gear unlocks** (bosses matter) vs cash? I recommend emeralds, cash for levels.
5. Launch size: 4 cues, 13 relics, 4 tricks, 4 balls. (Owner added Poison/Explosive; Magnet/Decoy/Bulwark deferred.)
6. **"Weapons":** I read it as *cues* — how the shot behaves — because the ball is the weapon in billiards. If you pictured something that fires (turrets, projectiles, a hero that shoots between shots), that's a different system and worth saying now.

## Build order (if approved)

1. Loadout data + slots + equip screen + map modifier icons; convert Lightning/Split/Spitter to relics; Ball slot moves to the loadout screen.
2. Cues (sim: shot behaviours) + 4 relics + icons.
3. Tricks + HUD button + remaining relics.
4. Bot loadout policy, gate re-run, Fable review.
