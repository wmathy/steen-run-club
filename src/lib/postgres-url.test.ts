import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizePostgresConnectionString } from "@/lib/postgres-url";

const BASE = "postgresql://steen:steen@ep-pooler.aws.neon.tech/neondb";

describe("postgres SSL mode", () => {
  it("rewrites require, prefer, and verify-ca to verify-full", () => {
    assert.equal(
      normalizePostgresConnectionString(`${BASE}?sslmode=require`),
      `${BASE}?sslmode=verify-full`,
    );
    assert.equal(
      normalizePostgresConnectionString(`${BASE}?sslmode=prefer&channel_binding=require`),
      `${BASE}?sslmode=verify-full&channel_binding=require`,
    );
    assert.equal(
      normalizePostgresConnectionString(`${BASE}?channel_binding=require&sslmode=verify-ca`),
      `${BASE}?channel_binding=require&sslmode=verify-full`,
    );
    assert.equal(
      normalizePostgresConnectionString(`${BASE}?sslmode=REQUIRE`),
      `${BASE}?sslmode=verify-full`,
    );
  });

  it("leaves verify-full, disable, and uselibpqcompat strings alone", () => {
    const verifyFull = `${BASE}?sslmode=verify-full`;
    const disabled = `${BASE}?sslmode=disable`;
    const compat = `${BASE}?uselibpqcompat=true&sslmode=require`;
    assert.equal(normalizePostgresConnectionString(verifyFull), verifyFull);
    assert.equal(normalizePostgresConnectionString(disabled), disabled);
    assert.equal(normalizePostgresConnectionString(compat), compat);
    assert.equal(normalizePostgresConnectionString(BASE), BASE);
  });
});
