import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import open from "open";

import { createBrowserLauncher } from "./browser.js";

const targets = [
  "https://example.test/authorize?client_id=public&state=opaque&code_challenge=challenge&resource=https%3A%2F%2Fexample.test",
  "https://example.test/a&echo-owned&/authorize?state=x",
  "https://example.test/a';Write-Output-owned;'‘’‚‛/authorize?state=x",
  "https://example.test/a$(echo-owned)`echo-owned`/authorize?state=x",
];

void test("preserves complete HTTPS authorization targets as opaque opener data", async (): Promise<void> => {
  await Promise.all(targets.map(async (target): Promise<void> => {
    const launch = createBrowserLauncher((value) => {
      assert.equal(value, new URL(target).toString());
      return Promise.resolve();
    });
    await launch(target);
  }));
});

void test("rejects unsafe URL schemes and credential-bearing targets before launching", async (): Promise<void> => {
  const forbidden = createBrowserLauncher(() => Promise.reject(new Error("Must not launch")));
  await Promise.all(["file:///C:/Windows/system32/cmd.exe", "javascript:alert(1)", "http://example.test", "https://user:secret@example.test", "https://example.test/#fragment"].map(async (target): Promise<void> => {
    await assert.rejects(forbidden(target), /OAuth browser target/u);
  }));
});

void test("propagates opener failure so the caller can close its pending callback", async (): Promise<void> => {
  const launch = createBrowserLauncher(() => Promise.reject(new Error("Synthetic opener failure")));
  await assert.rejects(launch(targets[0] ?? ""), /Synthetic opener failure/u);
});

void test("Windows opener passes metacharacter URLs to a capture app as one literal argument", { skip: process.platform !== "win32", timeout: 60_000 }, async (): Promise<void> => {
  const directory = await mkdtemp(join(tmpdir(), "bizyeet-browser-capture-"));
  try {
    const capture = join(directory, "capture.ts");
    await writeFile(capture, 'import {writeFileSync} from "node:fs"; const output = process.argv[2]; if (!output) throw new Error("Missing output"); writeFileSync(output, JSON.stringify(process.argv.slice(3)));\n');
    await Promise.all(targets.map(async (target, index): Promise<void> => {
      const output = join(directory, `result-${String(index)}.json`);
      const launch = createBrowserLauncher((url) => open(url, { wait: true, app: { name: process.execPath, arguments: [capture, output] } }));
      await launch(target);
      assert.deepEqual(JSON.parse(await readFile(output, "utf8")), [new URL(target).toString()]);
    }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
