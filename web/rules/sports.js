/** Sport identity / gear / venue reasons. Does not import engine.js. */
import { sportTagAllowed } from "../sports.js";
import { REASONS } from "../trace.js";

export function evaluateSportKit(item, used) {
  if (!item) return { ok: true };
  if (!sportTagAllowed(item.tag, used)) {
    return { ok: false, reason: REASONS.sport_place_mismatch, related: [...(used || [])] };
  }
  return { ok: true };
}

export function evaluateSportPlace(item, ctx) {
  if (!item) return { ok: true };
  const lockScene = ctx.lockScene !== false;
  if (!lockScene) return { ok: true };
  if (typeof ctx.sportPlaceOk === "function" && !ctx.sportPlaceOk(item, ctx.used)) {
    return { ok: false, reason: REASONS.sport_place_mismatch, related: [...(ctx.places || [])] };
  }
  if (typeof ctx.sportGearPlaceOk === "function" && !ctx.sportGearPlaceOk(item, ctx.used, ctx.lex)) {
    return { ok: false, reason: REASONS.sport_place_mismatch, related: [...(ctx.places || [])] };
  }
  return { ok: true };
}
