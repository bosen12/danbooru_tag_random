/** 導影台：REASONS → 棚內人話。只作文案，不改判定。禁賦能／一鍵／完美／智能。 */

export const REASON_COPY = Object.freeze({
  pin_conflict: {
    title: "釘選互斥",
    line: "兩邊並存不了，系統沒有幫你選邊。",
  },
  mutex: {
    title: "互斥打架",
    line: "同一格兩邊並存不了，請改釘選或拿掉其中一個。",
  },
  extra_mutex: {
    title: "額外互斥",
    line: "跟互斥組裡另一邊並存不了，不幫你選邊。",
  },
  user_ban: {
    title: "封禁清單",
    line: "這個字在封禁裡，本輪不進場。",
  },
  heat_mismatch: {
    title: "尺度不合",
    line: "跟目前開的尺度對不上。",
  },
  rating_mismatch: {
    title: "分級牆",
    line: "現在的分級不讓這個字進 POS。",
  },
  era_mismatch: {
    title: "時代不合",
    line: "跟目前時代對不上。",
  },
  cast_mismatch: {
    title: "人選不合",
    line: "跟目前角色人數／性別對不上。",
  },
  pose_activity_conflict: {
    title: "姿勢跟活動打架",
    line: "這個姿勢跟場上活動互相卡住。",
  },
  scene_activity_conflict: {
    title: "場景跟活動打架",
    line: "場地／場景跟活動配不起來。",
  },
  sport_place_mismatch: {
    title: "運動場地不合",
    line: "器材或動作跟場地對不上。",
  },
  clothing_layer: {
    title: "衣層順序",
    line: "穿著層級對不上，這件現在加不進去。",
  },
  underwear_hidden: {
    title: "內衣被蓋住",
    line: "外層還在，這件內衣／走光字現在看不出來。",
  },
  missing_dependency: {
    title: "少了前提",
    line: "要先有別的字，這個才進得了場。",
  },
  reconcile: {
    title: "收尾清掉",
    line: "整卡對完之後，這項跟整體不合被拿掉。",
  },
  repair_remove: {
    title: "補救時拿掉",
    line: "補洞／修場景時把這項移出。",
  },
  replaced: {
    title: "同格衝突",
    line: "同一格出現兩邊，並存不了；不幫你選邊。",
  },
});

/** @param {string} reason */
export function reasonTitle(reason) {
  return REASON_COPY[reason]?.title || "規則不合";
}

/** @param {string} reason */
export function reasonLine(reason) {
  return REASON_COPY[reason]?.line || "本輪規則不讓它留下。";
}

/**
 * 一條「哪裡打架」摘要。related 有對立項時一併寫上，不幫人選邊。
 * @param {{ reason?: string, tag?: string, related?: string[] }} ev
 */
export function clashSummary(ev) {
  const reason = ev?.reason || "";
  const tag = ev?.tag ? String(ev.tag) : "";
  const related = Array.isArray(ev?.related) ? ev.related.filter(Boolean).map(String) : [];
  const title = reasonTitle(reason);
  const line = reasonLine(reason);
  if (tag && related.length) {
    return `${title}：${tag} ↔ ${related.join("、")}。${line}`;
  }
  if (tag) return `${title}：${tag}。${line}`;
  return `${title}。${line}`;
}
