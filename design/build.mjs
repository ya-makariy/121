/**
 * Assembles one Design Component artboard per file in artboards/, wrapping it in the
 * shell the Claude Design canvas expects and inlining the stylesheet: public/app.css
 * verbatim, then refine.css on top. Output lands in out/ (gitignored, derived).
 *
 * Run: node design/build.mjs
 *
 * The artboards are the visual spec for the tasks in BACKLOG.md. They render the app's
 * real class names against the app's real stylesheet, so a change that looks right here
 * is a change that will look right in the app.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const css = [
  readFileSync(join(here, "..", "public", "app.css"), "utf8"),
  readFileSync(join(here, "refine.css"), "utf8"),
].join("\n");

/** The seven navigation items, so sixteen artboards cannot drift apart in the header. */
const NAV = [
  ["dashboard", "Дашборд"],
  ["people", "Люди"],
  ["compare", "Сравнение"],
  ["actions", "Договорённости"],
  ["templates", "Шаблоны"],
  ["metrics", "Метрики"],
  ["settings", "Настройки"],
];

function header(active) {
  const items = NAV.map(
    ([key, label]) =>
      `        <a href="#"${key === active ? ' class="active"' : ""}>${label}</a>`,
  ).join("\n");
  return `  <header class="top">
    <a class="brand" href="#">121</a>
    <nav>
${items}
    </nav>
    <form class="lang">
      <button type="button" title="EN">EN</button>
    </form>
  </header>`;
}

const shell = (body) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>
${css}
  </style>
</helmet>
${body}
</x-dc>
</body>
</html>
`;

const out = join(here, "out");
mkdirSync(out, { recursive: true });

let n = 0;
for (const file of readdirSync(join(here, "artboards")).sort()) {
  if (!file.endsWith(".html")) continue;
  const name = file.replace(/\.html$/, "");
  const body = readFileSync(join(here, "artboards", file), "utf8").trimEnd();
  writeFileSync(
    join(out, `${name}.dc.html`),
    shell(body.replace(/<!--nav:([a-z-]*)-->/g, (_, active) => header(active))),
  );
  n += 1;
}
console.log(`built ${n} artboards into design/out/`);
