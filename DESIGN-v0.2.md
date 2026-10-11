# Ball Blaster — v0.2 Combat Pivot (PROPOSAL)

Oct 11, 2026 · Supersedes the energy economy of Design Doc v0.1 where stated. Everything not mentioned here is unchanged.

## The pitch

Same one-thumb billiards shot, but the table is an arena. You are a hero ball with **health**. Enemies are big, show what they will do next, and act after every shot. Hitting an enemy is your attack; where your ball stops is your defence. A run ends when you die or when you kill the stage boss.

**What this fixes**

- *"The table feels vast."* Enemies are 2× the radius and 2–3× the count, placed in formations. A shot line connects with an enemy ~75% of the time on wave 1 (today: ~25%).
- *"I can't get past a 2-combo."* Wider hit corridors, denser boards, and enemies that slide and bump each other on impact. Combos count hits in a chain, not kills.
- *Energy was an abstract clock.* Health is a legible one: you lose because something hit you, and you saw it coming.

**Pillars (revised)**

- One thumb, one shot. Unchanged.
- **Every shot is a leave.** Where you stop decides who can reach you.
- **Hits are defence.** Hitting an enemy staggers it; staggered enemies skip their action.
- The machine runs to its conclusion. Unchanged.
- Short runs: 30 s on run 1, growing to 2–3 min.

## Sizes and density

Internal canvas stays 180×320; table 160×252 = 40,320 px².

| Thing | Radius | Sprite | Area px² |
|---|---|---|---|
| Hero ball | 6 | 13×13 | 113 |
| Grub (summon) | 7 | 15×15 | 154 |
| Grunt, Skirmisher | 9 | 19×19 | 254 |
| Bomber | 10 | 21×21 | 314 |
| Bouncer, Thornback, Cleric | 11 | 23×23 | 380 |
| Broodmother | 12 | 25×25 | 452 |
| Hive | 13 | 27×27 | 531 |
| Brute | 14 | 29×29 | 616 |
| Boss | 18 | 37×37 | 1,018 |

**Hit corridor** (hero radius + enemy radius, doubled): 30–40 px, versus 19 px today.

**On-screen count:** 5 on wave 1, 6 on wave 2, 7–8 on wave 3, boss + 4 on the boss wave. Hard cap 9 regulars + 4 summons. Each stage also carries an **area cap of 10 % of the table**; a wave that rolls big enemies auto-drops a grunt rather than exceed it.

**Coverage** (enemies + hero, Felt):

| Wave | Composition | Area of table | Front-line width |
|---|---|---|---|
| 1 | 4 grunt, 1 skirmisher | 3.4 % | ~65 % |
| 2 | 3 grunt, skirmisher, bouncer, brute | 5.3 % | ~75 % |
| 3 | 2 grunt, skirmisher, bouncer, bomber, broodmother, brute | 6.5 % (7.3 % after a split) | ~85 % |
| Boss | boss, 2 grunt, cleric, brute | 6.5 % | — |

Average over a run ≈ 6 % of the table (≈ 4.5 % of the full screen), versus ~1.2 % today. Note a real pool table is only 1.3 % balls by area; it feels full because the balls are racked. Area is the wrong lens — the numbers that matter are corridor width and front-line width, and both roughly triple.

## Formations

Each wave picks a formation; positions inside it are randomised ±6 px. The hero starts bottom-centre inside a 50 px safe zone that formations never enter.

| Formation | Shape | Teaches |
|---|---|---|
| Rack | Triangle pointing at the hero, 20 px pitch | Straight power shots, cascades |
| Wall | A line across the table, one gap | Threading, bank shots to the back |
| Pincer | Two clusters on the flanks, centre open | Leave: the middle is safe this turn |
| Ring | Circle around a chest or shrine | Reward with a risk |
| Scatter | Today's layout | Rare; appears only from wave 3 |

Big enemies (brute, hive, boss) anchor the back of a formation; grunts and bombers sit in front. Clerics spawn adjacent to a brute when both roll.

## Health, intents, stagger

**Hero:** 20–25 HP base (the balance bot picks; see run-1 projection). Shots are free. No energy anywhere.

**Enemy phase** (after every shot, once every ball has stopped): each enemy executes its visible **intent** in array order, 0.12 s each, 1.2 s max, fast-forward applies. Then every enemy rolls a new intent. Damage from the whole phase applies before death is checked, so the phase always finishes.

| Intent | Glyph | Effect |
|---|---|---|
| Attack N | sword | N damage to the hero **if within melee range** (45 px centre-to-centre) |
| Shoot N | arrow | N damage from anywhere |
| Advance | boots | Moves 30 px toward the hero. No boundary: the safe zone is spawn-only, not a sanctuary |
| Charge | double sword | Next turn's Attack is doubled |
| Guard | shield | Gains a 1-hit shield (Cleric: gives it to an ally) |
| Shove | fist | Knocks the hero 25 px away and deals 1 |
| Detonate | skull | Explodes: 4 to the hero within 60 px, 3 to enemies within 30 px |
| Summon | spiral | Spawns a grub next to it |
| Rest | zzz | Nothing |

**Intents are range-aware:** an Attack rolled while the hero is out of melee range executes as Advance instead. A far grunt never wastes a turn; hiding only buys time.

**Minimum shot power:** any release past the cancel radius fires at ≥ 25 % power. You cannot tap in place; every shot is a leave.

**Range readability:** during aim, each melee intent glyph is red if the hero is currently in range and grey if not. The ball will move, so the lesson becomes *don't end your shot next to red*.

**Stagger:** every contact hit (any ball, shove, lightning) adds 1 stagger. An enemy at or above its threshold **skips its intent this phase** (the intent is kept, not rerolled — you delayed it, not cancelled it). Stagger clears at the end of the phase. Thresholds: grunt 1, skirmisher 1, bouncer 2, broodmother 2, thornback 2, cleric 2, brute 3, hive 3, boss 4.

**Armor:** damage to the hero = attack − armor, minimum 1.

**Shove physics:** enemies are heavy balls, not posts. A hit slides them a short way (high friction, settle < 0.5 s) and an enemy that bumps another deals 1 damage to it and counts as a hit in the chain. Masses: hero 1, grub 2, grunt 4, bouncer 3, brute 10, boss 25 (effectively immovable). Frozen enemies do not slide. This is the one piece to prototype first (jamming risk — see Risks).

## Roster (Felt Hall)

| Enemy | r | HP | Intents (weights) | Stagger | Cash | Notes |
|---|---|---|---|---|---|---|
| Grunt | 9 | 3 | Attack 2 (50), Advance (35), Rest (15) | 1 | 4 | The rack filler |
| Skirmisher | 9 | 3 | Shoot 1 (60), Reposition 30 px (40) | 1 | 5 | The reason you can't just hide |
| Bouncer | 11 | 4 | Shove (50), Rest (50); bounce 1.3 | 2 | 7 | Throws you into brute range |
| Bomber | 10 | 2 | Advance, Advance, Detonate (fixed cycle); explodes on death | 1 | 7 | Kill it early or far away; chains in a rack |
| Broodmother | 12 | 5 | Attack 2 (60), Rest (40); splits into 2 grubs | 2 | 8 | |
| Grub | 7 | 1 | Attack 1 (70), Advance (30) | 1 | 1 | Summon; never counts for wave clear |
| Thornback | 11 | 5 | Attack 2 (50), Guard (50); 1 damage to you per contact | 2 | 9 | The one enemy that punishes spray |
| Brute | 14 | 8 | Charge → Attack 5 (alternating), Advance when out of range; bounce 0.8 | 3 | 14 | Needs 3 hits in one shot to stop |
| Cleric (Warden) | 11 | 5 | Guard-ally (60), Shoot 1 (40) | 2 | 10 | Existing warden behaviour |
| Hive | 13 | 6 | Summon (50), Rest (50); max 4 grubs | 3 | 14 | Existing hive behaviour |

**Elite:** from wave 3, one enemy per wave is an elite: a visible crown, one modifier (Spiky = thorns 1, Hardy = +50 % HP, Swift = Advance 50 px), double cash.

**Boss — Old Eight:** r 18, 40 HP, stagger 4, mass 25. Phase 1 (above 50 %): Attack 4 (range 70) / Advance / Summon grub. Phase 2: Charge → Slam 8 / Shove / Attack 4. Ice boss keeps its cadre shield.

**Existing actives map cleanly:** Warden = Cleric, Hive = Hive, Frost = Frost (a frozen enemy ignores soft hits *and* skips its intent — freeze is now a trade, not pure protection).

## Waves replace the boss meter

A stage is **3 waves + boss**. The next wave spawns in the enemy phase after the previous wave's last regular enemy dies (grubs don't count). Wave arrival is the "CLEAR!" moment, with a small heal (see curve) and a cash bonus of 8 × wave number.

The bottom HUD band shows the wave track `W1 ● W2 ○ W3 ○ BOSS ○` with a marker at the best wave reached on this stage — the ghost line, reborn. The summary shows waves cleared against that best.

Wave budgets per stage (Felt): W1 5 enemies, W2 6, W3 7–8 with one elite, Boss + 4. Later stages scale HP, attack and budget; each new stage should feel like Felt did on arrival.

## What keeps runs short

1. **Every enemy phase hurts.** Every unstaggered enemy with an attack intent deals damage; there is no safe turn except by killing, staggering or positioning. Out-of-range attackers advance instead of idling, the safe zone is spawn-only, and the 25 % minimum shot power means you cannot stall in place with free micro-taps.
2. **No healing at base.** All heals (kill heal, wave rest, shrine, boss heal, combo heal) share the v0.1 diminishing curve, capped at 1× max HP per run. A run can absorb at most ~2× max HP of damage.
3. **Waves escalate.** Wave 2 brings the brute; wave 3 brings the elite and the bomber.
4. **Enrage.** From turn 8 + 2 × wave of a wave (wave 1: turn 10, wave 3: turn 14, boss: turn 16), every enemy's attack rises by 1 per turn, stacking. The HUD shows `RAGE IN 2` two turns ahead. It is the backstop against tank builds, not the primary clock, and it should rarely fire on a new player's first wave.
5. **Boss kill ends the run.** A strong run is capped by content at ~35–40 shots.

**Run 1 projection** (1 damage, Felt): ~2.2 hits per shot on a rack, but hits spread across enemies and grunts need 3–4 turns to close, so pressure starts late. At 25 HP the honest estimate is 11–13 shots, which is longer than the current run 1 and longer than wanted. **Run 1 target: 7–9 shots, ~25–30 s**, wave 2 reached, ~24 cash (4–5 kills + wave bonus) — enough for the first +1 damage (5) and +5 HP (6). Levers, in order: hero HP 20 instead of 25; wave 1 of 4 enemies instead of 5; grunt Attack 3. The balance bot picks, not the doc. Further targets: first boss reached ≈ run 5–7, first boss kill ≈ run 8–11, run length r10 ≈ 70 s, r20 ≈ 2.2 min.

## What makes it interesting

1. **The leave.** Power control comes back as position control: a slam that stops you in a nest of grunts is the new overshoot.
2. **Intents.** The board is a visible priority puzzle: the brute charging for 5 beats the grunt about to rest.
3. **Stagger.** Multi-hit shots are offence and defence at once, and brutes demand focus.
4. **Cascades.** Enemies slide and bump; a bomber in a rack is a free chain reaction; a cleric behind a brute is a bank-shot problem.
5. **Formations.** Every wave has a shape; the shape tells you the shot.
6. **Roles that combine.** Bouncer throws you to the brute; cleric shields the hive; hive feeds grubs to the bomber.
7. **Elites.** One marked threat per wave from wave 3, worth double.
8. **The boss is an intent duel** with phases.
9. **Stage identity through position.** Ice: your leave slides and enemies slide further (the cascade stage). Bog: sticky patches park you in melee range. Clockwork: conveyors move you during the enemy phase.
10. **Ball types are tactics.** Sticky ball = the stun shot: stops dead on first contact, +1 stagger. Heavy ball shoves harder. Light ball is fast but barely moves anything.

## Combos (hits, not kills)

A combo is still one release until every ball stops.

| Combo | Trigger | Reward |
|---|---|---|
| Chain ×N | 3+ hits in one shot (contact, bump, lightning) | +25 % cash on the shot per hit beyond 2 |
| Bank | Wall bounce before a kill | +50 % on that kill |
| Cascade | A kill caused by an enemy bumping another | +1 stagger to all enemies within 40 px |
| Sweep | Wave cleared in a single shot | +50 cash |
| Lockdown | Every live enemy staggered this shot | Heal 2 (curve) |

## Progression (trees reworked)

Cash is kept in full; emeralds from boss kills with repeat decay; stage sub-trees as v0.1.

- **Power** (unchanged): damage, speed damage, lightning, split, spitter.
- **Vitality** (replaces Energy): Max HP +5/level (root, cost 6 first), Armor −1 (max 3), Second Wind (heal 2 per kill), Wave Rest (heal 6 at wave clear), Boss Heal 25/50/75 %, Thick Skin (ranged −1). All heals via the curve.
- **Tactics** (replaces Board): Aim preview 1/2/3 bounces, Heavy Hits (hits ≥ 200 px/s apply 2 stagger), Shove (+50 % knock force), Reflex (the first enemy phase of each wave is skipped), Cash Bonus.
- **Combo**: unlock each combo, then raise its reward.
- **Emerald**: ball types (sticky = stun shot), bumpers (hit → +1 stagger to enemies within 40 px, no heal), crates, chests, shrine (heal 8, curve), stray emeralds.

Removed: Enemy Count, Respawn Rate, Battery, Kill Juice, Boss Juice, Bumper Juice. The board belongs to the stage now; the player buys power, durability and tactics.

## HUD and readability

- Top band: `HP 25/25` at 2× with a red bar where the energy bar was; cash and emeralds on row 2; `RAGE IN n` on the right when relevant.
- Each enemy: one 7×7 intent glyph with a 1× number above the sprite; HP pips below only once damaged. No bars on enemies.
- Bottom band: the wave track with the best-wave marker; the boss HP bar replaces it during the boss wave.
- Enemy phase: enemies that act lunge or flash in sequence; hero flashes red and shakes on damage; floating `-N` in red over the hero.
- Everything respects the Flash and Shake settings.

## Decision log for the pivot

| Change | Reason |
|---|---|
| Energy removed; shots free | Health is a legible clock; enemy phase supplies the pressure |
| Boss meter → waves + best-wave marker | Boss arrival is content, not a counter; keeps the ghost line |
| Enemy Count / Respawn upgrades removed | Dense board from run 1 is the point; players buy power, not danger |
| Per-hit energy cost and armored drain removed | Replaced by thorns (Thornback) and heavy hitters (Brute) |
| Shared diminishing curve kept, now for healing | Unlimited healing is the new infinite-run loophole |
| "Overshoot is the risk" reinterpreted as the leave | Position risk replaces cost risk |
| Enemies slide (light physics) | Cascades are the billiards fantasy; counters the 2-combo wall |
| Split still once per shot | Pacing, not economy |
| Run ends on boss kill | Caps run length; stage clear is a clean ending |
| Safe zone is spawn-only; attacks out of range become Advance; 25 % minimum shot power | Closes the free-micro-tap stall: without these, a player could idle in the bottom of the table until enrage |

## Risks and what to prototype first

1. **Jammed balls.** Bigger balls, clusters and sliding enemies can wedge the hero. Mitigate with overlap push-out, high enemy friction, the stall guard, and a rule that a hero with no clear 20 px of felt around it gets nudged to the nearest open spot before aim. Prototype first with a bot that measures hit-chain distribution and jam rate.
2. **Clutter.** 8 glyphs and numbers at 180 px wide. Prototype the HUD at phone scale before drawing the full roster.
3. **Stalling builds.** Enrage guarantees an end; verify with the progression bot.
4. **Sprite work.** Every enemy is redrawn at ~2× size. That is the largest art task so far.

## Build order

1. Physics + sizes + formations prototype, bot-measured (hit chains, jam rate).
2. HP, intents, stagger, waves, enrage in the sim; balance bot and tests.
3. Sprites at new sizes; intent glyphs.
4. HUD, intent rendering, enemy-phase sequencing, hero damage feedback.
5. Trees reworked; save migration (energy levels refunded as cash).
6. Design review and tuning pass; Ice adapted; then Bog/Clockwork.
