import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.DATABASE_URL ??=
  "postgresql://steen:steen@127.0.0.1:5432/steen_test?sslmode=disable";

const header = {
  title: "5K Sub-18 Block (Post-Hixon)",
  startDate: "2026-10-26",
  reason: "new_plan" as const,
  goal: "5K under 18:00 by ~Jan 1 2027",
  endDate: "2027-01-01",
  raceDate: "2027-01-01",
  taperDays: 12,
  notes: "Less volume, more intensity.",
  replaceActive: true,
};

describe("save_or_update_plan weeks", () => {
  it("returns a tool error instead of a schema failure when weeks is omitted", async () => {
    const { asSchema } = await import("ai");
    const { createCoachTools, SAVE_PLAN_WEEKS_REQUIRED } = await import(
      "@/lib/tools"
    );
    const saveTool = createCoachTools("user-test").save_or_update_plan;
    const schema = asSchema(saveTool.inputSchema);
    assert.equal(typeof schema.validate, "function");

    let thrown: unknown = null;
    let validated: Awaited<ReturnType<NonNullable<typeof schema.validate>>> | null =
      null;
    try {
      validated = await schema.validate!(header);
    } catch (err) {
      thrown = err;
    }
    assert.equal(thrown, null);
    assert.equal(validated?.success, true);
    if (!validated?.success) return;

    const execute = saveTool.execute;
    assert.ok(execute);
    const result = await execute(validated.value, {
      toolCallId: "missing-weeks",
      messages: [],
      context: {},
    });
    assert.ok(result && typeof result === "object" && "success" in result);
    assert.equal(result.success, false);
    assert.equal(
      "error" in result ? result.error : undefined,
      SAVE_PLAN_WEEKS_REQUIRED,
    );
  });

  it("returns the same tool error when weeks is empty", async () => {
    const { asSchema } = await import("ai");
    const { createCoachTools, SAVE_PLAN_WEEKS_REQUIRED } = await import(
      "@/lib/tools"
    );
    const saveTool = createCoachTools("user-test").save_or_update_plan;
    const schema = asSchema(saveTool.inputSchema);
    const validated = await schema.validate!({ ...header, weeks: [] });
    assert.equal(
      validated.success,
      true,
      validated.success ? "" : validated.error.message,
    );
    if (!validated.success) return;
    const execute = saveTool.execute;
    assert.ok(execute);
    const result = await execute(validated.value, {
      toolCallId: "empty-weeks",
      messages: [],
      context: {},
    });
    assert.ok(result && typeof result === "object" && "success" in result);
    assert.equal(result.success, false);
    assert.equal(
      "error" in result ? result.error : undefined,
      SAVE_PLAN_WEEKS_REQUIRED,
    );
  });
});
