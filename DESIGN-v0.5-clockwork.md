# Ball Blaster — v0.5: World 3, Clockwork Works

Oct 12, 2026 · Shipped. The Fable spec the build was made from, with the owner decisions layered on top (see DECISIONS.md "World 3" for the rules as built).

**Departures from this spec as built:** the counter is named **CLEATS** (Ice already has Ice Grip; stat `beltGrip`, icon `icon_cleats`); the gear's +35° turn is capped at 75° from the outward normal (uncapped turns orbited); The Mainspring has HP 70 (the only lever that fixed w3s4); world 3 hpMult 1.8 / atkMult 1.3.

---

# World 3 — Clockwork Works

## 1. Physics
`WORLDS[2]` already has 0.6/70/0.8, tint `y`; only `hpMult` 2.2 / `atkMult` 1.4 may move.

## 2. Hazards
`Hazard` gains `w?,h?,dx?,dy?`; `HazardKind` += `'gear'`.

**Conveyor** `{kind:'conveyor',x,y,r:0,w,h,dx,dy}` (centre; unit direction). Horizontal 100×20, vertical 20×80; 1/2/2/3 per slot (loops 3); even k horizontal; sign 50/50, `Rng(0xbe17+7919·(n+1))`. Inside x∈[16,164], y∈[50,222] (above the spawn zone), ≥12 px from belts, ≥8 from the gear; 200 tries.

**Sweep** `BELT_SHIFT=24`. `startEnemyPhase` (after freezes, poison, `advanceWave`) sets `beltAt=t+0.3` (and `enemyNext=beltAt`) if any live centre is on a belt; `enemyStep` sweeps at `beltAt` before the queue. Owner: first belt (hazard order) containing the centre; front-most-first along `(dx,dy)`; slide ≤24 px to first contact (rail/obstacle/live body); frozen (blockers), ghost, dead skipped; `relaxAll`. Hero 24/12/0 for `stats.beltGrip` 0/1/2. Rolling bodies, chill, poison unaffected. Fx `{t:'belt',x,y,dx,dy}` per displaced body. Wound: two passes, one hold.

**Gear** `{kind:'gear',x,y,r:14}`, 0/1/1/1 per slot, x∈[50,130], y∈[94,160]. `createRun` makes it an `Obstacle {kind:'gear',hp:Infinity}` before `spawnWave`, dropping it from `s.hazards`; `OBSTACLE_R.gear=14`; `hitObstacle` ignores it. Contact (`collideStatic` e 0.9, min kick 80): rotate the exit velocity +35° (atan2, y-down), fx `{t:'gearSpin',x,y}`; enemies get `addStagger(t,1,fx,s)` once per phase (`pairKey`+`eligible/markHit`), no damage or chain; chargers lose their charge. Not a Ricochet rail.

**Grip** `g3_counter`: `GraftSpec` counter override `{name,desc,max,icon,apply}`: GRIP, max 2, `icon_grip`, `s.beltGrip=l` (no +2 HP); `BASE_STATS.beltGrip=0`; `WORLD_ONLY`.

## 3. Enemies
`TargetKind` += `cog`,`tinker`; `IntentType` += `repair`,`wind`.

**cog**: hp 4, r 13, mass 1.5, cash 9, bounce 1.2, staggerAt 2, chargeSpeed 280, reach 140; attack 3 (55), advance (30), rest (15). `chargeDir(bank=true)`. `Target.railHits` resets at launch; the second rail contact while `chargeDmg>0` stops it (`vx=vy=0`, `chargeDmg=0`); rail restitution 0.6×1.2, never `stageDef.wallBounce`. `enemyBump`: a charging cog is never the bumped body and keeps its charge; the other takes the flat bump (1 damage, +1 stagger).

**tinker**: hp 3, r 12, mass 1.2, cash 8, bounce 1, staggerAt 1, chargeSpeed 0, reach 0; repair (60), shoot 1 (40). Repair rolls only with a damaged ally (not self/boss/cadre) within 70 px edge gap, else Shoot; executes on the largest `maxHp−hp` in range (tie: lowest id): heal `min(missing,ceil(2·hpScale))`, fx `{t:'repair',x,y,amount}`; none → Rest.

**Waves** `CLOCK_WAVES` (Felt weights): W1 `grunt,cog,tinker` · W2 `grunt,cog,tinker,[bouncer,thornback],brute` · W3 `cog,tinker,bomber,[broodmother,hive],brute` (elite 4) · Boss `boss,tinker,cog`. Roster `[...FELT_ROSTER,'cog','tinker']`. Max 2 cogs per regular wave (extras → grunts).

## 4. Boss — The Mainspring
`BossArchetype.kit:'stripe'|'golem'|'mainspring'` keys `rollIntent`/`checkBossPhase`. r 23, hp 60, staggerAt 4, mass 8 (`TARGET_DEFS.boss`). Signature `moves`.

Phase 1 (>50 %): Attack 4 reach 90 (50) / Advance (25) / Wind (25): sets `s.beltWound`, next sweep twice, then clears.
Phase 2 (≤50 %): on entry (`checkBossPhase`, once) negate every belt's `dx,dy` in `s.hazards`, fx `{t:'beltReverse'}`. Charged → Slam 8 banking once; else Charge (40) / Summon cog (30; weight 0 at 2 live boss cogs) / Attack 4 (30). Summoned cogs: `summon=true`, `Target.cashBase=1` (`kill` reads it), own cap, not `SUMMON_CAP`.
Moves: after Wind, Charge or Summon it soft-rolls `MAINSPRING_MOVE_DIST=40` at the hero (sideways inside standoff); other bosses untouched. Slot traits: 1 phases+moves · 2 +cadre 2 · 3 = 1 · 4 all.

## 5. Modifier rules
Thin Rails: cog ricochets ignore it. Dark: arrows and drift ghost always drawn. Frost World: frozen enemies block belts. Time Stop/Reflex: belts run.

## 6. Telegraphs and render
`belt`/`belt_b` 8×8 arrow tiles along the rect, rotated k·π/2 per direction, alternating every 0.2 s (static with `settings.flash` off). Hold: belt rim alpha 1; `belt` fx: three fading afterimages from (x−dx,y−dy). Aim: dotted hero outline at `beltPreview(s)` (exported, Grip-adjusted) when on a belt. `gear`/`gear_b` 29×29, 4 fps; `gearSpin`: spark. `cog` 27×27 (toothed ring, eye); `tinker` 25×25 (goggles, wrench); `boss_mainspring` 47×47 (spring, brass casing, dial; `enemySprite` world 3, `bossTint` worlds ≥4); `icon_grip` 9×9 cleated sole; `intent_repair` wrench, `intent_wind` key. `repair`: green +N. `beltReverse`: belts flash white 0.4 s, arrows flip, shake per `settings.shake`.

## 7. Guardrails and tests
Bounded phase: instant moves, one 0.3 s hold, `MAX_ENEMY_SECONDS` unchanged; sweep uses no rng.

Tests (`sim.test.ts`): (1) `makeStage` w3s1–4: belts 1/2/2/3, gears 0/1/1/1, in-bounds above the spawn zone, no overlaps, deterministic. (2) Right belt, hero + resting grunt: +24 x and one `belt` fx each; a frozen enemy stays; a body 1 px from the rail moves 1; `maxOverlap≤0.01`. (3) `beltGrip` 1: hero 12; 2: 0; enemies 24. (4) Gear: hero exits 35°±3° off the reflection, no damage, `gearSpin`; a charger through it deals nothing, +1 stagger. (5) Cog through two grunts: each takes 1, hero takes scaled 3, second rail stops it; tinker heals the most-damaged ally, never itself; none in range → Shoot. (6) Mainspring: Wind → 48 px sweep; 50 % negates every belt, fx `beltReverse`; boss cogs cap at 2, never count for clear.

Gate (`proto.test.ts`, unchanged): stages 8–11 noisy medians ∈ [4,9], w3s1 ≥ 2, stage-11 worst ≤ 20, perfect ≥ 2; only world-3 `hpMult`/`atkMult` move; stages 0–7 reproduce `6 5 5 6/4 5 9 6`.

## Why it's fun
Every shot is a leave and the Works taxes the leave: read the arrows, stop a belt-width short, and the board carries you (or the rack) the rest of the way before anyone acts. Cogs chew their own formation when baited across it, and the Mainspring rewrites the belts mid-fight.

## Riskiest bits
1. Sweep jams pinning the hero on a rail (watch bot `jams`).
2. Cog friendly fire staggering its own rack: w3 medians below 4 → cut its Attack weight to 45 first.
3. Reversal reading as a bug: `beltReverse` must land with `bossPhase`.
