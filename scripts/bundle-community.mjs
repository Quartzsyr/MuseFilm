import { readFile, writeFile } from "node:fs/promises";
const workerPath = new URL("../cloudflare/worker.js", import.meta.url);
const [worker, source, html] = await Promise.all([
  readFile(workerPath,"utf8"),
  readFile(new URL("../cloudflare/community.js",import.meta.url),"utf8"),
  readFile(new URL("../cloudflare/admin.html",import.meta.url),"utf8"),
]);
const start="// BEGIN GENERATED COMMUNITY",end="// END GENERATED COMMUNITY";
const generated=`${start}\nconst ADMIN_PAGE_HTML = ${JSON.stringify(html)};\n${source}\n${end}`;
const next=worker.includes(start) ? worker.slice(0,worker.indexOf(start))+generated+worker.slice(worker.indexOf(end)+end.length) : worker.replace("export default {",generated+"\n\nexport default {");
await writeFile(workerPath,next);
