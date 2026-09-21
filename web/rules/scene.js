/** Place / activity / weather / furniture gates. Logic that needs engine sets stays callable via ctx. */
import { REASONS } from "../trace.js";

export function evaluatePlaceActivity(item, ctx) {
  if (!item) return { ok: true };
  const lockScene = ctx.lockScene !== false;
  if (!lockScene) return { ok: true };
  const placeLike = item.mutex === "place" || item.group === "place";
  if (placeLike && typeof ctx.placeFitsActs === "function") {
    if (!ctx.placeFitsActs(item.tag, ctx.acts, ctx.realistic)) {
      return {
        ok: false,
        reason: REASONS.scene_activity_conflict,
        related: [...(ctx.acts || [])],
      };
    }
  }
  if (item.mutex === "activity" && typeof ctx.actFitsPlaces === "function") {
    if (!ctx.actFitsPlaces(item.tag, ctx.places, ctx.realistic)) {
      return {
        ok: false,
        reason: REASONS.scene_activity_conflict,
        related: [...(ctx.places || [])],
      };
    }
  }
  return { ok: true };
}

export function evaluateIndoorOutdoor(item, ctx) {
  if (!item) return { ok: true };
  const used = ctx.used || new Set();
  if (used.has("indoors") && ctx.outdoorLeftover && ctx.outdoorLeftover.has(item.tag)) {
    return { ok: false, reason: REASONS.scene_activity_conflict, related: ["indoors"] };
  }
  if (used.has("outdoors") && ctx.indoorProp && ctx.indoorProp.has(item.tag)) {
    return { ok: false, reason: REASONS.scene_activity_conflict, related: ["outdoors"] };
  }
  return { ok: true };
}
