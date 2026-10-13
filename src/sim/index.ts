// Public sim API (see SimApi in core/types.ts). Pure and deterministic: all randomness comes from state.rng.
import type { SimApi } from '../core/types';
import { canFastForward, createRun, previewShot, shoot, step, useTrick } from './run';

export { canFastForward, createRun, previewShot, shoot, step, useTrick };
export { heal } from './damage';
export { effectiveReach, intentVisible, rageLevel, rageStart } from './enemy';
export { onIce } from './physics';

/** Compile-time check that the named exports satisfy the contract. */
export const sim: SimApi = { createRun, step, shoot, previewShot, canFastForward, useTrick };

/**
 * Clockwork: where the hero will rest after the next conveyor sweep (CLEATS-adjusted), or null when the hero is not on a
 * belt. Render draws a dotted outline there during aim. Implemented in sim/belts.ts.
 */
export { beltPreview } from './belts';
export { BELT_SHIFT, MAINSPRING_MOVE_DIST } from '../core/tuning';

/**
 * Bog (v0.7): mud queries. `inMudAt` = a point inside a patch; `mudOnLine` = the straight centre path a -> b enters a
 * patch (bots' mud-aware target choice; ignores MUD BOOTS); `hasMud` = the run has patches. Implemented in sim/mud.ts.
 */
export { hasMud, inMudAt, mudOnLine } from './mud';
export { LOB_R, MUD_GROW, QUEEN_PULL } from '../core/tuning';
