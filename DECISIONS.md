# Implementation decisions (v0.1 slice)

Resolves the design doc's open rule gaps. Do not reopen without a playtest reason.

| Gap | Decision | Why |
|---|---|---|
| Split-ball loophole | Split triggers once per shot, on the main ball's first target hit. Children hit for free. | Caps the loophole: at most one free swarm per release cost. |
| Draining targets vs extra balls | Drains follow the free-hit rule: only main-ball hits pay hit cost or armor drain. | Keeps extra-ball upgrades from becoming penalties. |
| Respawn timing | Respawns happen only in the enemy phase, with a shimmer telegraph. | No ball is moving then; "never next to a moving ball" is automatic. Still enforce min distance from resting balls. |
| Boss spawn timing | Meter fills mid-roll -> boss arrives in the next enemy phase (boss refill applies then). | Avoids spawning into a moving ball. |
| Room for the boss | On arrival, clear the boss zone (top-centre) of regular targets (no rewards), and halve the regular-target cap while the boss lives. | Guarantees space on one fixed screen. |

## Scope of the v0.1 slice
- Stage 1 (Felt hall) complete; Stage 2 (Ice cavern) as data-driven second stage.
- Clockwork and Bog stages, stage sub-trees beyond Felt/Ice: deferred.
- All art and sound are original and generated in code (sprite strings, bitmap font, WebAudio synthesis).
