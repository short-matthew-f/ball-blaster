# Ball Blaster — v0.2 Combat Pivot

Oct 11, 2026 · Approved direction. Supersedes Design Doc v0.1 wherever they disagree; nothing from v0.1 is protected (owner's call). Decisions from the Q&A are marked **[decided]**.

## The pitch

Same one-thumb billiards shot, but the table is an arena. You are a hero ball with **health**. Enemies are big, show what they will do next, and act after every shot. Hitting an enemy is your attack; where your ball stops is your defence. A run ends when you die or when you kill the stage boss.

**What this fixes**

- *"The table feels vast."* Enemies are 2× the radius and 2–3× the count, placed in formations. A shot line connects with an enemy ~75% of the time on wave 1 (today: ~25%).
- *"I can't get past a 2-combo."* Wider hit corridors, denser boards, and enemies that are balls: they slide, bump each other, and attack by rolling at you. Combos count hits in a chain, not kills.
- *Energy was an abstract clock.* Health is a legible one: you lose because something hit you, and you saw it coming.

**Pillars (revised)**

- One thumb, one shot. Unchanged.
- **Every shot is a leave.** Where you stop decides who can reach you.
- **Hits are defence.** Hitting an enemy staggers it; staggered enemies skip their action.
- **Everyone plays billiards.** Enemies move and attack by rolling, with the same physics as you. Cover, banks and cascades work both ways.
- The machine runs to its conclusion. Unchanged.
- Short runs: 30 s on run 1, growing to 2–3 min.

## Sizes and density

Internal canvas stays 180×320; table 160×252 = 40,320 px².

**[decided]** Everything lives in the 24–48 px range. Sprites are odd-sized (2r+1).

| Thing | Radius | Sprite | Area px² |
|---|---|---|---|
| Hero (a character, with a face) | 12 | 25×25 | 452 |
| Grub (summon) | 10 | 21×21 | 314 |
| Grunt, Skirmisher | 12 | 25×25 | 452 |
| Bomber | 13 | 27×27 | 531 |
| Bouncer, Thornback, Cleric | 14 | 29×29 | 616 |
| Broodmother | 15 | 31×31 | 707 |
| Hive | 17 | 35×35 | 908 |
| Brute | 19 | 39×39 | 1,134 |
| Boss | 23 | 47×47 | 1,662 |

**Hit corridor** (hero radius + enemy radius, doubled): 48–70 px, versus 19 px today. Hitting *something* is easy; the game is what you hit, where you stop, and what cascades.

**On-screen count:** 4 on wave 1, 5 on wave 2, 5 on wave 3 (+ summons), boss + 2–3 on the boss wave. Hard cap 6 regulars + 3 summons. Each stage also carries an **area cap of 10 % of the table** for regulars (summons exempt); a wave that rolls big enemies drops a grunt rather than exceed it.

**Coverage** (enemies + hero, Felt):

| Wave | Composition | Area of table | Front-line width |
|---|---|---|---|
| 1 | 3 grunt, 1 skirmisher | 5.6 % | ~63 % |
| 2 | 2 grunt, skirmisher, bouncer, brute | 8.8 % | ~85 % |
| 3 | grunt, skirmisher, bomber, broodmother, brute (elite) | 9.2 % (10.8 % after a split) | ~90 % |
| Boss | boss, grunt, cleric | 7.9 % | — |

Average over a run ≈ 8 % of the table (≈ 6 % of the full screen), versus ~1.2 % today. A real pool table is only 1.3 % balls by area and feels full because the balls are racked, so area is the wrong lens: corridor width (×2.5) and front-line width (×3) are what fix "vast". These sizes are a **prototype target**: step 1 of the build renders them at phone scale and we look before the full sprite pass.

## Formations

Each wave picks a formation; positions inside it are randomised ±6 px. The hero starts bottom-centre inside a 60 px spawn-only zone that formations never enter.

| Formation | Shape | Teaches |
|---|---|---|
| Rack | Triangle pointing at the hero, 27 px pitch | Straight power shots, cascades |
| Wall | A line across the table, one gap | Threading, bank shots to the back |
| Pincer | Two clusters on the flanks, centre open | Leave: the middle is safe this turn |
| Ring | Circle around a chest or shrine | Reward with a risk |
| Scatter | Today's layout | Rare; appears only from wave 3 |

Big enemies (brute, hive, boss) anchor the back of a formation; grunts and bombers sit in front. Clerics spawn adjacent to a brute when both roll.

## Health, intents, stagger

**Hero:** 20 HP base **[decided: fragile]**. Flat contact damage, 1 base, upgradeable; speed bonus stays an upgrade **[decided: flat]**. Shots are free. No energy anywhere.

**Enemy phase** (after every shot, once every ball has stopped) **[decided: enemies use billiard mechanics]**: every unstaggered enemy executes its visible **intent**. Melee intents are *rolls*: the enemy launches itself like a shot, with the same physics as the hero. Launches go in array order 0.15 s apart, everything resolves together, and the phase ends when every ball has stopped (stall guard 4 s; fast-forward applies). Then every enemy rolls a new intent. Death is checked after the phase, so it always finishes.

- **Attack N** is a charge at the hero's current position at that enemy's charge speed. It deals N on its first contact with the hero during the charge. A charge that doesn't reach or is blocked deals nothing. Anything in the line is cover: a brute, a crate, a bumper, another grunt. A charger that bumps another enemy deals it 1 (friendly fire is physics).
- Contacts move the hero. A brute's charge knocks a mass-1 hero a long way; the leave you set up can be ruined, and that is the enemy's version of your shot.
- **Reach** replaces melee range: how far a charge carries (grunt ~90 px, brute ~70, bouncer ~140 and it banks off rails).
- **Advance** is a soft roll toward the hero (carries ~40 px), used when the hero is beyond reach.
- **Shoot N** (ranged) is instant and unblockable, with a tracer. Skirmisher, cleric.

| Intent | Glyph | Effect |
|---|---|---|
| Attack N | sword | Charges the hero; N damage on first contact within reach |
| Shoot N | arrow | N damage from anywhere, instant |
| Advance | boots | Soft roll toward the hero, ~40 px. No boundary: the spawn zone is not a sanctuary |
| Charge | double sword | Next turn's Attack is doubled and the charge is faster |
| Guard | shield | Gains a 1-hit shield (Cleric: gives it to an ally) |
| Detonate | skull | Explodes: 4 to the hero within 60 px, 3 to enemies within 40 px |
| Summon | spiral | Spawns a grub next to it |
| Rest | zzz | Nothing |

**Intents are reach-aware:** an Attack rolled while the hero is beyond reach executes as Advance instead. A far grunt never wastes a turn; hiding only buys time.

**Minimum shot power:** any release past the cancel radius fires at ≥ 25 % power. You cannot tap in place; every shot is a leave.

**Reach readability:** during aim, each melee intent glyph is red if the hero is currently within that enemy's reach with a clear line, amber if within reach but blocked by cover, grey if out of reach. The ball will move, so the lesson becomes *don't end your shot in front of red*.

**Stagger:** every contact hit (any ball, bump, lightning) adds 1 stagger. An enemy at or above its threshold **skips its intent this phase** (the intent is kept, not rerolled — you delayed it, not cancelled it). Stagger clears at the end of the phase. Thresholds: grunt 1, skirmisher 1, bouncer 2, broodmother 2, thornback 2, cleric 2, brute 3, hive 3, boss 4.

**Armor:** damage to the hero = attack − armor, minimum 1.

**Ball physics for everyone [decided]:** enemies are balls with mass and friction, not posts. Your hit slides them (settle < 0.7 s) and an enemy that bumps another deals it 1 and counts as a hit in your chain. Their charges slide you. Masses: hero 1, grub 1.5, grunt 3, bouncer 2 (bounce 1.3), brute 8, boss 20. Enemy friction is 1.5× the hero's so boards settle fast. Frozen enemies do not slide. This is the piece to prototype first (jamming risk — see Risks).

## Roster (Felt Hall)

| Enemy | r | HP | Intents (weights) | Stagger | Cash | Notes |
|---|---|---|---|---|---|---|
| Grunt | 12 | 3 | Attack 2 (50), Advance (35), Rest (15) | 1 | 4 | The rack filler |
| Skirmisher | 12 | 3 | Shoot 1 (60), Reposition (soft roll sideways) (40) | 1 | 5 | The reason you can't just hide |
| Bouncer | 14 | 4 | Attack 1 (60), Rest (40); bounce 1.3, charge banks off rails | 2 | 7 | Weak hit, huge knock: throws you in front of the brute |
| Bomber | 13 | 2 | Advance, Advance, Detonate (fixed cycle); explodes on death | 1 | 7 | Kill it early or far away; chains in a rack |
| Broodmother | 15 | 5 | Attack 2 (60), Rest (40); splits into 2 grubs | 2 | 8 | |
| Grub | 10 | 1 | Attack 1 (70), Advance (30) | 1 | 1 | Summon; never counts for wave clear |
| Thornback | 14 | 5 | Attack 2 (50), Guard (50); 1 damage to you per contact | 2 | 9 | The one enemy that punishes spray |
| Brute | 19 | 8 | Charge → Attack 5 (alternating), Advance when out of reach; bounce 0.8 | 3 | 14 | Needs 3 hits in one shot to stop; also the best cover on the board |
| Cleric (Warden) | 14 | 5 | Guard-ally (60), Shoot 1 (40) | 2 | 10 | Existing warden behaviour |
| Hive | 17 | 6 | Summon (50), Rest (50); max 4 grubs | 3 | 14 | Existing hive behaviour |

**Elite:** from wave 3, one enemy per wave is an elite: a visible crown, one modifier (Spiky = thorns 1, Hardy = +50 % HP, Swift = Advance 50 px), double cash.

**Boss — Old Eight:** r 23, 40 HP, stagger 4, mass 20. Phase 1 (above 50 %): Attack 4 (reach 90) / Advance / Summon grub. Phase 2: Charge → Slam 8 (a full-table charge that banks once) / Attack 4. Ice boss keeps its cadre shield.

**Existing actives map cleanly:** Warden = Cleric, Hive = Hive, Frost = Frost (a frozen enemy ignores soft hits *and* skips its intent — freeze is now a trade, not pure protection).

## Waves replace the boss meter

A stage is **3 waves + boss**. The next wave spawns in the enemy phase after the previous wave's last regular enemy dies (grubs don't count). Wave arrival is the "CLEAR!" moment, with a small heal (see curve) and a cash bonus of 8 × wave number.

The bottom HUD band shows the wave track `W1 ● W2 ○ W3 ○ BOSS ○` with a marker at the best wave reached on this stage — the ghost line, reborn. The summary shows waves cleared against that best.

Wave budgets per stage (Felt): W1 4 enemies, W2 5, W3 5 with one elite, Boss + 2–3. Later stages scale HP, attack and budget; each new stage should feel like Felt did on arrival.

## What keeps runs short

1. **Every enemy phase hurts.** Every unstaggered enemy with an attack intent deals damage; there is no safe turn except by killing, staggering or positioning. Out-of-range attackers advance instead of idling, the safe zone is spawn-only, and the 25 % minimum shot power means you cannot stall in place with free micro-taps.
2. **No healing at base.** All heals (kill heal, wave rest, shrine, boss heal, combo heal) share the v0.1 diminishing curve, capped at 1× max HP per run. A run can absorb at most ~2× max HP of damage.
3. **Waves escalate.** Wave 2 brings the brute; wave 3 brings the elite and the bomber.
4. **Enrage.** From turn 8 + 2 × wave of a wave (wave 1: turn 10, wave 3: turn 14, boss: turn 16), every enemy's attack rises by 1 per turn, stacking. The HUD shows `RAGE IN 2` two turns ahead. It is the backstop against tank builds, not the primary clock, and it should rarely fire on a new player's first wave.
5. **Boss kill clears the stage and starts Overtime [decided: bonus phase].** Overtime waves keep coming with +1 HP and +1 attack per enemy per wave and pay 2× cash until you die. Nothing but cash carries from Overtime; enrage still applies. The run is still capped by death, and a strong run lands around 40–50 shots.

**Run 1 projection** (20 HP, 1 damage, Felt): with 48 px corridors ~2.5 hits per shot on a rack, but hits spread across enemies and grunts need 2–3 turns to close, so pressure starts late. **Run 1 target: 7–9 shots, ~25–30 s**, wave 2 reached, ~20 cash (3–4 kills + wave bonus) — enough for the first +1 damage (5) and +5 HP (6). If the bot says run 1 is long, the remaining levers are a 3-enemy first wave and grunt Attack 3. The balance bot picks, not the doc. Further targets: first boss reached ≈ run 5–7, first boss kill ≈ run 8–11, run length r10 ≈ 70 s, r20 ≈ 2.2 min.

## What makes it interesting

1. **The leave.** Power control comes back as position control: a slam that stops you in a nest of grunts is the new overshoot.
2. **Intents.** The board is a visible priority puzzle: the brute charging for 5 beats the grunt about to rest.
3. **Stagger.** Multi-hit shots are offence and defence at once, and brutes demand focus.
4. **Cascades, both ways.** Enemies slide and bump; a bomber in a rack is a free chain reaction; a cleric behind a brute is a bank-shot problem. And a grunt that charges you can clip the brute on the way and stagger it for you.
5. **Formations.** Every wave has a shape; the shape tells you the shot.
6. **Roles that combine.** Bouncer knocks you in front of the brute; cleric shields the hive; hive feeds grubs to the bomber.
7. **Cover.** Charges are blocked by whatever is in the line. Parking behind the brute is a real defence against grunts, and a terrible one against the brute.
8. **Elites.** One marked threat per wave from wave 3, worth double.
9. **The boss is an intent duel** with phases.
10. **Stage identity through position.** Ice: your leave slides and enemies slide further (the cascade stage). Bog: sticky patches park you in melee range. Clockwork: conveyors move you during the enemy phase.
11. **Ball types are tactics.** Sticky ball = the stun shot: stops dead on first contact, +1 stagger. Heavy ball shoves harder. Light ball is fast but barely moves anything.

## Combos (hits, not kills)

A combo is still one release until every ball stops.

| Combo | Trigger | Reward |
|---|---|---|
| Chain ×N | 3+ hits in one shot (contact, bump, lightning) | +25 % cash on the shot per hit beyond 2 |
| Bank | Wall bounce before a kill | +50 % on that kill |
| Cascade | A kill caused by an enemy bumping another (your shot or their charge) | +1 stagger to all enemies within 50 px |
| Sweep | Wave cleared in a single shot | +50 cash |
| Lockdown | Every live enemy staggered this shot | Heal 2 (curve) |

## Progression (trees reworked)

Cash is kept in full; emeralds from boss kills with repeat decay; stage sub-trees as v0.1.

- **Power** (unchanged): damage, speed damage, lightning, split, spitter.
- **Vitality** (replaces Energy): Max HP +5/level (root, cost 6 first), Armor −1 (max 3), Second Wind (heal 2 per kill), Wave Rest (heal 6 at wave clear), Boss Heal 25/50/75 %, Thick Skin (ranged −1). All heals via the curve.
- **Tactics** (replaces Board): Aim preview 1/2/3 bounces, Heavy Hits (hits ≥ 200 px/s apply 2 stagger), Mass (+50 % hero mass: you knock more, get knocked less), Reflex (the first enemy phase of each wave is skipped), Cash Bonus.
- **Combo**: unlock each combo, then raise its reward.
- **Emerald**: ball types (sticky = stun shot), bumpers (hit → +1 stagger to enemies within 40 px, no heal), crates, chests, shrine (heal 8, curve), stray emeralds.

Removed: Enemy Count, Respawn Rate, Battery, Kill Juice, Boss Juice, Bumper Juice. The board belongs to the stage now; the player buys power, durability and tactics. No player control over density in v0.2 (owner undecided; a later "Challenge" toggle — bigger waves, more cash — is the natural place for it).

## HUD and readability

- Top band: `HP 25/25` at 2× with a red bar where the energy bar was; cash and emeralds on row 2; `RAGE IN n` on the right when relevant.
- Each enemy: one 7×7 intent glyph with a 1× number above the sprite; HP pips below only once damaged. No bars on enemies.
- Bottom band: the wave track with the best-wave marker; the boss HP bar replaces it during the boss wave.
- Enemy phase: charging enemies get a short wind-up squash before launch and a motion trail; a charge that connects does hit-stop + hero flash + red `-N`; a blocked charge sparks on the cover. Shoot draws a tracer.
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
| Enemies are balls and attack by rolling **[decided]** | Cascades and cover are the billiards fantasy; counters the 2-combo wall; one physics system for everyone |
| Everything 24–48 px, hero is a character **[decided]** | "Vast" fix; readable on a phone; fewer, bigger enemies |
| Flat damage **[decided]** | Speed already pays by hitting more; speed bonus stays an upgrade |
| 20 HP hero **[decided: fragile]** | Short first runs; durability is something you buy |
| Overtime after the boss **[decided]** | A bonus phase for incremental payoff without persistent boss damage |
| Saves wiped (key v2) **[decided]** | It's a pivot; only the owner has a save |
| All sprites redrawn **[decided]** | New sizes; the hero gets a face |
| Split still once per shot | Pacing, not economy |
| Run ends on boss kill | Caps run length; stage clear is a clean ending |
| Safe zone is spawn-only; attacks out of range become Advance; 25 % minimum shot power | Closes the free-micro-tap stall: without these, a player could idle in the bottom of the table until enrage |

## Risks and what to prototype first

1. **Jammed balls.** Bigger balls, clusters, sliding enemies and charges that knock the hero can wedge anything. Mitigate with overlap push-out, high enemy friction, the stall guard, and a rule that a hero with no clear 24 px of felt around it gets nudged to the nearest open spot before aim. Prototype first with a bot that measures hit-chain distribution, jam rate, and how far charges knock the hero.
2. **Enemy-phase length.** Five rolling enemies take 1.5–2.5 s to settle; with the player's own 2.6 s shot that is a 5 s turn. Mitigate with faster enemy friction, launch overlap, and fast-forward by default once the hero is at rest. Measure.
3. **Clutter.** 8 glyphs and numbers at 180 px wide. Prototype the HUD at phone scale before drawing the full roster.
4. **Stalling builds.** Enrage guarantees an end; verify with the progression bot.
5. **Sprite work.** Every sprite is redrawn at 24–48 px, hero included. That is the largest art task so far.

## Build order

Work happens on branch `v0.2`; `main` stays the playable v0.1 until v0.2 is at least as playable.

1. Physics + sizes + formations + enemy charges prototype, bot-measured (hit chains, jam rate, knock distance, enemy-phase length), with a phone-scale screenshot of the new sizes to approve before the sprite pass.
2. HP, intents, stagger, waves, enrage in the sim; balance bot and tests.
3. Sprites at new sizes; intent glyphs.
4. HUD, intent rendering, enemy-phase sequencing, hero damage feedback.
5. Trees reworked; save key bumped to v2 (old saves wiped).
6. Design review and tuning pass; Ice adapted; then Bog/Clockwork.
