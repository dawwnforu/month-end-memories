import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the 月末拾光 product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>月末拾光｜照片省纸排版<\/title>/);
  assert.match(html, /选择或拖入照片/);
  assert.match(html, /A4(?:<!-- -->)? 打印预览/);
  assert.match(html, /快捷键/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("implements safe photo keyboard shortcuts and undo", async () => {
  const [page, css, readme] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  assert.match(page, /isEditableTarget\(event\.target\)/);
  assert.match(page, /event\.key === "Delete"/);
  assert.match(page, /event\.key === "Backspace"/);
  assert.match(page, /event\.key === "\+"/);
  assert.match(page, /event\.key === "-"/);
  assert.match(page, /event\.key\.toLowerCase\(\) === "r"/);
  assert.match(page, /undoLastAction\(\)/);
  assert.match(page, /shortcutGuideRef/);
  assert.match(page, /长边增加 1 mm/);
  assert.match(page, /所有页面快捷键都会自动停用/);
  assert.match(css, /\.shortcut-guide/);
  assert.doesNotMatch(page, /shortcut-modal/);
  assert.match(css, /\.shortcut-actions/);
  assert.match(readme, /## 快捷键/);
});
