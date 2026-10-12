// Public sim API (see SimApi in core/types.ts). Pure and deterministic: all randomness comes from state.rng.
import type { SimApi } from '../core/types';
import { canFastForward, createRun, previewShot, shoot, step, useTrick } from './run';

export { canFastForward, createRun, previewShot, shoot, step, useTrick };
export { heal, overtimeCashMult } from './damage';
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
