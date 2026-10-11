// Public sim API (see SimApi in core/types.ts). Pure and deterministic: all randomness comes from state.rng.
import type { SimApi } from '../core/types';
import { canFastForward, createRun, previewShot, shoot, step } from './run';

export { canFastForward, createRun, previewShot, shoot, step };
export { heal, overtimeCashMult } from './damage';
export { rageLevel, rageStart } from './enemy';

/** Compile-time check that the named exports satisfy the contract. */
export const sim: SimApi = { createRun, step, shoot, previewShot, canFastForward };
