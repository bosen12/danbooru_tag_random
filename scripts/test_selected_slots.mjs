import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { defaultSettings, drawOne, indexLexicon, mulberry32, SKELETON, skeletonLit } from "../web/engine.js";

const data = JSON.parse(readFileSync(new URL("../web/lexicon.json", import.meta.url), "utf8"));
const lex = indexLexicon(data);
function settings(section, groups, patch = {}) {
  return { ...defaultSettings(data), girl: true, boy: false, heats: ["tease"], eras: ["modern"],
    counts: { feature: 0, clothing: 0, pose: 0, env: 0, [section]: groups.length },
    offGroups: SKELETON[section].filter(([g]) => !groups.includes(g)).map(([g]) => `${section}:${g}`), ...patch };
}
function draw(s, pins, seed) {
  return drawOne(lex, s, new Set(["1girl", ...pins]), new Set(), mulberry32(seed), seed, { trace: true });
}
function group(d, section, g) {
  return d.sections[section].filter(t => lex.byTag.get(t)?.group === g);
}
// 走開帶出走路、坐在樓梯上帶出坐著。那是同一個格子的父子，不是補了第二張。
function slotRoots(d, section, g) {
  const tags = group(d, section, g);
  const implied = new Set();
  for (const t of tags) for (const dep of lex.byTag.get(t)?.implies || []) implied.add(dep);
  return tags.filter((t) => !implied.has(t));
}

for (const [section, selected, pin] of [
  ["pose", "body", "cowboy shot"],
  ["feature", "hair_len", "blue eyes"],
  ["env", "place", "night"],
  ["clothing", "legs", "white shirt"],
]) test(`${section}: unrelated pinned category preserves the selected slot`, () => {
  const s = settings(section, [selected]);
  for (let seed = 1; seed <= 30; seed++) {
    const d = draw(s, [pin], seed);
    assert(d.sections[section].includes(pin), `pin lost at ${seed}`);
    assert(group(d, section, selected).length >= 1, `missing ${selected} at ${seed}: ${d.positive}`);
    assert.deepEqual(skeletonLit(s, section), [`${section}:${selected}`]);
  }
});

for (const [section, selected, pin] of [
  ["pose", "body", "standing"], ["feature", "eyes", "blue eyes"],
  ["env", "place", "library"], ["clothing", "feet", "sneakers"],
]) test(`${section}: same category pin fills the slot without another card`, () => {
  for (let seed = 1; seed <= 20; seed++) {
    const d = draw(settings(section, [selected]), [pin], seed);
    assert.deepEqual(group(d, section, selected), [pin]);
  }
});

test("two selected categories both survive pins in other categories", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const d = draw(settings("pose", ["body", "face"]), ["cowboy shot", "looking at viewer"], seed);
    assert.equal(slotRoots(d, "pose", "body").length, 1);
    assert(group(d, "pose", "face").length >= 1); // An expression can imply another face tag.
    assert(d.sections.pose.includes("cowboy shot") && d.sections.pose.includes("looking at viewer"));
  }
});

test("must-draw in another category also preserves the selected slot", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const d = draw(settings("pose", ["body"], { mustDraw: { "pose:camera": 1 } }), [], seed);
    assert.equal(slotRoots(d, "pose", "body").length, 1);
    assert.equal(slotRoots(d, "pose", "camera").length, 1);
  }
});

test("zero slots retain pins and do not add an automatic pose", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const d = draw(settings("pose", []), ["cowboy shot"], seed);
    assert.deepEqual(d.sections.pose, ["cowboy shot"]);
  }
});

test("selected clothing does not override incompatible pinned garments", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const d = draw(settings("clothing", ["top"]), ["dress"], seed);
    assert(d.sections.clothing.includes("dress"));
    assert.equal(group(d, "clothing", "top").length, 0);
  }
});

test("a colored garment and its implied parent fill one selected category, leaving the other free", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const d = draw(settings("clothing", ["top", "legs"]), ["white shirt"], seed);
    assert(d.sections.clothing.includes("white shirt") && d.sections.clothing.includes("shirt"));
    assert(group(d, "clothing", "legs").length >= 1);
    assert(group(d, "clothing", "top").every(t => ["white shirt", "shirt"].includes(t)));
  }
});

test("the reported pool keeps all eight pins and fills body pose alongside the camera", () => {
  const pins = ["blue eyes", "orange hair", "cowboy shot", "midriff", "navel", "collarbone", "large breasts"];
  for (let seed = 1; seed <= 30; seed++) {
    const s = settings("pose", ["body"]);
    s.counts.env = 1;
    s.offGroups.push("env:inout", "env:time", "env:light");
    const d = draw(s, pins, seed);
    const tags = Object.values(d.sections).flat();
    assert(pins.every(t => tags.includes(t)), `lost pin at ${seed}`);
    assert.equal(slotRoots(d, "pose", "body").length, 1, `body slot was not filled once at ${seed}: ${group(d, "pose", "body").join(", ")}`);
    assert(d.sections.env.some(t => lex.byTag.get(t)?.group === "place" || lex.byTag.get(t)?.group === "background"));
  }
});
