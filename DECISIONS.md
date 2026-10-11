# Implementation decisions (v0.1 slice)

Resolves the design doc's open rule gaps. Do not reopen without a playtest reason.

| Gap | Decision | Why |
|---|---|---|
| Split-ball loophole | Split triggers once per shot, on the main ball's first target hit. Children hit for free. | Caps the loophole: at most one free swarm per release cost. |
| Draining targets vs extra balls | Drains follow the free-hit rule: only main-ball hits pay hit cost or armor drain. | Keeps extra-ball upgrades from becoming penalties. |
| Respawn timing | Respawns happen only in the enemy phase, with a shimmer telegraph. | No ball is moving then; "never next to a moving ball" is automatic. Still enforce min distance from resting balls. |
| Boss spawn timing | Meter fills mid-roll -> boss arrives in the next enemy phase (boss refill applies then). | Avoids spawning into a moving ball. |
| Room for the boss | On arrival, clear the boss zone (top-centre) of regular targets (no rewards), and halve the regular-target cap while the boss lives. | Guarantees space on one fixed screen. |
| Run end | The run ends when, after the shot settles and the enemy phase finishes, energy < releaseCost (doc says "zero"). | You cannot shoot below the release cost anyway; boss arrival and other enemy-phase refills land before the check. |
| Boss arrival refill | Base 25% of max energy (BOSS JUICE raises it to 25% + 20%/level), via the shared curve, applied before the run-over check. | A boss arriving into an empty tank was an anticlimax. |
| Empty board | If no live regular targets remain in the enemy phase, respawn at least min(cap, 2) at once. Killing the last regular target mid-shot fires `boardClear` (once per shot) and a small refill (4, shared curve). | Never leave the player with nothing to shoot; reward the clear. |
| Shielded boss cost | A main-ball hit on a shielded boss costs only hitCost (no boss drain, no drain-phase surcharge). | It deals no damage; draining for it felt punitive. |
| Boss 'drain' phase | Adds +1 energy cost only to main-ball hits on the boss itself, not every target. | Keeps the phase about the boss, not a global tax. |
| Sticky ball | On a main-ball target hit, the ball is held on the target's surface for 0.25 s, then released along the reflected direction at 60% of its impact speed and deals the hit damage again (that second hit is free). The stall guard still forces rest. | Gives sticky a distinct physics identity (double hit, slower exit). |

## Scope of the v0.1 slice
- Stage 1 (Felt hall) complete; Stage 2 (Ice cavern) as data-driven second stage.
- Clockwork and Bog stages, stage sub-trees beyond Felt/Ice: deferred.
- All art and sound are original and generated in code (sprite strings, bitmap font, WebAudio synthesis).

## Active target tier (warden / hive / frost)

Targets that act in the enemy phase (`sim/active.ts`, run after respawns and before boss behaviours). Each active telegraphs one phase (`act = 1`, `aimId`, fx `telegraph`) and executes the next, so a fresh spawn gives two shots of warning.

| Rule | Decision | Why |
|---|---|---|
| Warden shield | Shields the nearest eligible regular within 40 px (`shield = 1`). The next damaging hit from **any** source (ball, lightning, explosion) is absorbed and strips it (`shieldBreak`). No stacking; max 2 shields on the board. A warden's death strips every shield. | One strip per shield keeps it a tax, not a wall; killing the warden is the counterplay. |
| Zero-damage hits | A main-ball hit that deals no damage (shielded boss, warden shield, frozen below shatter speed) pays `hitCost` only: no drain, no boss drain-phase surcharge. Shatter is a damaging hit and pays the frozen target's drain. | Generalises the shielded-boss rule; draining for a no-damage hit felt punitive. |
| Sticky vs shield / ice | Sticky's free second hit goes through `applyDamage`, so it damages after the first hit strips a shield, and does nothing against a frozen target. | Falls out of putting the guards in `applyDamage`. |
| Frost / frozen | Freezes the nearest eligible regular within 40 px for 3 enemy phases (max 2 frozen), zeroing its drift; thaw re-rolls drift. Frozen targets bounce at 1.1. Ball hits with pre-impact speed >= 160 px/s shatter (full kill rewards to the ball, then 2 explosion damage to targets within 20 + r, counted as chain kills); slower ball hits deal 0. Lightning thaws for 0 damage; explosions shatter. | Rewards hard shots; 160 is a third of max launch. Shatter-by-explosion makes ice chains a combo. |
| Spores | Hive spawns one spore (1 hp, 1 cash, 0 meter) per two phases, cap 4 live. Spores are **not** regular: ignored by the regular cap, board clear and empty-board refill; cleared from the boss zone on arrival; they outlive their hive. | They are clutter that soaks hit cost and deflects shots, never a way to stall respawns or block a board clear. |
| Eligibility | Shield/freeze candidates: live, solid, regular, not active, not shielded/frozen, not claimed by another live actor's `aimId`. At execute the aim must still be live and unshielded/unfrozen and the cap free (range is not re-checked); otherwise the action fizzles and the actor re-picks next phase. No target is both shielded and frozen. | Deterministic (array order, nearest then lowest id), cheap to telegraph. |
| Gating | Pool entries can carry `minEnemyCount` and `maxLive`; `poolKind` filters them (empty -> `basic`). Felt: warden needs enemyCount >= 5 (max 2 live), hive >= 6 (max 1 live). Ice: frost (max 2 live), no wardens/hives. Actives are never placed on the initial board (createRun fills beyond `openingBoard` with actives excluded). | Keeps early-game pacing bit-identical for enemyCount < 5 (the filter removes nothing and `rng.pick` always takes one draw). |
