/**
 * 相關的牌：網頁過濾、快取，以及伺服器 /api/related 的擋法。
 * 不開瀏覽器、不打 Danbooru、不打 /api/gen。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const NL = String.fromCharCode(10);

registerHooks({
  resolve(specifier, context, next) {
    const parent = context.parentURL ? fileURLToPath(context.parentURL) : "";
    // web6 的畫面檔有幾支是伺服器從 web/ 補上的（card-art.js、scroll-lock.js）。node 沒有這層。
    if (specifier.startsWith("./") && dirname(parent) === join(root, "web6")) {
      const local = join(dirname(parent), specifier.slice(2));
      if (!existsSync(local)) {
        const shared = join(root, "web", specifier.slice(2));
        if (existsSync(shared)) return next(pathToFileURL(shared).href, context);
      }
    }
    return next(specifier, context);
  },
});

globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.location = { href: "http://127.0.0.1:8787/", origin: "http://127.0.0.1:8787", search: "", hash: "", pathname: "/" };
globalThis.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
{
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}
globalThis.document = {
  // loading：i18n 等 DOMContentLoaded 才翻譯。測試不發那個事件，載入時不碰畫面。
  readyState: "loading",
  documentElement: { style: { overflow: "" }, dataset: {}, lang: "" },
  body: { style: { overflow: "" }, children: [] },
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
};

const { normTag, relatedDots, relatedDotLabel, relatedValue, filterRelated, loadRelated, clearRelatedCache, wikiAllowed, trailTo, TRAIL_MAX, pickRelated, DOT_MIN } = await import(
  pathToFileURL(join(root, "web6/related.js")).href
);

let failed = 0;
function ok(name, cond, detail) {
  if (cond) console.log(`ok   ${name}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}` + (detail ? NL + "  " + detail : ""));
  }
}

const card = (tag, extra = {}) => ({ tag, zh: extra.zh || tag, suit: extra.suit || "look", ...extra });
const lib = new Map(
  [
    ["serafuku", card("serafuku", { zh: "水手服" })],
    ["sailor collar", card("sailor collar")],
    ["school uniform", card("school uniform")],
    ["family", card("family")],
    ["loli", card("loli")],
    ["anya (spy x family)", card("anya (spy x family)")],
    ["kindergarten", card("kindergarten")],
    ["yor briar", card("yor briar")],
    ["gold hairband", card("gold hairband")],
    ["beach", card("beach")],
    ["bikini", card("bikini")],
    ["trash me", card("trash me")],
    ["hot", card("hot", { rating: "explicit", item: { tag: "hot" } })],
    ["banned char", card("banned char", { banned: true })],
    ["my custom", card("my custom", { suit: "custom", custom: { id: "1" } })],
    ["wrapped", card("wrapped", { suit: "look", custom: { id: "2" } })],
    ...Array.from({ length: 10 }, (_, i) => [`safe ${i}`, card(`safe ${i}`)]),
  ]
);
const find = (name) => lib.get(name) || lib.get(normTag(name));
const base = {
  card: find,
  hardBanned: ["loli", "shota"],
  characterBan: ["anya (spy x family)"],
  guard: ["family", "kindergarten", "yor briar"],
  trash: () => ["trash me"],
  ratingBlocked: (c) => c.rating === "explicit",
};

const school = filterRelated(
  [
    ["serafuku", 606],
    ["school uniform", 100],
    ["family", 400],
    ["loli", 900],
    ["anya (spy x family)", 800],
    ["anya_(spy_x_family)", 700],
    ["kindergarten", 300],
    ["yor briar", 200],
    ["not a real tag", 150],
    ["Serafuku", 111],
    ["trash me", 180],
    ["hot", 500],
    ["banned char", 500],
    ["my custom", 500],
    ["wrapped", 500],
    ["sailor collar", 403],
  ],
  { ...base, self: "school uniform" }
);
ok(
  "學校制服只留下能顯示的牌，順序不變",
  school.map((x) => x.tag).join() === "serafuku,sailor collar",
  school.map((x) => x.tag).join()
);
ok("重複的牌留第一次的相關度", school[0].milli === 606);
ok("相關度不寫小數", !relatedDotLabel(606).includes(".") && relatedDotLabel(606) === "相關度：三格");
ok("三格：199 一格、200 兩格、499 兩格、500 三格", relatedDots(199) === 1 && relatedDots(200) === 2 && relatedDots(499) === 2 && relatedDots(500) === 3);
ok("底線和大小寫收成同一種", normTag("Anya_(Spy_X_Family)") === "anya (spy x family)");

const many = filterRelated(
  Array.from({ length: 10 }, (_, i) => [`safe ${i}`, 100 + i]),
  { ...base, self: "school uniform" }
);
ok("最多 8 張，前面的先留", many.length === 8 && many[0].tag === "safe 0" && many[7].tag === "safe 7");
ok("上限 0 不留", filterRelated([["serafuku", 100]], { ...base, limit: 0 }).length === 0);
// wiki 說明：只看 hardban（HARD_BANNED、禁用角色），不看 guard、分級。
ok("wiki：一般的牌顯示", wikiAllowed("school uniform", { hardBanned: ["loli"], characterBan: ["anya (spy x family)"] }));
ok("wiki：HARD_BANNED 不顯示（底線、大小寫照樣認）", !wikiAllowed("Loli", { hardBanned: ["loli"] }));
ok("wiki：禁用角色不顯示", !wikiAllowed("anya_(spy_x_family)", { characterBan: ["anya (spy x family)"] }));
ok("wiki：空名字不顯示", !wikiAllowed("", {}));
// 滑鼠放在點上看相關值。
ok("相關值兩位小數", relatedValue(611) === "0.61" && relatedValue(50) === "0.05" && relatedValue(1000) === "1.00" && relatedValue("x") === "");
// 麵包屑：點回路上的牌就退回那一步（不繞圈）；太長只留最後 TRAIL_MAX 張。
ok("麵包屑：新的牌接在後面", JSON.stringify(trailTo("pleated skirt", ["school uniform", "serafuku"])) === JSON.stringify(["school uniform", "serafuku"]));
ok("麵包屑：點回路上的牌退回那一步", JSON.stringify(trailTo("School_Uniform", ["school uniform", "serafuku"])) === "[]" && JSON.stringify(trailTo("serafuku", ["school uniform", "serafuku", "neckerchief"])) === JSON.stringify(["school uniform"]));
ok("麵包屑：只留最後 TRAIL_MAX 張", trailTo("z", Array.from({ length: 30 }, (_, i) => "t" + i)).length === TRAIL_MAX);
ok("自己那張不推薦", filterRelated([["bikini", 100]], { ...base, self: "bikini" }).length === 0);

clearRelatedCache();
{
  let n = 0;
  const fetchImpl = async (url) => {
    n += 1;
    ok("問的是收成小寫空白的 tag", String(url).includes("tag=school+uniform") || String(url).includes("tag=school%20uniform"), String(url));
    return {
      ok: true,
      json: async () => ({ ok: true, items: { "school uniform": [["serafuku", 600]] }, guard: ["Family"] }),
    };
  };
  const a = await loadRelated("School_Uniform", fetchImpl);
  const b = await loadRelated("school uniform", fetchImpl);
  ok("成功的回應記在這頁", n === 1 && a.items.length === 1 && a === b);
  ok("guard 收成小寫", a.guard.has("family") && !a.guard.has("Family"));
}
{
  let release;
  let n = 0;
  const fetchImpl = () => {
    n += 1;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  clearRelatedCache();
  const a = loadRelated("bikini", fetchImpl);
  const b = loadRelated("bikini", fetchImpl);
  ok("同一張同時問只打一次", a === b && n === 1);
  release({ ok: true, json: async () => ({ ok: true, items: { bikini: [["beach", 200]] }, guard: [] }) });
  ok("兩次等到同一份", (await a) === (await b));
}
{
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    throw new Error("down");
  };
  clearRelatedCache();
  ok("連不上回空、不記快取", (await loadRelated("beach", fetchImpl)) === null);
  ok("下次還會再問", (await loadRelated("beach", fetchImpl)) === null && n === 2);
}
{
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    return { ok: true, json: async () => ({ ok: false }) };
  };
  clearRelatedCache();
  await loadRelated("beach", fetchImpl);
  await loadRelated("beach", fetchImpl);
  ok("ok:false 不記快取", n === 2);
}
{
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    return { ok: true, json: async () => ({ ok: true, items: {}, guard: [] }) };
  };
  clearRelatedCache();
  const packed = await loadRelated("beach", fetchImpl);
  await loadRelated("beach", fetchImpl);
  ok("空清單也算成功，不再問", n === 1 && packed.items.length === 0);
}

// 補相關牌的挑法（更多規則、合成池右鍵小面板共用）：幾個點以上、同一張取最高、起點和 exclude 不算、顯示那套過濾照用。
clearRelatedCache();
{
  const answers = {
    bikini: [["beach", 600], ["safe 1", 300], ["safe 2", 150], ["loli", 900], ["hot", 800], ["trash me", 700]],
    "safe 1": [["beach", 450], ["safe 3", 520], ["bikini", 900], ["safe 4", 210]],
  };
  const fetchImpl = async (url) => {
    const tag = new URL(String(url), "http://x").searchParams.get("tag");
    return { ok: true, json: async () => ({ ok: true, items: { [tag]: answers[tag] || [] }, guard: [] }) };
  };
  const two = await pickRelated(["bikini", "safe 1"], { dots: 2, ctx: base, fetchImpl });
  ok("補相關：兩個點以上、照相關度排、同一張取最高（beach 600 不是 450）",
    JSON.stringify(two.map((x) => [x.tag, x.milli])) === JSON.stringify([["beach", 600], ["safe 3", 520], ["safe 4", 210]]), JSON.stringify(two.map((x) => [x.tag, x.milli])));
  ok("補相關：起點那幾張不算（safe 1 被 bikini 推薦也不補）", !two.some((x) => x.tag === "safe 1" || x.tag === "bikini"));
  ok("補相關：未成年、分級擋掉、廢字簍照擋", !two.some((x) => ["loli", "hot", "trash me"].includes(x.tag)));
  const three = await pickRelated(["bikini", "safe 1"], { dots: 3, ctx: base, fetchImpl });
  ok("補相關：三個點只收 0.5 以上", JSON.stringify(three.map((x) => x.tag)) === JSON.stringify(["beach", "safe 3"]), JSON.stringify(three.map((x) => x.tag)));
  const one = await pickRelated(["bikini"], { dots: 1, ctx: base, exclude: ["beach"], fetchImpl });
  ok("補相關：一個點全收、exclude 不算", JSON.stringify(one.map((x) => x.tag)) === JSON.stringify(["safe 1", "safe 2"]), JSON.stringify(one.map((x) => x.tag)));
  ok("補相關：門檻跟點數的分界一樣", DOT_MIN[1] === 0 && DOT_MIN[2] === 200 && DOT_MIN[3] === 500 && relatedDots(199) === 1 && relatedDots(200) === 2 && relatedDots(500) === 3);
  ok("補相關：沒有起點回空的", (await pickRelated([], { fetchImpl })).length === 0);
}

// 引擎：補相關牌照順序試、過規則才補、記成 related；關著跟原本一模一樣。
{
  const eng = await import(pathToFileURL(join(root, "web/engine.js")).href);
  const data = JSON.parse(readFileSync(join(root, "web/lexicon.json"), "utf8"));
  const lex = eng.indexLexicon(data);
  const base2 = eng.sanitizeSettings({ ...eng.defaultSettings(data), girl: true, boy: false, heats: ["tease"], eras: ["modern"] }, data);
  ok("補相關：預設關著", base2.relatedFill.on === false && base2.relatedFill.dots === 2 && base2.relatedFill.max === 3);
  const pins = new Set(["school uniform"]);
  const want = ["serafuku", "pleated skirt", "neckerchief", "sailor collar", "white shirt"];
  let same = 0;
  for (let i = 0; i < 12; i++) {
    const a = eng.drawOne(lex, base2, pins, new Set(), eng.mulberry32(100 + i), 100 + i).positive;
    const off = eng.sanitizeSettings({ ...base2, relatedFill: { on: false, dots: 2, max: 3, tags: want } }, data);
    if (a === eng.drawOne(lex, off, pins, new Set(), eng.mulberry32(100 + i), 100 + i).positive) same += 1;
  }
  ok("補相關：關著（就算帶了 tags）抽法一模一樣", same === 12, `${same}/12`);
  const on = eng.sanitizeSettings({ ...base2, relatedFill: { on: true, dots: 2, max: 3, tags: want } }, data);
  const d = eng.drawOne(lex, on, pins, new Set(), eng.mulberry32(201), 201, { trace: true });
  const rel = d.trace.kept.filter((k) => k.source === "related").map((k) => k.tag);
  ok("補相關：照順序補到最多 3 張，記成 related（serafuku 跟學生制服互斥，跳過）", JSON.stringify(rel) === JSON.stringify(["pleated skirt", "neckerchief", "sailor collar"]), JSON.stringify(rel));
  const mutex = eng.sanitizeSettings({ ...base2, relatedFill: { on: true, dots: 1, max: 2, tags: ["black shirt", "pleated skirt", "neckerchief"] } }, data);
  const d2 = eng.drawOne(lex, mutex, new Set(["white shirt"]), new Set(), eng.mulberry32(7), 7, { trace: true });
  ok("補相關：跟釘的牌同一格（上衣）的跳過", !d2.positive.split(", ").includes("black shirt") && d2.trace.kept.filter((k) => k.source === "related").length === 2);
  const era = eng.sanitizeSettings({ ...base2, relatedFill: { on: true, dots: 1, max: 1, tags: ["hanfu", "pleated skirt"] } }, data);
  const d3 = eng.drawOne(lex, era, new Set(), new Set(), eng.mulberry32(9), 9, { trace: true });
  ok("補相關：時代不對的跳過（現代不補漢服）", JSON.stringify(d3.trace.kept.filter((k) => k.source === "related").map((k) => k.tag)) === JSON.stringify(["pleated skirt"]));
  const banned = eng.sanitizeSettings({ ...base2, relatedFill: { on: true, dots: 1, max: 2, tags: ["randoseru", "pleated skirt"] } }, data);
  const d4 = eng.drawOne(lex, banned, new Set(), new Set(), eng.mulberry32(11), 11);
  ok("補相關：永遠不抽的字不補", !d4.positive.split(", ").includes("randoseru"));
  // 2026-11-28 專案主：「只有自己釘才會出現」的牌，補相關牌照補（動彈不得配固定式拘束具）。
  const odd = eng.sanitizeSettings({ ...base2, heats: ["sex"], rating: "explicit", relatedFill: { on: true, dots: 1, max: 2, tags: ["immobilization", "forced orgasm"] } }, data);
  const d5 = eng.drawOne(lex, odd, new Set(["stationary restraints"]), new Set(), eng.mulberry32(300), 300, { trace: true });
  const rel5 = d5.trace.kept.filter((k) => k.source === "related").map((k) => k.tag);
  ok("補相關：只有自己釘才會出現的牌照補", rel5.includes("immobilization") && rel5.includes("forced orgasm"), JSON.stringify(rel5));
  const plain = eng.sanitizeSettings({ ...base2, heats: ["sex"], rating: "explicit" }, data);
  let leak = 0;
  for (let i = 0; i < 30; i++) {
    const p = eng.drawOne(lex, plain, new Set(["stationary restraints"]), new Set(), eng.mulberry32(600 + i), 600 + i).positive.split(", ");
    if (p.includes("immobilization") || p.includes("forced orgasm")) leak++;
  }
  ok("補相關關著：那種牌照舊不會自己冒出來", leak === 0, `${leak}/30`);
  ok("補相關：設定清乾淨（點數 1～3、張數 1～12、tags 只收字串）",
    JSON.stringify(eng.sanitizeRelatedFill({ on: "yes", dots: 9, max: 99, tags: ["a", 3, "a", null, "b"] })) === JSON.stringify({ on: false, dots: 3, max: 12, tags: ["a", "b"] }));
}

const read = (rel) => readFileSync(join(root, rel), "utf8");
const relatedJs = read("web6/related.js");
const appJs = read("web6/app.js");
const bookJs = read("web6/book.js");
const fuseJs = read("web6/fuse.js");
const css = read("web6/styles.css");
const en = read("web6/locales/en.js");
ok("拿掉相關牌用 dropAnimated，不直接 remove", relatedJs.includes("dropAnimated(") && !relatedJs.includes(".remove("));
// 2026-11-28：晚到的說明、相關的牌改成整個視窗 FLIP（上緣、高度一起滑），位移疊在進場動畫上；抓過的當下就放、跟著進場。
const uiJs = read("web6/ui.js");
ok("晚到的整個視窗一起長高（ui.js resizeSheet：慢起步、記在 sheet._grow 給 autoHeight 讓開），小牌用 enter",
  relatedJs.includes("resizeSheet(") && /export function resizeSheet[\s\S]*?CURVE\.travel[\s\S]*?sheet\._grow = a/.test(uiJs) && relatedJs.includes("enter("));
ok("同一個視窗換牌：換之前量高度、換完當下就開始變", /export function swapSheet[\s\S]*?const finish = resizeSheet\(sheet\)[\s\S]*?finish\(\);/.test(uiJs));
ok("抓過的當下就放，跟著視窗進場", relatedJs.includes("cache.get(normTag(opts.tag))") && relatedJs.includes("placeRelated(parent, opts, ready, false)"));
ok("滑鼠停在牌上就先抓", relatedJs.includes("export function installRelatedPrefetch") && appJs.includes("installRelatedPrefetch()"));
// 2026-11-28：點相關的牌在同一個視窗裡換（swapSheet），最上面麵包屑；不再一層一層疊視窗。
ok("字盒詳情接上相關的牌，同一個視窗換、有麵包屑", appJs.includes("mountRelated(") && appJs.includes("relatedTrail(") && appJs.includes("swapSheet(into") && appJs.includes("into: sheet") && !appJs.includes("back: true"));
ok("卡冊詳情接上相關的牌，放在用過的圖前面，同一個視窗換", bookJs.includes("mountRelated(") && bookJs.includes("before: works") && bookJs.includes("relatedTrail(") && bookJs.includes("swapSheet(into") && !bookJs.includes("back: true"));
const fillJs = read("web6/related-fill.js");
ok("更多規則有補相關牌（開關、幾個點以上、最多幾張），抽牌帶 tags 給引擎", appJs.includes('switchBox("補相關牌"') && appJs.includes("relatedFill: { ...grouped.relatedFill, tags: intent.relatedTags }") && appJs.includes("pickRelated([...intent.pool]"));
ok("合成池的牌右鍵開帶入相關牌小面板、詳情也有一顆", appJs.includes("openPoolRelated(t, node)") && appJs.includes('"帶入相關牌…"'));
ok("帶入時不擠掉池子裡的牌", appJs.includes("if ([...sim].some((t) => !next.pinned.has(t))) continue;"));
ok("成品標「補相關」", appJs.includes('related: "補相關"'));
ok("相關值：滑過整張小牌就淡入（手機一直顯示）", relatedJs.includes('class: "related-val"') && /\.related-slot:hover \.related-val/.test(css) && /@media \(hover: none\)[\s\S]*?\.related-val/.test(css));
ok("小面板：位置打開時算一次、高度平順變、讀取中有佔位、淡入淡出", fillJs.includes("box.style.bottom") && fillJs.includes("const resize = (from)") && fillJs.includes("rf-chip-ghost") && fillJs.includes("dropAnimated(o.box)"));
ok("看過的牌有上限", relatedJs.includes("export const TRAIL_MAX") && appJs.includes("trailTo(next, nextTrail)") && bookJs.includes("trailTo(next, nextTrail)"));
// 2026-11-28：牌飛進詳情收成 motion.js 的 detailFlight（字盒、卡冊共用；先量來源、換完內容再飛）。
const motionJs = read("web6/motion.js");
ok("飛進詳情落地用 dropAnimated（motion.js detailFlight）", /export function detailFlight[\s\S]*?const land = \(\) => \{\s*dropAnimated\(f\);/.test(motionJs));
ok("飛進詳情的複製品不帶份量、池中章", /export function detailFlight[\s\S]*?querySelectorAll\("\.card-w, \.card-flag"\)/.test(motionJs));
ok("字盒、卡冊都先量來源再換內容", appJs.includes("const flight = detailFlight(srcNode)") && bookJs.includes("const flight = detailFlight(srcNode)"));
ok("疊印台不加相關的牌", !fuseJs.includes("mountRelated"));
ok("電腦 4 欄、手機橫捲、觸控至少 44px", css.includes("repeat(4, minmax(0, 1fr))") && css.includes("scroll-snap-type: x mandatory") && css.includes("width: 44px"));
for (const line of ["相關的牌|Related cards", "Danbooru 上常一起出現|Often tagged together on Danbooru", "← 上一張|← Previous card", "相關度：一格|Relatedness: one dot", "相關度：兩格|Relatedness: two dots", "相關度：三格|Relatedness: three dots", "放進合成池：{0}|Add to the mix: {0}", "已經在合成池：{0}|Already in the mix: {0}"]) {
  ok(`英文有「${line.split("|")[0]}」`, en.includes(line));
}

const work = mkdtempSync(join(tmpdir(), "related-cards-"));
const py = join(work, "check_related.py");
writeFileSync(
  py,
  `
import json, os, sys
from pathlib import Path
root = sys.argv[1]
work = Path(sys.argv[2])
os.environ["NO_OUTPUT_PRUNE"] = "1"
os.environ["GEN_LOG_PATH"] = str(work / "gen_log.jsonl")
os.environ["APP_SETTINGS"] = str(work / "settings.json")
os.environ["CARD_ART_CUSTOM_PATH"] = str(work / "card_art_custom.json")
os.environ["NO_CARD_BAKE"] = "1"
os.environ["THUMB_CACHE_DIR"] = str(work / "thumb-cache")
sys.path.insert(0, root)
import server

failed = 0
def ok(name, cond, detail=""):
    global failed
    if cond:
        print("ok  ", name)
    else:
        failed += 1
        print("FAIL", name, detail)

ok("yor briar 是角色", "yor briar" in server.character_names())
ok("family 不是角色", "family" not in server.character_names())
ok("anya 在 characterBan", "anya (spy x family)" in server.character_ban())

server._RELATED_OVERRIDE = work / "missing.json"
server._WIKI_OVERRIDE = work / "missing-wiki.json"
missing = server.related_payload(["school uniform"])
ok("沒有關聯檔回空的", missing == {"ok": True, "items": {}, "wiki": {}, "guard": []}, str(missing))

bad = work / "bad.json"
bad.write_text("{", encoding="utf-8")
server._RELATED_OVERRIDE = bad
broken = server.related_payload(["school uniform"])
ok("壞掉的 JSON 回空的", broken["ok"] is True and broken["items"] == {} and broken["guard"] == [], str(broken))

doc = {
  "version": 1,
  "guard": ["family", "yor briar", "kindergarten"],
  "related": {
    "school uniform": ["serafuku", 600, "school uniform", 100, "family", 400, "loli", 900, "anya (spy x family)", 800, "anya_(spy_x_family)", 700, "kindergarten", 300, "yor briar", 200, "not a real tag", 150],
    "family": ["school uniform", 400],
    "yor briar": ["gold hairband", 328, "family", 200, "loli", 100],
    "loli": ["school uniform", 100],
    "bikini": ["beach", 200],
  },
}
path = work / "related.json"
path.write_text(json.dumps(doc), encoding="utf-8")
os.utime(path, (1700000000, 1700000000))
server._RELATED_OVERRIDE = path
one = server.related_payload(["School_Uniform"])
ok("大小寫、底線對到檔裡的名字", list(one["items"]) == ["school uniform"], str(one))
ok(
  "學校制服拿掉自己、guard、未成年、禁用角色",
  one["items"]["school uniform"] == [["serafuku", 600], ["not a real tag", 150]],
  str(one["items"].get("school uniform")),
)
ok("guard 名單照檔案回給網頁再擋一次", one["guard"] == ["family", "yor briar", "kindergarten"])
ok("family 是 guard 又不是角色：沒有清單", "family" not in server.related_payload(["family"])["items"])
yor = server.related_payload(["yor briar"])
ok("guard 裡的角色仍有自己的清單，值照樣擋", yor["items"].get("yor briar") == [["gold hairband", 328]], str(yor))
ok("loli 不給清單", "loli" not in server.related_payload(["loli"])["items"])
ok("禁用角色不給清單", server.related_payload(["anya (spy x family)"])["items"] == {})
ok("問多張時擋掉的那張不出現", "bikini" in server.related_payload(["bikini", "loli", "family"])["items"] and "loli" not in server.related_payload(["bikini", "loli", "family"])["items"])

# wiki 說明：資料照存未成年的字，回傳前只靠 hardban（HARD_BANNED、禁用角色）擋。
wiki_path = work / "tag_wiki.json"
wiki_path.write_text(json.dumps({"version": 1, "wiki": {
  "school uniform": "A uniform commonly worn by students.",
  "loli": "should never be shown",
  "anya (spy x family)": "should never be shown",
  "bikini": "A two-piece swimsuit.",
}}), encoding="utf-8")
server._WIKI_OVERRIDE = wiki_path
w = server.related_payload(["School_Uniform", "loli", "anya (spy x family)", "bikini", "not in wiki"])
ok("wiki 說明跟著回、名字正規化", w["wiki"].get("school uniform") == "A uniform commonly worn by students." and w["wiki"].get("bikini") == "A two-piece swimsuit.", str(w["wiki"]))
ok("wiki：未成年的字（HARD_BANNED）不給", "loli" not in w["wiki"], str(w["wiki"]))
ok("wiki：禁用角色不給", all("anya" not in k for k in w["wiki"]), str(w["wiki"]))
ok("wiki：沒有說明的不出現", "not in wiki" not in w["wiki"])
server._WIKI_OVERRIDE = work / "missing-wiki.json"
ok("wiki 檔不在：空的、不壞", server.related_payload(["school uniform"])["wiki"] == {})

names = ["school uniform"] + [f"t{i}" for i in range(19)] + ["bikini"]
got = server.related_query_tags("tags=" + ",".join(names))
ok("最多 20 個，第 21 個不看", len(got) == 20 and got[0] == "school uniform" and "bikini" not in got, str(got))
capped = server.related_payload(got)
ok("超過的那張不會被回", "bikini" not in capped["items"] and "school uniform" in capped["items"])
ok("有 tags 就不看 tag", server.related_query_tags("tags=bikini&tag=school%20uniform") == ["bikini"])
ok("重複的只算一個", server.related_query_tags("tags=bikini,bikini,Bikini") == ["bikini"])

doc["related"]["bikini"] = ["beach", 500]
path.write_text(json.dumps(doc), encoding="utf-8")
os.utime(path, (1700000100, 1700000100))
ok("檔案改了（mtime）會重讀", server.related_payload(["bikini"])["items"]["bikini"] == [["beach", 500]])

h = server.Handler.__new__(server.Handler)
h.path = "/api/related?tag=school%20uniform"
h._allowed = lambda: True
sent = {}
h._json = lambda code, obj, *a, **k: sent.update(code=code, obj=obj)
h._do_get()
ok("GET /api/related 走這條、200", sent.get("code") == 200 and sent.get("obj", {}).get("items", {}).get("school uniform", [])[:1] == [["serafuku", 600]], str(sent))

h.path = "/api/related?tag=loli"
sent.clear()
h._do_get()
ok("GET 問 loli 也是 200 而且沒有清單", sent.get("code") == 200 and sent.get("obj", {}).get("items") == {}, str(sent))

sys.exit(failed)
`,
  "utf8"
);
const pyRun = spawnSync("python", [py, root, work], {
  encoding: "utf8",
  env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
});
process.stdout.write(pyRun.stdout || "");
process.stderr.write(pyRun.stderr || "");
if (pyRun.error) {
  failed += 1;
  console.error(`FAIL 起不了 python ${pyRun.error.message}`);
} else if (pyRun.status !== 0) {
  failed += 1;
  console.error(`FAIL 伺服器相關牌測試（exit ${pyRun.status}）`);
}
rmSync(work, { recursive: true, force: true });

if (failed) {
  console.error(`相關的牌測試：${failed} 項沒過`);
  process.exit(1);
}
console.log("相關的牌測試通過");
