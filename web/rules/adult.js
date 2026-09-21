/** Heat / adult-content candidate gates. itemFitsHeats lives in engine and calls hasExplicitContent. */
import { REASONS } from "../trace.js";

export function evaluateHeat(item, heatOk) {
  if (!item) return { ok: true };
  if (heatOk === false) return { ok: false, reason: REASONS.heat_mismatch };
  return { ok: true };
}

export function evaluateEra(item, eraOk) {
  if (!item) return { ok: true };
  if (eraOk === false) return { ok: false, reason: REASONS.era_mismatch };
  return { ok: true };
}
