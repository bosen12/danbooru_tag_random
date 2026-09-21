/** Body pose vs activity. Pose/activity pairwise tables stay in engine; this owns the result shape. */
import { REASONS } from "../trace.js";

export function evaluateActivityBody(item, ctx) {
  if (!item) return { ok: true };
  const used = ctx.used || new Set();
  if (item.mutex === "activity" && typeof ctx.activityFitsBody === "function") {
    if (!ctx.activityFitsBody(item.tag, ctx.bodyPoses || used)) {
      return { ok: false, reason: REASONS.pose_activity_conflict, related: [...(ctx.bodyPoses || [])] };
    }
  }
  if (item.mutex === "body_pose" && typeof ctx.activityFitsBody === "function") {
    for (const act of ctx.acts || []) {
      if (!ctx.activityFitsBody(act, new Set([item.tag]))) {
        return { ok: false, reason: REASONS.pose_activity_conflict, related: [act] };
      }
    }
  }
  return { ok: true };
}
