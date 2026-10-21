import { pathToFileURL } from "node:url";
import fs from "node:fs";
const [, , jsPath, vecPath] = process.argv;
const { evaluate } = await import(pathToFileURL(jsPath).href);
const vecs = JSON.parse(fs.readFileSync(vecPath, "utf8"));
let bad = 0;
for (const v of vecs) {
  try {
    const r = evaluate(v.f, v.fields || {}, v.cols || {});
    if (v.error) { bad++; console.log("expected error:", v.f); continue; }
    const ok = typeof r === "string" ? r === v.out : Math.abs(r - Number(v.out)) < 1e-9;
    if (!ok) { bad++; console.log("MISMATCH", v.f, r, v.out); }
  } catch (e) {
    if (!v.error) { bad++; console.log("ERR", v.f, e.message); }
  }
}
console.log(bad ? `${bad} failed` : `all ${vecs.length} ok`);
process.exit(bad ? 1 : 0);
