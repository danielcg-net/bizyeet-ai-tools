import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectRouting } from "./check-canonical-routing.js";

const rejected = [
  'import { listCustomers } from "../server/crm-ledger.js";',
  'export { list } from "../server/zoho-crm/index.js";',
  'const adapter = await import("../server/crm-leads.js");',
  'const adapter = require("../server/zoho-invoice/payments.js");',
  'await fetch("/api/dashboard/crm/customers");',
  'await client.get(`/api/zoho/customers/${id}`);',
  'const endpoint = "/api/" + "airtable/leads"; client.request(endpoint);',
  'const prefix = "/api/dashboard/"; const endpoint = prefix + "crm/leads"; fetch(endpoint);',
  'await fetch("https://www.zohoapis.ca/invoice/v3/contacts");',
  'await client.get("https://api.airtable.com/v0/base/Leads");',
];
await Promise.all(rejected.map((code) => test(`rejects bypass: ${code}`, () => { assert.ok(inspectRouting("src/client.ts", code).length > 0); })));
const allowed = [
  'await client.get("/api/agent/customers");',
  'await fetch(`/api/agent/leads/${id}`);',
  'await client.post("/mcp", message);',
  'await client.post("/oauth/token", request);',
  'import { schema } from "./mcp-contract.js";',
  '// Historical URL: /api/dashboard/crm/customers\nconst ok = true;',
];
await Promise.all(allowed.map((code) => test(`allows canonical code: ${code}`, () => { assert.deepEqual(inspectRouting("src/client.ts", code), []); })));
await test("reports source lines", () => {
  assert.equal(inspectRouting("src/client.ts", '\nfetch("/api/zoho/leads")')[0]?.line, 2);
});
