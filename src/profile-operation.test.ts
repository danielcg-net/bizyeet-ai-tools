import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import * as files from "node:fs/promises";
import { profilePaths, withProfileOperationLock } from "./profile-store.js";

void test("profile cleanup failure does not turn a thrown operation into a completed result", async () => {
  const root = await mkdtemp(join(tmpdir(), "bizyeet-profile-failed-"));
  const original = new Error("original operation failure");
  try {
    await assert.rejects(withProfileOperationLock("default", () => { throw original; }, {}, root, {
      ...files, rmdir: () => Promise.reject(new Error("cleanup failure")),
    }), (error: unknown) => error instanceof Error && error.cause === original);
  } finally { await rm(root, { recursive: true, force: true }); }
});

void test("profile operation lock releases after failure and permits other profiles", async (): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "bizyeet-profile-lock-"));
  try {
    await assert.rejects(withProfileOperationLock("default", async (): Promise<never> => {
      assert.deepEqual(await withProfileOperationLock("other", () => Promise.resolve(7), {}, root), { result: 7, cleanupFailed: false });
      throw new Error("synthetic failure");
    }, {}, root), /synthetic failure/u);
    assert.deepEqual(await withProfileOperationLock("default", () => Promise.resolve(9), {}, root), { result: 9, cleanupFailed: false });
    assert.deepEqual(await readdir(profilePaths({}, root).directory), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

void test("concurrent CLI processes retire every displaced synthetic grant", { timeout: 20000 }, async (): Promise<void> => {
  const root = await mkdtemp(join(tmpdir(), "bizyeet-login-processes-"));
  const state = join(root, "synthetic-state.json");
  const revoked = join(root, "synthetic-revoked.jsonl");
  const profile = { issuer: "https://example.test", clientId: "synthetic-client" };
  const initial = { profile, accessToken: "synthetic-old", refreshToken: "synthetic-old", scope: "customers.read", expiresAt: "2099-01-01T00:00:00.000Z" };
  const script = `
    const {run} = await import(process.argv[2]);
    const {withProfileOperationLock} = await import(process.argv[3]);
    const fs = await import('node:fs/promises');
    const {setTimeout} = await import('node:timers/promises');
    const [root,state,revoked] = process.argv.slice(4);
    const profile = {issuer:'https://example.test',clientId:'synthetic-client'};
    const token = 'synthetic-' + process.pid;
    const result = await run(['auth','login','--issuer',profile.issuer], {
      withProfileLock: (name,operation) => withProfileOperationLock(name,operation,{},root),
      readCredentials: async () => ({default:JSON.parse(await fs.readFile(state,'utf8'))}),
      saveCredentials: async (name,value) => fs.writeFile(state,JSON.stringify(value)),
      removeCredentials: async () => {throw Error('unexpected removal')}
    }, {
      revoke: async ({credentials}) => fs.appendFile(revoked,JSON.stringify(credentials.refreshToken)+'\\n'),
      loginBrowser: async () => {await setTimeout(50);return {profile,credentials:{profile,accessToken:token,refreshToken:token,scope:'customers.read',expiresAt:'2099-01-01T00:00:00.000Z'}}},
      loginDevice: async () => {throw Error('unexpected device')},
      getCustomer: async () => {throw Error('unexpected read')},
      listCustomers: async () => {throw Error('unexpected list')}
    });
    if(result.exitCode !== 0) throw Error(result.message);
    console.log(token);
  `;
  try {
    await writeFile(state, JSON.stringify(initial));
    const results = await Promise.all([0, 1, 2, 3].map(() => promisify(execFile)(process.execPath,
      ["--input-type=module", "-e", script, process.execPath, new URL("./cli.js", import.meta.url).href, new URL("./profile-store.js", import.meta.url).href, root, state, revoked], { timeout: 15000 })));
    const issued = results.map(({ stdout }) => stdout.trim());
    const final: unknown = JSON.parse(await readFile(state, "utf8"));
    assert.ok(typeof final === "object" && final !== null && "refreshToken" in final);
    const retired = (await readFile(revoked, "utf8")).trim().split("\n").map((line): unknown => JSON.parse(line));
    assert.equal(retired.length, 4);
    assert.deepEqual(new Set(retired), new Set(["synthetic-old", ...issued.filter((token) => token !== final.refreshToken)]));
    assert.ok(issued.includes(String(final.refreshToken)));
    assert.deepEqual(await readdir(profilePaths({}, root).directory), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
