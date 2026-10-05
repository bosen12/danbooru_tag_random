#!/usr/bin/env node
/** 第三輪 CSV 的分類、尺度、互斥與抽取。失敗印出並 exit 1。 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  applyPin,
  defaultSettings,
  drawOne,
  indexLexicon,
  mulberry32,
  ratingBlocked,
} from "../web/engine.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(join(ROOT, "web/lexicon.json"), "utf8"));
const lex = indexLexicon(data);
const csvText = readFileSync("C:/Users/boshe/Downloads/danbooru_missing_tags_round3.csv", "utf8");

let failed = 0;
function eq(name, got, want) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) {
    failed += 1;
    console.error(`FAIL ${name}\n  got  ${a}\n  want ${b}`);
  } else console.log(`ok   ${name}`);
}
function ok(name, cond, detail) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL ${name}${detail ? "\n  " + detail : ""}`);
  } else console.log(`ok   ${name}`);
}

function item(tag) {
  return lex.byTag.get(tag);
}
function pinsOf(...tags) {
  let pinned = new Set();
  for (const tag of tags) pinned = applyPin(lex, pinned, new Set(), tag).pinned;
  return pinned;
}
function base(over = {}) {
  const s = defaultSettings(data);
  s.girl = true;
  s.boy = false;
  s.heats = ["tease", "flash", "sex"];
  s.eras = ["modern"];
  s.sceneMode = "normal";
  return Object.assign(s, over);
}
function draw(s, pinned, seed, banned = new Set()) {
  return drawOne(lex, s, pinned, banned, mulberry32(seed), seed);
}
function tagSet(drawn) {
  return new Set(String(drawn.positive).split(", ").map((t) => t.trim()).filter(Boolean));
}
function chain(tag, seen = new Set()) {
  if (seen.has(tag)) return seen;
  seen.add(tag);
  const it = item(tag);
  for (const d of [...(it?.implies || []), ...(it?.bind || [])]) chain(d, seen);
  return seen;
}
function implies(tag) {
  return item(tag)?.implies || [];
}
function needs(tag) {
  return item(tag)?.needs || [];
}
const ZH_OVERRIDE = {
  eyepatch: "單眼眼罩",
  meadow: "草原",
  arcade: "街機店",
};
const csvRows = csvText.replace(/^\uFEFF/, "").trim().split(/\r?\n/).slice(1).map((line) => {
  const [raw, zh] = line.split(",");
  const tag = raw.replace(/_/g, " ");
  return { tag, zh: ZH_OVERRIDE[tag] || zh };
});

{
  eq("round 3 csv has 104 tags", csvRows.length, 104);
  const missing = csvRows.filter((r) => !item(r.tag)).map((r) => r.tag);
  eq("every csv tag is in the lexicon", missing, []);
  const zhBad = csvRows.filter((r) => item(r.tag) && item(r.tag).zh !== r.zh).map((r) => `${r.tag}:${item(r.tag)?.zh}`);
  eq("chinese names match, with the three collisions renamed", zhBad, []);
  const bannedChild = [];
  for (const r of csvRows) {
    for (const t of chain(r.tag)) {
      if (t === "loli" || t === "shota" || t === "child") bannedChild.push(`${r.tag}->${t}`);
    }
  }
  eq("no new tag implies loli, shota, or child", bannedChild, []);
  const zh = new Map();
  const dups = [];
  for (const t of data.tags) {
    if (!t.zh) continue;
    if (zh.has(t.zh)) dups.push(`${t.zh}: ${zh.get(t.zh)} / ${t.tag}`);
    else zh.set(t.zh, t.tag);
  }
  eq("chinese names stay unique", dups, []);
  ok("looking away stays retired", !item("looking away"));
  ok("fur coat still does not imply coat", !(item("fur coat")?.implies || []).includes("coat"));
  const neg = data.negative.split(", ").map((t) => t.trim());
  eq("negative still ends with loli, child, aged down", neg.slice(-3), ["loli", "child", "aged down"]);
}

eq("smartphone implies cellphone and not the landline", implies("smartphone"), ["cellphone"]);
eq("teddy bear implies the stuffed toy", implies("teddy bear"), ["stuffed toy"]);
eq("selfie stick implies neither selfie nor cellphone", implies("selfie stick"), []);
eq("eyepatch does not imply glasses", implies("eyepatch"), []);
eq("eyewear on head is the same glasses, pushed up", {
  implies: implies("eyewear on head"), era: item("eyewear on head").era, mutex: item("eyewear on head").mutex,
}, { implies: ["glasses"], era: ["modern", "victorian"], mutex: "eyewear" });
eq("medical eyepatch implies the eyepatch", implies("medical eyepatch"), ["eyepatch"]);
eq("bandage over one eye does not imply eyepatch", implies("bandage over one eye"), []);
eq("headphones around the neck are not on the head", {
  implies: implies("headphones around neck"), mutex: item("headphones around neck").mutex,
}, { implies: [], mutex: null });
for (const t of ["flower field", "wheat field", "meadow"]) {
  eq(`${t} is outdoors and not the historical field`, implies(t), ["outdoors"]);
}
eq("cathedral is indoors across medieval and does not imply church", {
  implies: implies("cathedral"), era: item("cathedral").era,
}, { implies: ["indoors"], era: ["modern", "victorian", "medieval"] });
eq("cave interior implies the cave and not indoors", implies("cave interior"), ["cave"]);
eq("space station implies space and neither indoors nor outdoors", implies("space station"), ["space"]);
eq("taxi implies the car", implies("taxi"), ["car"]);
eq("escalator and the bulletin board are props, not places", [
  item("escalator").mutex, implies("escalator"), item("bulletin board").mutex, implies("bulletin board"),
], [null, [], null, []]);
eq("a computer does not force indoors", implies("computer"), []);
eq("monitor and laptop imply the computer", [implies("monitor"), implies("laptop")], [["computer"], ["computer"]]);
for (const t of ["princess carry", "piggyback", "shoulder carry"]) {
  ok(`${t} is not an activity and does not imply carrying`, item(t).mutex == null && !implies(t).includes("carrying") && needs(t).includes("pair"));
}
eq("bowing and curtsey are standing poses", [implies("bowing"), implies("curtsey")], [["standing"], ["standing"]]);
eq("fetal position implies lying, curled up does not", [implies("fetal position"), implies("curled up")], [["lying"], []]);
eq("face down implies on stomach", implies("face down"), ["on stomach"]);
eq("face in pillow keeps the pillow, face down, and on stomach", implies("face in pillow"), ["pillow", "face down", "on stomach"]);
eq("hugging own legs implies sitting", implies("hugging own legs"), ["sitting"]);
eq("a lap pillow is a lap, not the object", { implies: implies("lap pillow"), needs: needs("lap pillow") }, { implies: [], needs: ["pair"] });
eq("head on pillow does not imply lying", implies("head on pillow"), ["pillow"]);
eq("double v implies v, w arms do not imply arms up", [implies("double v"), implies("w arms")], [["v"], []]);
eq("reverse fellatio is the oral act and needs a man", {
  mutex: item("reverse fellatio").mutex, implies: implies("reverse fellatio"), needs: needs("reverse fellatio"),
}, { mutex: "sex_act", implies: ["fellatio", "oral"], needs: ["male", "pair"] });
eq("throat bulge is the result, not a second act", {
  mutex: item("throat bulge").mutex, implies: implies("throat bulge"), needs: needs("throat bulge"),
}, { mutex: null, implies: ["fellatio", "oral"], needs: ["male", "pair"] });
eq("head grab needs a pair and not a man", needs("head grab"), ["pair"]);
eq("licking an ear is not oral", { implies: implies("licking ear"), needs: needs("licking ear"), heat: item("licking ear").heat }, {
  implies: [], needs: ["pair"], heat: ["sex"],
});
eq("dripping implies the water drop and both take the effect slot", {
  implies: implies("dripping"), a: item("dripping").mutex, b: item("water drop").mutex,
}, { implies: ["water drop"], a: "effect", b: "effect" });
eq("torn shirt is a shirt", { implies: implies("torn shirt"), mutex: item("torn shirt").mutex, group: item("torn shirt").group, era: item("torn shirt").era }, {
  implies: ["shirt"], mutex: "top", group: "top", era: ["modern", "victorian"],
});
eq("torn skirt is a skirt", { implies: implies("torn skirt"), mutex: item("torn skirt").mutex, group: item("torn skirt").group }, {
  implies: ["skirt"], mutex: "bottom", group: "bottom",
});
eq("unzipped stays flash and modern", { heat: item("unzipped").heat, era: item("unzipped").era, group: item("unzipped").group }, {
  heat: ["flash", "sex"], era: ["modern"], group: "fabric",
});
eq("bandaid on pussy implies the bandaid, not the body part", {
  implies: implies("bandaid on pussy"), heat: item("bandaid on pussy").heat,
}, { implies: ["bandaid"], heat: ["sex"] });
for (const t of ["hair slicked back", "mohawk", "dreadlocks", "afro"]) {
  eq(`${t} takes the hair style slot`, item(t).mutex, "hair_style");
}
for (const t of ["antenna hair", "hair flaps", "undercut", "bangs pinned back", "glowing hair"]) {
  eq(`${t} stacks with a hair style`, { mutex: item(t).mutex, group: item(t).group }, { mutex: null, group: "hair_style" });
}
eq("glowing eye does not take the eye color", { mutex: item("glowing eye").mutex, group: item("glowing eye").group }, { mutex: null, group: "eyes" });
eq("crazy eyes are a face, dilated pupils are eyes", [item("crazy eyes").group, item("dilated pupils").group], ["face", "eyes"]);
eq("blood from the mouth implies an open mouth", implies("blood from mouth"), ["open mouth"]);
ok("a lipstick mark does not make her wear lipstick", !implies("lipstick mark").includes("lipstick") && !implies("lipstick mark on neck").includes("lipstick"));
ok("a bite mark is not a hickey", !implies("bite mark").includes("hickey"));
ok("undressing another does not imply undressing", !implies("undressing another").includes("undressing"));

{
  ok("torn shirt is sensitive, not general", ratingBlocked(item("torn shirt"), "general") && !ratingBlocked(item("torn shirt"), "sensitive"));
  ok("torn skirt is sensitive, not general", ratingBlocked(item("torn skirt"), "general") && !ratingBlocked(item("torn skirt"), "sensitive"));
  ok("unzipped is sensitive, not general", ratingBlocked(item("unzipped"), "general") && !ratingBlocked(item("unzipped"), "sensitive"));
  ok("bandaid on pussy is explicit only", ratingBlocked(item("bandaid on pussy"), "general") && ratingBlocked(item("bandaid on pussy"), "sensitive") && !ratingBlocked(item("bandaid on pussy"), "explicit"));
  ok("blood on the face is general", !ratingBlocked(item("blood on face"), "general"));
  ok("blood on clothes is general", !ratingBlocked(item("blood on clothes"), "general"));
  ok("a bite mark is general", !ratingBlocked(item("bite mark"), "general"));
  ok("grabbing clothes is general", !ratingBlocked(item("clothes grab"), "general"));
  ok("a hand under clothes is not general", ratingBlocked(item("hand under clothes"), "general") && !ratingBlocked(item("hand under clothes"), "explicit"));
  ok("head grab is explicit only", ratingBlocked(item("head grab"), "sensitive") && !ratingBlocked(item("head grab"), "explicit"));
}

const bare = base({
  counts: { subject: 0, feature: 0, pose: 0, clothing: 0, env: 0 },
  heats: ["tease"],
  weights: { tease: 1, flash: 0, sex: 0, activity: 0 },
});
const sexBare = base({
  counts: { subject: 0, feature: 0, pose: 0, clothing: 0, env: 0 },
  heats: ["sex"],
  weights: { tease: 0, flash: 0, sex: 1, activity: 0 },
});
function posesExcept(...keep) {
  const banned = new Set();
  for (const t of data.tags) if (t.section === "pose" && !keep.includes(t.tag)) banned.add(t.tag);
  return banned;
}
function clothingExcept(...keep) {
  const banned = new Set();
  for (const t of data.tags) if (t.section === "clothing" && !keep.includes(t.tag)) banned.add(t.tag);
  return banned;
}
function featuresExcept(...keep) {
  const banned = new Set();
  for (const t of data.tags) if (t.section === "feature" && !keep.includes(t.tag)) banned.add(t.tag);
  return banned;
}

{
  const phone = tagSet(draw(bare, pinsOf("smartphone"), 1));
  ok("a pinned smartphone brings the cellphone and not the landline", phone.has("smartphone") && phone.has("cellphone") && !phone.has("phone"));
  const bear = tagSet(draw(bare, pinsOf("teddy bear"), 2));
  ok("a teddy bear brings the stuffed toy", bear.has("teddy bear") && bear.has("stuffed toy"));
  const stick = tagSet(draw(bare, pinsOf("selfie stick"), 3));
  ok("a selfie stick is not a selfie and not a phone", stick.has("selfie stick") && !stick.has("selfie") && !stick.has("cellphone"));
  const up = tagSet(draw(bare, pinsOf("eyewear on head"), 4));
  ok("glasses pushed up keep the glasses", up.has("eyewear on head") && up.has("glasses"));
  const med = tagSet(draw(bare, pinsOf("medical eyepatch"), 5));
  ok("a medical eyepatch keeps the eyepatch", med.has("medical eyepatch") && med.has("eyepatch"));
  const field = tagSet(draw(bare, pinsOf("flower field"), 6));
  ok("a modern flower field stays and does not become the historical field", field.has("flower field") && field.has("outdoors") && !field.has("field"));
  const church = tagSet(draw(base({
    eras: ["medieval"], heats: ["tease"], weights: { tease: 1, flash: 0, sex: 0, activity: 0 },
    counts: { subject: 0, feature: 0, pose: 0, clothing: 0, env: 0 },
  }), pinsOf("cathedral"), 7));
  ok("a medieval cathedral stays indoors and is not the modern church", church.has("cathedral") && church.has("indoors") && !church.has("church"));
  const station = tagSet(draw(bare, pinsOf("space station"), 8));
  ok("a space station is space, not indoors or outdoors", station.has("space station") && station.has("space") && !station.has("indoors") && !station.has("outdoors"));
  const cave = tagSet(draw(bare, pinsOf("cave interior"), 9));
  ok("a cave interior keeps the cave", cave.has("cave interior") && cave.has("cave") && !cave.has("indoors"));
  const taxi = tagSet(draw(bare, pinsOf("taxi"), 10));
  ok("a taxi is a car outdoors", taxi.has("taxi") && taxi.has("car") && taxi.has("outdoors"));
  const rev = tagSet(draw(sexBare, pinsOf("reverse fellatio"), 11));
  ok("reverse fellatio on a girl-only setting adds the boy, the act, and oral",
    rev.has("reverse fellatio") && rev.has("fellatio") && rev.has("oral") && rev.has("1girl") && rev.has("1boy"));
  const throat = tagSet(draw(sexBare, pinsOf("throat bulge"), 12));
  ok("a throat bulge adds the boy and the oral act",
    throat.has("throat bulge") && throat.has("fellatio") && throat.has("oral") && throat.has("1boy") && throat.has("1girl"));
  const grab = tagSet(draw(sexBare, pinsOf("head grab"), 13));
  ok("head grab makes two girls and does not add a boy", grab.has("head grab") && grab.has("2girls") && !grab.has("1boy"));
  const ear = tagSet(draw(sexBare, pinsOf("licking ear"), 14));
  ok("licking an ear makes two girls and is not oral", ear.has("licking ear") && !ear.has("1boy") && !ear.has("oral") && !ear.has("fellatio"));
  const bow = tagSet(draw(bare, pinsOf("bowing"), 15));
  ok("bowing keeps standing", bow.has("bowing") && bow.has("standing"));
  const curt = tagSet(draw(bare, pinsOf("curtsey"), 16));
  ok("a curtsey keeps standing and the girl", curt.has("curtsey") && curt.has("standing") && !curt.has("1boy"));
  const fetal = tagSet(draw(bare, pinsOf("fetal position"), 17));
  ok("fetal position keeps lying", fetal.has("fetal position") && fetal.has("lying"));
  const down = tagSet(draw(bare, pinsOf("face down"), 18));
  ok("face down keeps on stomach", down.has("face down") && down.has("on stomach"));
  const pillow = tagSet(draw(bare, pinsOf("face in pillow"), 19));
  ok("face in pillow keeps the pillow, face down, and on stomach",
    pillow.has("face in pillow") && pillow.has("pillow") && pillow.has("face down") && pillow.has("on stomach"));
  const vv = tagSet(draw(bare, pinsOf("double v"), 20));
  ok("double v keeps the single v", vv.has("double v") && vv.has("v"));
  const hug = tagSet(draw(bare, pinsOf("hugging own legs"), 21));
  ok("hugging own legs keeps sitting", hug.has("hugging own legs") && hug.has("sitting"));
  const shirt = tagSet(draw(bare, pinsOf("torn shirt"), 22));
  ok("a torn shirt keeps the shirt", shirt.has("torn shirt") && shirt.has("shirt"));
  const skirt = tagSet(draw(bare, pinsOf("torn skirt"), 23));
  ok("a torn skirt keeps the skirt", skirt.has("torn skirt") && skirt.has("skirt") && !skirt.has("1boy"));
  const drop = tagSet(draw(bare, pinsOf("dripping"), 24));
  ok("dripping keeps the water drop", drop.has("dripping") && drop.has("water drop"));
  const screen = tagSet(draw(bare, pinsOf("monitor"), 25));
  ok("a monitor keeps the computer", screen.has("monitor") && screen.has("computer"));
  const patch = tagSet(draw(sexBare, pinsOf("bandaid on pussy"), 26));
  ok("a bandaid on pussy keeps the bandaid and not the body-part tag", patch.has("bandaid on pussy") && patch.has("bandaid") && !patch.has("pussy"));
  const blood = tagSet(draw(bare, pinsOf("blood from mouth"), 27));
  ok("blood from the mouth keeps an open mouth", blood.has("blood from mouth") && blood.has("open mouth"));
  const lip = tagSet(draw(bare, pinsOf("lipstick mark on neck"), 28));
  ok("a lipstick mark on the neck does not make her wear lipstick", lip.has("lipstick mark on neck") && lip.has("lipstick mark") && !lip.has("lipstick"));
  const stack = tagSet(draw(bare, pinsOf("ponytail", "undercut", "antenna hair"), 29));
  ok("an undercut and antenna hair stack with a ponytail", stack.has("ponytail") && stack.has("undercut") && stack.has("antenna hair"));
}

{
  const glasses = tagSet(draw(base({
    counts: { subject: 1, feature: 0, pose: 0, clothing: 4, env: 0 },
    heats: ["tease"], weights: { tease: 1, flash: 0, sex: 0, activity: 0 },
  }), pinsOf("glasses"), 30, clothingExcept("glasses", "eyepatch")));
  ok("an eyepatch does not stack with glasses", glasses.has("glasses") && !glasses.has("eyepatch"));

  const nude = tagSet(draw(base({
    counts: { subject: 1, feature: 0, pose: 0, clothing: 4, env: 0 },
    heats: ["tease"], weights: { tease: 1, flash: 0, sex: 0, activity: 0 },
  }), pinsOf("completely nude"), 31, clothingExcept("completely nude", "nude", "blood on clothes")));
  ok("blood on clothes does not survive being completely nude", nude.has("completely nude") && !nude.has("blood on clothes"));

  const amp = tagSet(draw(sexBare, pinsOf("quadruple amputee"), 32, clothingExcept("bandaged arm", "bandaged leg")));
  ok("a quadruple amputee does not wear arm or leg bandages", amp.has("quadruple amputee") && !amp.has("bandaged arm") && !amp.has("bandaged leg"));
  const ampPose = tagSet(draw(base({
    counts: { subject: 1, feature: 0, pose: 4, clothing: 0, env: 0 },
    heats: ["tease"], weights: { tease: 1, flash: 0, sex: 0, activity: 0 },
  }), pinsOf("quadruple amputee"), 33, posesExcept("fetal position", "lying", "curled up", "hugging own legs", "sitting")));
  ok("a quadruple amputee does not curl up or hug her own legs",
    ampPose.has("quadruple amputee") && !ampPose.has("fetal position") && !ampPose.has("curled up") && !ampPose.has("hugging own legs"));
  const ampBow = tagSet(draw(base({
    counts: { subject: 1, feature: 0, pose: 4, clothing: 0, env: 0 },
    heats: ["tease"], weights: { tease: 1, flash: 0, sex: 0, activity: 0 },
  }), pinsOf("quadruple amputee"), 33, posesExcept("bowing", "standing")));
  ok("a quadruple amputee can still bow", ampBow.has("quadruple amputee") && ampBow.has("bowing") && ampBow.has("standing"));

  const pair = base({
    girl: true, boy: true, heats: ["sex"],
    weights: { tease: 0, flash: 0, sex: 1, activity: 0 },
    counts: { subject: 2, feature: 0, pose: 2, clothing: 0, env: 0 },
  });
  const actBan = new Set();
  for (const t of data.tags) if (t.mutex === "sex_act" && t.tag !== "reverse fellatio" && t.tag !== "fellatio") actBan.add(t.tag);
  let revSeen = 0;
  let revBad = 0;
  for (let i = 0; i < 30; i += 1) {
    const have = tagSet(draw(pair, pinsOf("chastity belt"), 8000 + i, actBan));
    if (!have.has("reverse fellatio")) continue;
    revSeen += 1;
    if (!have.has("chastity belt") || !have.has("fellatio") || !have.has("oral")) revBad += 1;
  }
  ok("a chastity belt still allows reverse fellatio", revSeen > 0 && revBad === 0, `seen=${revSeen} bad=${revBad}`);
  let gagOral = 0;
  for (let i = 0; i < 20; i += 1) {
    const have = tagSet(draw(pair, pinsOf("tape gag"), 8200 + i, actBan));
    if (have.has("reverse fellatio") || have.has("fellatio") || have.has("throat bulge")) gagOral += 1;
  }
  eq("a tape gag blocks reverse fellatio and the throat bulge", gagOral, 0);

  const beltCloth = tagSet(draw(base({
    heats: ["sex"], weights: { tease: 0, flash: 0, sex: 1, activity: 0 },
    counts: { subject: 1, feature: 0, pose: 0, clothing: 4, env: 0 },
  }), pinsOf("chastity belt"), 35, clothingExcept("chastity belt", "bandaid on pussy", "bandaid")));
  ok("a chastity belt blocks a bandaid on pussy", beltCloth.has("chastity belt") && !beltCloth.has("bandaid on pussy"));

  const flash = base({
    heats: ["flash"], weights: { tease: 0, flash: 1, sex: 0, activity: 0 },
    counts: { subject: 1, feature: 0, pose: 4, clothing: 0, env: 0 },
  });
  const underNude = tagSet(draw(flash, pinsOf("completely nude"), 36, posesExcept("hand under clothes")));
  ok("a hand under clothes needs clothes", underNude.has("completely nude") && !underNude.has("hand under clothes"));
  const underShirt = tagSet(draw(flash, pinsOf("shirt"), 37, posesExcept("hand under clothes")));
  ok("a hand under a shirt is drawn", underShirt.has("shirt") && underShirt.has("hand under clothes"));
  const undressNude = tagSet(draw(flash, pinsOf("completely nude"), 38, posesExcept("undressing another")));
  ok("undressing another needs clothes", undressNude.has("completely nude") && !undressNude.has("undressing another"));
  const undressShirt = tagSet(draw(flash, pinsOf("shirt"), 39, posesExcept("undressing another")));
  ok("undressing another in a shirt adds a second girl", undressShirt.has("shirt") && undressShirt.has("undressing another") && undressShirt.has("2girls") && !undressShirt.has("1boy"));
  const grabNude = tagSet(draw(base({
    heats: ["tease"], weights: { tease: 1, flash: 0, sex: 0, activity: 0 },
    counts: { subject: 1, feature: 0, pose: 4, clothing: 0, env: 0 },
  }), pinsOf("completely nude"), 40, posesExcept("clothes grab")));
  ok("grabbing clothes needs clothes", grabNude.has("completely nude") && !grabNude.has("clothes grab"));

  const kiss = tagSet(draw(base({
    heats: ["tease"], weights: { tease: 1, flash: 0, sex: 0, activity: 0 },
    counts: { subject: 1, feature: 0, pose: 4, clothing: 0, env: 0 },
  }), pinsOf("closed mouth"), 41, posesExcept("blowing kiss", "closed mouth")));
  ok("a closed mouth blocks a blown kiss", kiss.has("closed mouth") && !kiss.has("blowing kiss"));
  const cover = tagSet(draw(base({
    heats: ["tease"], weights: { tease: 1, flash: 0, sex: 0, activity: 0 },
    counts: { subject: 1, feature: 0, pose: 4, clothing: 0, env: 0 },
  }), pinsOf("covering own eyes"), 42, posesExcept("covering own eyes", "looking at viewer")));
  ok("covering her own eyes blocks the gaze", cover.has("covering own eyes") && !cover.has("looking at viewer"));
  const glow = tagSet(draw(base({
    heats: ["tease"], weights: { tease: 1, flash: 0, sex: 0, activity: 0 },
    counts: { subject: 1, feature: 4, pose: 0, clothing: 0, env: 0 },
  }), pinsOf("closed eyes"), 43, featuresExcept("closed eyes", "glowing eye", "dilated pupils", "crazy eyes")));
  ok("closed eyes block a glowing eye and dilated pupils", glow.has("closed eyes") && !glow.has("glowing eye") && !glow.has("dilated pupils"));
  const arms = tagSet(draw(base({
    heats: ["tease"], weights: { tease: 1, flash: 0, sex: 0, activity: 0 },
    counts: { subject: 1, feature: 0, pose: 4, clothing: 0, env: 0 },
  }), pinsOf("arms up"), 44, posesExcept("w arms", "arms up", "double v")));
  ok("arms up blocks w arms and double v", arms.has("arms up") && !arms.has("w arms") && !arms.has("double v"));

  // 豁免的意思是：沒有拍照活動，手機仍進得了環境補牌。
  // 環境裡不相干的字現在有兩百多個，40 張自由抽的期望值低於 1。
  // 那是池子變大，不是豁免壞了。這裡只留場地、室內外、晝夜、光線和手機。
  // 豁免一拿掉，這 40 張就會是 0。
  const heldBan = new Set();
  const envSkeleton = new Set(["place", "in_out", "day_night", "lighting"]);
  for (const t of data.tags) {
    if (t.section !== "env") continue;
    if (t.tag === "smartphone" || t.tag === "cellphone") continue;
    if (!envSkeleton.has(t.mutex)) heldBan.add(t.tag);
  }
  let held = 0;
  for (let i = 0; i < 40; i += 1) {
    const have = tagSet(draw(base({
      counts: { subject: 1, feature: 0, pose: 0, clothing: 0, env: 6 },
      heats: ["tease"], weights: { tease: 1, flash: 0, sex: 0, activity: 0 },
    }), new Set(), 9000 + i, heldBan));
    if (have.has("smartphone")) held += 1;
  }
  ok("a smartphone can be drawn without a photo activity", held > 0, `smartphone=${held}/40`);
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("all ok");
