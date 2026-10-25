// node 測試載入 web6 時，房間裡沒有的檔（card-art.js、engine.js、scroll-lock.js）改去共用的 web/。
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "web");

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL || "";
  if (specifier.startsWith("./") && parent.includes("/web6/")) {
    const wanted = fileURLToPath(new URL(specifier, parent));
    if (!existsSync(wanted)) {
      return nextResolve(pathToFileURL(join(WEB, specifier.slice(2))).href, context);
    }
  }
  return nextResolve(specifier, context);
}
