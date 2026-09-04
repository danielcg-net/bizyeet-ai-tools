import assert from "node:assert/strict";
import test from "node:test";

import { browserCommand } from "./browser.js";

void test("passes OAuth URLs as a single shell-free browser argument", (): void => {
  const url = "https://example.test/authorize?state=opaque-value";

  assert.deepEqual(browserCommand("darwin", url), { arguments: [url], executable: "open" });
  assert.deepEqual(browserCommand("win32", url), { arguments: ["/d", "/s", "/c", "start", "", url], executable: "cmd.exe" });
});
