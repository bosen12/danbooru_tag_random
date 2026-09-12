/** Pure, side-effect-free semantic validators used for shadow diagnostics. */

const SUPPORT_RULES = [
  {
    rule_id: "support:eating-prone",
    actors: new Set(["eating"]),
    forbidden: new Set(["on stomach"]),
    modes: ["normal", "diverse"],
    scope: "same_actor",
  },
  {
    rule_id: "support:cooking-supine",
    actors: new Set(["cooking"]),
    forbidden: new Set(["on back", "lying"]),
    modes: ["normal", "diverse"],
    scope: "same_actor",
  },
  {
    rule_id: "support:cooking-prone-normal",
    actors: new Set(["cooking"]),
    forbidden: new Set(["on stomach"]),
    modes: ["normal"],
    scope: "same_actor",
  },
  {
    rule_id: "support:wading-planted",
    actors: new Set(["wading"]),
    forbidden: new Set(["crawling", "on back"]),
    modes: ["normal", "diverse", "weird"],
    scope: "same_actor",
  },
];

function asSet(values) {
  if (values instanceof Set) return values;
  return new Set(Array.isArray(values) ? values : []);
}

function resolvedPeople(tags, people) {
  if (Number.isFinite(people)) return people;
  if (tags.has("solo")) return 1;
  return undefined;
}

export function validateSupportShadow({ tags, pinned = [], mode = "normal", people } = {}) {
  const present = asSet(tags);
  const pinnedTags = asSet(pinned);
  const castSize = resolvedPeople(present, people);
  const violations = [];

  for (const rule of SUPPORT_RULES) {
    if (!rule.modes.includes(mode)) continue;
    if (rule.scope === "same_actor" && castSize > 1) continue;

    const actors = [...rule.actors].filter((tag) => present.has(tag));
    const forbidden = [...rule.forbidden].filter((tag) => present.has(tag));
    if (!actors.length || !forbidden.length) continue;

    const evidence = [...actors, ...forbidden];
    const fullyPinned = evidence.every((tag) => pinnedTags.has(tag));
    violations.push({
      rule_id: rule.rule_id,
      dimension: "support",
      severity: fullyPinned ? "warning" : "hard",
      declared_severity: "hard",
      modes: [...rule.modes],
      scope: rule.scope,
      tags: evidence,
      origin: fullyPinned ? "pinned-conflict" : "auto-conflict",
    });
  }

  return violations;
}

function signature(violation) {
  return `${violation.rule_id}\u0000${violation.tags.join("\u0000")}`;
}

export function supportCandidateAllowed({ used, candidate, pinned = [], mode = "normal", people } = {}) {
  const beforeTags = asSet(used);
  const before = new Set(
    validateSupportShadow({ tags: beforeTags, pinned, mode, people })
      .filter((violation) => violation.severity === "hard")
      .map(signature),
  );
  const afterTags = new Set(beforeTags);
  if (candidate) afterTags.add(candidate);
  const after = validateSupportShadow({ tags: afterTags, pinned, mode, people });
  return !after.some((violation) => violation.severity === "hard" && !before.has(signature(violation)));
}
