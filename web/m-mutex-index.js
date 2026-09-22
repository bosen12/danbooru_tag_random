/**
 * M-class mutex index draft (does NOT wire into drawOne yet).
 * Input: docs/superpowers/specs/2026-09-22-m-conflict-graph.json
 * Contract: only M (mutex / extraMutex); S stays in allowSlow.
 */

/**
 * @param {object} graph — parsed M conflict graph JSON
 * @returns {MutexIndex}
 */
export function buildMutexIndex(graph) {
  if (!graph || graph.kind !== "M") {
    throw new Error("buildMutexIndex: expected kind M conflict graph");
  }
  const tagToGroups = new Map();
  for (const [tag, groups] of Object.entries(graph.tagToGroups || {})) {
    tagToGroups.set(tag, Object.freeze([...groups]));
  }
  const groupToTags = new Map();
  for (const [group, tags] of Object.entries(graph.groupToTags || {})) {
    groupToTags.set(group, Object.freeze([...tags]));
  }
  const tagToSiblings = new Map();
  for (const [tag, sibs] of Object.entries(graph.tagToSiblings || {})) {
    tagToSiblings.set(tag, new Set(sibs));
  }
  return Object.freeze({
    kind: "M",
    generated: graph.generated,
    stats: graph.stats,
    tagToGroups,
    groupToTags,
    tagToSiblings,
    /** @param {string} tag */
    groupsOf(tag) {
      return tagToGroups.get(tag) || EMPTY;
    },
    /** @param {string} tag */
    siblingsOf(tag) {
      return tagToSiblings.get(tag) || EMPTY_SET;
    },
    /**
     * O(groups) busy check — same semantics as engine mutexBusy
     * (any group already taken by a different tag).
     * @param {Map<string,string>} mutexTaken
     * @param {string} tag
     */
    isBusy(mutexTaken, tag) {
      const groups = tagToGroups.get(tag);
      if (!groups) return false;
      for (const g of groups) {
        const occ = mutexTaken.get(g);
        if (occ != null && occ !== tag) return true;
      }
      return false;
    },
    /**
     * Fast path for allow()'s early M reject:
     * any of tag's groups already occupied.
     * @param {Map<string,string>} mutexTaken
     * @param {string} tag
     */
    anyGroupTaken(mutexTaken, tag) {
      const groups = tagToGroups.get(tag);
      if (!groups) return false;
      for (const g of groups) {
        if (mutexTaken.has(g)) return true;
      }
      return false;
    },
  });
}

const EMPTY = Object.freeze([]);
const EMPTY_SET = new Set();

/**
 * Load graph from a filesystem path (Node only).
 * @param {string} path
 */
export async function loadMutexIndexFromPath(path) {
  const { readFileSync } = await import("fs");
  const graph = JSON.parse(readFileSync(path, "utf8"));
  return buildMutexIndex(graph);
}

/**
 * Pool prefilter: drop tags whose M-groups are already occupied.
 * Does NOT replace item._mx scans inside allow — call this on the pool
 * before weighted pick so allow never sees those candidates.
 *
 * @param {ReturnType<typeof buildMutexIndex>} idx
 * @param {Map<string,string>} mutexTaken
 * @param {Iterable<{tag:string}|string>} pool
 * @returns {{ kept: any[], dropped: any[], droppedTags: string[] }}
 */
export function prefilterPoolByMutex(idx, mutexTaken, pool) {
  const kept = [];
  const dropped = [];
  const droppedTags = [];
  for (const entry of pool) {
    const tag = typeof entry === "string" ? entry : entry.tag;
    if (idx.anyGroupTaken(mutexTaken, tag)) {
      dropped.push(entry);
      droppedTags.push(tag);
    } else {
      kept.push(entry);
    }
  }
  return { kept, dropped, droppedTags };
}
