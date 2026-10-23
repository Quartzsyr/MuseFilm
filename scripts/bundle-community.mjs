import { readFile, writeFile } from "node:fs/promises";
const workerPath = new URL("../cloudflare/worker.js", import.meta.url);
const [worker, source, template, automation, dashboard, client, operations, email] = await Promise.all([
  readFile(workerPath,"utf8"),
  readFile(new URL("../cloudflare/community.js",import.meta.url),"utf8"),
  readFile(new URL("../cloudflare/admin.html",import.meta.url),"utf8"),
  readFile(new URL("../cloudflare/mail-automation.js",import.meta.url),"utf8"),
  readFile(new URL("../cloudflare/dashboard.js",import.meta.url),"utf8"),
  readFile(new URL("../cloudflare/admin-client.js",import.meta.url),"utf8"),
  readFile(new URL("../cloudflare/operations.js",import.meta.url),"utf8"),
  readFile(new URL("../cloudflare/email-content.js",import.meta.url),"utf8"),
]);
const memberPanel=await readFile(new URL("../cloudflare/membership-panel.html",import.meta.url),"utf8");
const memberClient=await readFile(new URL("../cloudflare/membership-client.js",import.meta.url),"utf8");
const html=template.replace("<!-- INLINE_MEMBERSHIP_PANEL -->",()=>memberPanel).replace("// INLINE_ADMIN_CLIENT",()=>client.replace("// INLINE_MEMBERSHIP_CLIENT",()=>memberClient));
const start="// BEGIN GENERATED COMMUNITY",end="// END GENERATED COMMUNITY";
const generated=`${start}\nconst ADMIN_PAGE_HTML = ${JSON.stringify(html)};\n${email}\n${source}\n${automation}\n${dashboard}\n${operations}\n${end}`;
const next=worker.includes(start) ? worker.slice(0,worker.indexOf(start))+generated+worker.slice(worker.indexOf(end)+end.length) : worker.replace("export default {",generated+"\n\nexport default {");
await writeFile(workerPath,next);
