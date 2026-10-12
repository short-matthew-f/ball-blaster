# Implementation decisions (v0.2 combat pivot)

Resolves rule gaps in DESIGN-v0.2.md. Approved by the owner at step 1/2. Do not reopen without a playtest reason.
The v0.1 energy-era decisions (release/hit costs, drains, respawns, boss meter, refills) are retired with energy.

## Physics

| Gap | Decision | Why |
|---|---|---|
| What is a body | Hero, split/spat balls and every live enemy are circles with mass in one physics pass: integrate, rails, obstacles, pairwise impulses, positional relaxation (never leaves bodies intersecting), friction. Frozen enemies are static (infinite mass). | One system for everyone (doc pillar). |
| Masses | Near-equal, pool-break style: hero 1 (x massMult), grub 0.8, grunt/skirmisher/bomber 1.2, bouncer 1, cleric/frost 1.5, broodmother/thornback 2, hive 3, brute 4, boss 8. | Step 1 used grunt 3 / brute 8 / boss 20: the hero rebounded off the rack instead of breaking it (1.3 hits/shot). |
| Friction | Enemies use 1.3x the stage's hero friction and rolling deceleration. | Settles fast; a lighter board still slides. |
| Restitution | Pair restitution = 0.9 x each enemy's kind bounce (bouncer 1.3, brute 0.8, frozen 1.1), capped 1.3. Enemy-rail = 0.6 x kind bounce. | Bouncers bank, others die on the rail. |
| Hit dedupe | A pair's contact counts as a hit only after the pair separated (> 0.5 px) **and** 0.1 s passed since its last counted hit; approach speed must exceed 15 px/s. | No machine-gun damage while overlapping. |
| Bumps | Enemy-enemy impact > 60 px/s: the slower body (pre-impact) is the bumped one and takes 1 damage + 1 stagger; counts in the chain. | Cascades both ways. |
| Ghosts | A body killed mid-shot keeps its momentum for 0.25 s as an invisible ghost that can still bump live enemies (never balls). Removed at shot end. | Otherwise any killing first hit ended the cascade (mid-game chains collapsed). |
| Jam rule | Before aim, the hero is jammed only if none of 64 directions offers a clear 24 px corridor; then it is moved to the nearest such spot (deterministic spiral). Never fires at run start. | "24 px clear all round" would fire constantly (charges end touching the hero). |

## Enemy phase

| Gap | Decision | Why |
|---|---|---|
| Reach | Edge-to-edge gap between enemy and hero. Grunt 110, thornback/broodmother 100, bouncer 140, brute 70, boss 90. | Simple, size-independent. |
| Charge lands | A charger stops dead when its blow lands (hero keeps the full knock). | Heavy chargers ploughed on and pinned the hero into corners (jams 0.6-1.1/run -> <= 0.1). |
| Blocked | A charger that touches any other enemy first loses its charge (and bumps it per the bump rule). v0.3: so does a charger that hits a crate, bumper or chest (shrines are not cover); bankers' line checks count those obstacles too. | Cover. The HUD already painted obstacle cover amber; the sim ignored it. |
| Advance | Rolls 60 px (Swift elite 75 px), launch speed solved from friction; stops 6 px short of the hero instead of shoving it. Skirmisher's Advance is a sideways reposition toward the open side. | An advance is not an attack; shoving caused corner pins. |
| Brute Charge | Brute's Charge -> Attack 5 at 300 px/s does not double (5 is the charged value). Boss Charge -> Slam 8 (= 2 x 4), full-table, banks once. Other kinds: Charge doubles the next Attack. | Brute's printed number is the hit you take. |
| Staggered / frozen | Skip; the intent is kept. Stagger clears at the end of the enemy phase. Frozen enemies ignore hits below 320 px/s (no damage, no stagger), shatter at or above it (thaw + 2x the hit's damage, not a kill; 2 to neighbours), explosions shatter, lightning thaws. Frozen enemies still skip their intent. | Freeze is a trade. v0.3: at 160 px/s with an instant kill, 83% of freezes on Ice MID ended in a free full-cash kill (~15% of kills). |
| Waves | Next wave spawns at the start of the enemy phase after the last regular dies, or at the end of an enemy phase that emptied the board. New enemies act from the next phase; the arrival phase does not count toward enrage. Reflex skips each wave's first acting phase. | No empty aim states. |
| Arrivals are solid at aim | The enemy phase does not end while any live enemy is still shimmering (wave, boss, cadre, summons, splits). A wave that becomes due at the end of a phase spawns then and the phase waits out its shimmer. | The player never sees, or shoots through, a ghost board. |
| Boss spot | The boss takes its formation spot even if the hero is there; the hero is then moved to the nearest free spot (emits `jam` fx, not counted as a jam). | The boss anchors the formation; the hero is the cheap thing to move. |
| Overtime enrage | In Overtime, enrage starts at turn 6 of every Overtime wave (flat), +1 attack per turn. Stage waves keep 8 + 2 x wave. | 8 + 2 x wave never fired in Overtime (wave 5+ means turn 18+). |
| Thorns | Thornback (and Spiky elites) prick the hero for 1 on every counted hero contact, in the shot and in the enemy phase, except the contact that lands the thornback's own charge. | |
| Ice | Frost freezes the nearest ally within 60 px for 3 phases (max 2 frozen). Rime Golem arrives with 3 cadre; it takes no damage while any lives. | v0.1 active tier, adapted. |
| Boss HP / Guard (v0.3) | Bosses keep their def HP (exempt from the stage hpScale: Rime Golem 40, not 60). A Cleric's Guard never targets the boss. | LATE bot boss waves ran 12-15 turns vs 5 for regular waves (a shield eats a whole hit; Golem 60 HP behind 3 cadre). |
| Bomber blast (v0.3) | A bomber killed by a hit deals 2 to the hero within range; its own Detonate still deals 4. | Every contact kill sits inside the radius: the 4-HP death blast was a flat tax on killing bombers. |
| Elites (v0.3) | On an elite wave, the elite is a random regular of the wave (after the area cap), not a fixed slot. | The fixed slot made a Hardy brute (18 HP at W3) the elite every run. |

## Combos and heals

| Gap | Decision |
|---|---|
| Chain | 3+ hits in one shot: + comboChain x shot cash per hit beyond 2, capped at +100 % of the shot's cash (at least 1 per extra hit). |
| Bank | + comboBank x cash of kills made by the hero after a rail bounce. |
| Cascade | A kill caused by a bump: +1 stagger to enemies within 50 px (instant). |
| Sweep | comboSweep cash when every regular of a wave died within the shot just played. |
| Lockdown | comboLockdown HP when every live enemy is staggered or frozen at shot end. |
| Heals | Wave clear (waveHeal), shrine (shrineHeal), healOnKill, bossHeal (x maxHp at arrival) and Lockdown all use one diminishing curve, total <= 1x maxHp per run. |
| Armor | Damage to the hero = attack - armor, min 1. rangedResist applies to Shoot first (min 1). |

## Balance (step 3)

| Gap | Decision | Why |
|---|---|---|
| Grunt stagger | Grunt staggerAt 2 (a hit plus a bump stops it; one hit does not). Skirmisher and grub stay at 1. | At 1, every hit (even a glancing bump) cancelled the nearest grunt's turn, so the front rank never attacked: run 1 took 16-17 shots at ~1.2 damage per enemy phase. |
| Grunt / skirmisher | Grunt Attack 3, weights Attack 70 / Advance 25 / Rest 5. Skirmisher Shoot 2. Hero 16 HP (owner: fragile). Wave 1 = 2 grunts + skirmisher. | Run 1 lands at ~9 shots with ~2.1 damage per enemy phase. |
| Formation weights | Wave 1 always Rack; wave 2 Rack 60 / Wall 40; wave 3 Rack 30 / Wall 30 / Pincer 25 / Ring 15; boss wave Pincer 50 / Ring 50; Scatter only in Overtime (wave weights + Scatter 20). | Racks break for 3-4 hits; walls and pincers give 1-2. Lifts hits/shot toward 2 without touching physics. |
| Economy / HP scaling | Felt cashScale 0.5. Big Stripe 60 HP. Regular enemy HP x(1 + 0.25 x (wave - 1)) within a stage; Overtime wave k adds +2 HP per enemy (doc: +1) and +k attack. | Progression bot: first boss reached run ~4, first kill run ~7 (was 3 / 4). |
| Stage scaling (v0.3 step 2b) | Per global index n: HP x1.22^n, attack x1.15^n, cash x1.22^n, with world (Ice 1.8/2.6, worlds 3-6 2.0/1.8) and slot (slot 3 1.2/1.1, slot 4 1.05/1.1) multipliers; Hardy HP x1; Ranged +2 skirmishers, Shoot +1. 16-seed bot: runs-to-clear medians 5 4 7 4 / 6 8 4 4 / 4 9 5 5 (w1s1..w3s4), stage-11 worst 17, 94 % of cash earned by run 60 spent on the tree. w4 walls (rtc ~88 at w4s1): the tree is bought out (about 1 open node) until world 4's graft unlocks. | Bot gate; details under "Stages, scaling and modifiers". |

## Economy (v0.3)

| Gap | Decision | Why |
|---|---|---|
| Ice cash | Ice cashScale 0.7 (was 2.2; Felt 0.5). | Switching to Ice at unlock paid ~33k/run at r12 and emptied the 37k tree by r13. |
| Wave-clear cash | 8 x min(wave, 4): Overtime waves pay the boss-wave amount, not more each wave. | Unbounded in Overtime. |
| Overtime cash | 2x for the first 5 Overtime waves, then 1x (HUD shows X2 only while it applies). | 85-90 % of late-run cash came from long Overtime streaks. |
| Chain cap | See Combos: +100 % max. | At 3.6-5.4 hits/shot and +125 % per extra hit (max level), Chain paid several times the shot cash. |
| Cash sink | **Open design question.** Once the tree is maxed cash has no use; candidates are a Challenge toggle or prestige. Not designed yet. | |

## Stages, scaling and modifiers (v0.3 step 2)

| Gap | Decision | Why |
|---|---|---|
| Stage data | Generated by `core/worlds.ts` `makeStage(id)` (memoised) from `WORLDS` (physics, roster, base waves, hazard, boss archetype, `hpMult`/`atkMult`). Ids `w1s1`..`w6s4`, loops `l1w1s1`; `globalIndex` 0..23, loops continue at 24. `stageById` delegates; the hand-written STAGES list is gone. Worlds 3-6 are stubs (Felt roster/waves, doc physics, own names/tints/boss names). | Content scales with worlds, not stages. |
| Scaling | Regular HP x `HP_GROWTH`^n x world `hpMult`; attack (intents, blasts, thorns) x `ATK_GROWTH`^n x world `atkMult`, rounded, min 1, before the Overtime bonus (the shown number is the hit); kill cash 0.5 x `CASH_GROWTH`^n; wave bonus, chests, crates and Sweep x `CASH_GROWTH`^n; first boss kill 3 + n emeralds. Bot-tuned (step 2b, 16 seeds, tree with per-world DAMAGE/MAX HP tiers): HP 1.22, ATK 1.15, CASH 1.22 (doc 1.28 / 1.10 / 1.28; step 2 had 1.16 / 1.17 / 1.16 against a tree with no damage past 6). | With damage tiers in every graft the step-2 values let the bot clear w3 in 1-2 runs; 1.28 overshot w4. HP growth past the hero's damage only lengthens runs; attack growth makes a stage harder. |
| Boss HP | Boss HP = archetype HP x slot HP multiplier x `HP_GROWTH`^n (no world `hpMult`, no Hardy). Supersedes "Bosses keep their def HP". | A fixed 60-HP boss next to scaled regulars would be a pushover. |
| World / slot difficulty | Per world: Ice x1.8 HP / x2.6 attack; worlds 3-6 x2.0 / x1.8 (Felt 1). Per slot (`SLOT_HP_MULT` / `SLOT_ATK_MULT`): slot 3 x1.2 / x1.1, slot 4 x1.05 / x1.1, slots 1-2 x1 (boss HP takes the slot HP multiplier too). | Ice is intrinsically soft (0.92 rails, frozen allies skip turns). Without the slot terms slot 3 (moves boss, elites) cleared in 1-2 runs and the plain slot 1 after a two-modifier slot 4 in 1-2. |
| Slots | 1 plain / 2 one modifier, boss phases + cadre / 3 one modifier, elites from wave 2, phases + moves / 4 two modifiers, every either/or slot draws from the world roster, all traits. Loops: two modifiers, all traits, Overtime cash 1x. A boss's signature trait is always on (Rime Golem: cadre; Mainspring: moves; House: cadre + moves). | Doc table; the Golem's cadre is its identity. |
| Modifier pick | Per world and loop: a seeded shuffle of the 12-pool (Frost World excluded on Ice), dealt 0/1/1/2 (loops 2/2/2/2), so never twice in a world. | Deterministic, no repeats. |
| Modifiers | Ranged: grunts -> skirmisher/skirmisher/cleric, +2 skirmishers per wave and Shoot +1 (`StageDef.shootBonus`) (the swap alone softened waves: w2s2 cleared in 1-2 runs). Bombers: +1 bomber per wave. Extra Elite: +1 elite per wave (`WaveDef.elites`). Thin Rails: wall bounce 0.6. Big Rack: +1 roster pick per wave (no brute/hive). Early Boss: boss after 2 waves. Wardens: first grunt -> cleric/thornback. Swift: Advance x1.5. Hardy: -20 % slots (grunts first), HP x1 (`HARDY_MOD_HP`; doc +25 %, bot-tuned down: w3s4 Hardy + Big Rack had a 22-104-run worst seed). Dark: `RunState.dark`; `intentVisible(s, t)` = within max(reach, 80) px. Hive/Frost World: one hive/frost per wave (replaces a grunt). | Doc pool. |
| Early Boss results | `RunResult.wave`/`wavesCleared` are normalised to the 3 + boss track (boss = 4); the boss wave keeps the wave-4 enrage clock. | bestWave 4 must mean "boss killed" on every stage. |
| Cadre / moves | Cadre: `boss.cadre` minions (archetype: Felt 2, Golem 3, House 3) whenever the boss has the trait. Moves: after an intent that does not launch (summon, charge, rest) the boss Advances, or repositions sideways when already close. | Generalises the Golem's cadre; doc "moves". |
| Hazards | `Hazard { kind, x, y, r }` on StageDef/RunState. Ice patches (3, r 18-26, seeded by n) on world 2: friction and rolling deceleration x0.1 inside. Conveyor/mud/lava/slot: type only. | Strict zero friction lets a slow body idle inside a patch until the stall guard; x0.1 still reads as frictionless. |
| Gate | Multi-stage bot, 16 seeds, no waivers: median runs-to-clear in [4, 9] for w1s1..w3s4, stage-11 worst seed <= 20, and no seed sits more than 3 runs on a gated stage without buying a node. w4 is a smoke check (reported only). | DESIGN-v0.3 release gate. |
| Enrage backstop | An enraged Attack beyond reach charges anyway (banking round cover); from rage 5 an attacker whose line is covered strikes instantly (tracer + hit). | A brute caged behind three bumpers out of reach made a 600-shot run (never-ending) at w4. |

## Scope

- Felt and Ice stages; Clockwork and Bog deferred.
- All art and sound are original and generated in code.
