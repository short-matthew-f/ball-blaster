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
| Blocked | A charger that touches any other enemy first loses its charge (and bumps it per the bump rule). | Cover. |
| Advance | Rolls 60 px (Swift elite 75 px), launch speed solved from friction; stops 6 px short of the hero instead of shoving it. Skirmisher's Advance is a sideways reposition toward the open side. | An advance is not an attack; shoving caused corner pins. |
| Brute Charge | Brute's Charge -> Attack 5 at 300 px/s does not double (5 is the charged value). Boss Charge -> Slam 8 (= 2 x 4), full-table, banks once. Other kinds: Charge doubles the next Attack. | Brute's printed number is the hit you take. |
| Staggered / frozen | Skip; the intent is kept. Stagger clears at the end of the enemy phase. Frozen enemies ignore hits below 160 px/s (no damage, no stagger), shatter at or above it (kill + 2 to neighbours), explosions shatter, lightning thaws. | Freeze is a trade. |
| Waves | Next wave spawns at the start of the enemy phase after the last regular dies, or at the end of an enemy phase that emptied the board. New enemies act from the next phase; the arrival phase does not count toward enrage. Reflex skips each wave's first acting phase. | No empty aim states. |
| Arrivals are solid at aim | The enemy phase does not end while any live enemy is still shimmering (wave, boss, cadre, summons, splits). A wave that becomes due at the end of a phase spawns then and the phase waits out its shimmer. | The player never sees, or shoots through, a ghost board. |
| Boss spot | The boss takes its formation spot even if the hero is there; the hero is then moved to the nearest free spot (emits `jam` fx, not counted as a jam). | The boss anchors the formation; the hero is the cheap thing to move. |
| Overtime enrage | In Overtime, enrage starts at turn 6 of every Overtime wave (flat), +1 attack per turn. Stage waves keep 8 + 2 x wave. | 8 + 2 x wave never fired in Overtime (wave 5+ means turn 18+). |
| Thorns | Thornback (and Spiky elites) prick the hero for 1 on every counted hero contact, in the shot and in the enemy phase, except the contact that lands the thornback's own charge. | |
| Ice | Frost freezes the nearest ally within 60 px for 3 phases (max 2 frozen). Rime Golem arrives with 3 cadre; it takes no damage while any lives. | v0.1 active tier, adapted. |

## Combos and heals

| Gap | Decision |
|---|---|
| Chain | 3+ hits in one shot: + comboChain x shot cash per hit beyond 2 (at least 1 per extra hit). |
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

## Scope

- Felt and Ice stages; Clockwork and Bog deferred.
- All art and sound are original and generated in code.
