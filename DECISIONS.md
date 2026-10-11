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
