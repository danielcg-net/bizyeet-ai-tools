import assert from "node:assert/strict";
import { test } from "node:test";
import { validSalesSearch, validCrmSearch } from "./search-contract.js";
import { createCanonicalCrmClient } from "./canonical-crm-client.js";
import { run } from "./cli.js";
import { mcpReadTools } from "./mcp-contract.js";

const forbidden = (): never => { throw new Error("Must reject before credential access"); };

void test("sales search matches the canonical Unicode bound without narrowing CRM search", () => {
  ["", "x".repeat(120), "😀".repeat(120)].forEach((value) => { assert.equal(validSalesSearch(value), true); });
  ["x".repeat(121), "😀".repeat(121), "\ud800", null, 4].forEach((value) => { assert.equal(validSalesSearch(value), false); });
  assert.equal(validCrmSearch("x".repeat(200)), true);
});

void test("catalog and sales reject oversized search before OAuth or CLI credentials", async () => {
  const client = createCanonicalCrmClient({ origin: "https://example.test", getAccessToken: forbidden });
  await Promise.all((["catalog", "quotes", "services"] as const).map(async (resource) => {
    await Promise.all(["x".repeat(121), "😀".repeat(121), "\ud800"].map(async (search) => {
      assert.equal((await client.list(resource, { search })).status, 400);
      assert.equal((await run([resource, "list", "--search", search],
        { readCredentials: forbidden, saveCredentials: forbidden, removeCredentials: forbidden },
        { loginBrowser: forbidden, loginDevice: forbidden, listCustomers: forbidden, getCustomer: forbidden, revoke: forbidden })).exitCode, 2);
    }));
  }));
});

void test("sales MCP schemas advertise the canonical 120 search bound", () => {
  const tools = mcpReadTools.filter((tool) => ["bizyeet_catalog_list", "bizyeet_quotes_list", "bizyeet_services_list"].includes(tool.name));
  assert.equal(tools.length, 3);
  tools.forEach((tool) => {
    assert.ok("search" in tool.inputSchema.properties);
    assert.equal(tool.inputSchema.properties.search.maxLength, 120);
  });
});

void test("120 supplementary characters reach each canonical endpoint unchanged", async () => {
  const search = "😀".repeat(120);
  const client = createCanonicalCrmClient({ origin: "https://example.test", getAccessToken: () => Promise.resolve("synthetic-oauth"),
    request: (url) => {
      assert.equal(new URL(url).searchParams.get("search"), search);
      return Promise.resolve(Response.json({ data: { items: [], total: 0 }, meta: { contract_version: "v1", next_cursor: null } }));
    } });
  await Promise.all((["catalog", "quotes", "services"] as const).map(async (resource) => {
    assert.equal((await client.list(resource, { search })).status, 200);
  }));
});
