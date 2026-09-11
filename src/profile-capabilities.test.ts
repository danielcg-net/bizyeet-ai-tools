import assert from "node:assert/strict";
import { test } from "node:test";
import { isCredentials } from "./profile-store.js";

await Promise.all([1, 2, 0, -1, 1.5, "1", null, true].map((deviceRegistrationVersion) => test(`validates saved registration version ${String(deviceRegistrationVersion)}`, () => {
  assert.equal(isCredentials({ accessToken: "synthetic", refreshToken: "synthetic", expiresAt: "2099-01-01", scope: "customers.read",
    profile: { clientId: "client", issuer: "https://example.test", deviceRegistrationVersion } }), deviceRegistrationVersion === 1 || deviceRegistrationVersion === 2);
})));

await Promise.all([true, false, "true", 1, null].map((deviceGrantVerified) => test(`validates saved device proof ${String(deviceGrantVerified)}`, () => {
  assert.equal(isCredentials({ accessToken: "synthetic", refreshToken: "synthetic", expiresAt: "2099-01-01", scope: "customers.read",
    profile: { clientId: "client", issuer: "https://example.test", deviceGrantVerified } }), typeof deviceGrantVerified === "boolean");
})));
