import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assessPlanWrite,
  givesPlanConsent,
  reportsMissedWork,
  requestsScheduleEdit,
} from "@/lib/plan-policy";

describe("missed work vs consent", () => {
  it("notices missed runs without treating a schedule request as a miss-only note", () => {
    assert.equal(reportsMissedWork("I missed my long run"), true);
    assert.equal(reportsMissedWork("I skipped today's workout"), true);
    assert.equal(reportsMissedWork("I didn't run today"), true);
    assert.equal(reportsMissedWork("Build me a 10 week plan"), false);
    assert.equal(
      requestsScheduleEdit("Can you move Tuesday to Thursday?"),
      true,
    );
    assert.equal(requestsScheduleEdit("I missed my long run"), false);
    assert.equal(givesPlanConsent("Yes, please update the plan"), true);
    assert.equal(givesPlanConsent("I missed my long run"), false);
  });

  it("suggests instead of writing when they have not agreed", () => {
    const decision = assessPlanWrite({
      mode: "interactive",
      userText: "I missed 4 miles this week",
      reason: "athlete_requested",
    });
    assert.equal(decision.ok, false);
  });

  it("allows a schedule edit they actually asked for", () => {
    const decision = assessPlanWrite({
      mode: "interactive",
      userText: "I missed Tuesday — swap it with Thursday",
      reason: "schedule_edit",
    });
    assert.equal(decision.ok, true);
  });

  it("never applies a make-up from an automatic debrief", () => {
    const decision = assessPlanWrite({
      mode: "automatic",
      userText: null,
      reason: "agreed_makeup",
    });
    assert.equal(decision.ok, false);
  });
});
