import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCoachSystemPrompt, stravaReviewCoachingRules } from "@/lib/coach-prompt";
import {
  cadenceStepsPerMin,
  formatPaceSeconds,
  formatStravaReview,
  normalizeStravaStreams,
  stravaReviewRequestPaths,
  summarizeStravaActivity,
} from "@/lib/strava-review";

const MILE = 1609.344;

function mileSplit(
  index: number,
  movingSeconds: number,
  extra: Record<string, number> = {},
) {
  return {
    split: index,
    distance: MILE,
    moving_time: movingSeconds,
    elapsed_time: movingSeconds,
    ...extra,
  };
}

describe("coach review prompt", () => {
  it("asks for pace, intervals, heart rate, and hills without a plan change", () => {
    const rules = stravaReviewCoachingRules();
    assert.match(rules, /negative-split/);
    assert.match(rules, /Intervals and laps/);
    assert.match(rules, /Drift means heart rate climbed/);
    assert.match(rules, /Elevation/);
    assert.match(rules, /until they clearly agree/);
    const prompt = buildCoachSystemPrompt({ coachingStyle: "motivational" });
    assert.match(prompt, /Strava workout detail/);
    assert.match(prompt, /not a dictator/);
  });
});

describe("pace and cadence formatting", () => {
  it("formats pace and rolls 60 seconds into the next minute", () => {
    assert.equal(formatPaceSeconds(480), "8:00/mi");
    assert.equal(formatPaceSeconds(599.6), "10:00/mi");
    assert.equal(formatPaceSeconds(null), "n/a");
  });

  it("turns Strava one-foot cadence into steps per minute", () => {
    assert.equal(cadenceStepsPerMin(88), 176);
    assert.equal(cadenceStepsPerMin(172), 172);
    assert.equal(cadenceStepsPerMin(20), null);
  });
});

describe("Strava review requests", () => {
  it("asks for the activity, laps, zones, and streams", () => {
    const paths = stravaReviewRequestPaths("12345");
    assert.ok(paths);
    assert.equal(paths[0], "/activities/12345");
    assert.equal(paths[1], "/activities/12345/laps");
    assert.equal(paths[2], "/activities/12345/zones");
    assert.match(paths[3] ?? "", /\/activities\/12345\/streams\?/);
    assert.match(paths[3] ?? "", /heartrate/);
    assert.match(paths[3] ?? "", /grade_smooth/);
    assert.match(paths[3] ?? "", /cadence/);
    assert.match(paths[3] ?? "", /key_by_type=true/);
  });

  it("rejects ids that are not a Strava activity id", () => {
    assert.equal(stravaReviewRequestPaths("abc"), null);
    assert.equal(stravaReviewRequestPaths("12/laps"), null);
    assert.equal(stravaReviewRequestPaths(""), null);
    assert.equal(stravaReviewRequestPaths("1.5"), null);
  });
});

describe("summarizeStravaActivity", () => {
  it("keeps list-payload fields that used to be dropped before the review", () => {
    const summary = summarizeStravaActivity({
      activity: {
        name: "Morning run",
        sport_type: "Run",
        distance: 8000,
        moving_time: 2400,
        elapsed_time: 2500,
        start_date_local: "2026-04-02T07:15:00",
        average_heartrate: 151.6,
        max_heartrate: 168,
        average_cadence: 88,
        total_elevation_gain: 100,
        elev_high: 150,
        elev_low: 125,
        average_temp: 18,
        calories: 520.4,
        suffer_score: 80,
        perceived_exertion: 4,
        has_heartrate: true,
        workout_type: 0,
      },
    });

    assert.equal(summary.averageHeartRateBpm, 152);
    assert.equal(summary.maxHeartRateBpm, 168);
    assert.equal(summary.cadenceStepsPerMin, 176);
    assert.equal(summary.elevationGainMeters, 100);
    assert.equal(summary.startedLocal, "07:15");
    assert.equal(summary.temperatureF, 64);
    assert.equal(summary.calories, 520);
    assert.equal(summary.relativeEffort, 80);
    assert.equal(summary.heartRateRecorded, true);
    assert.equal(summary.splits.length, 0);

    const text = formatStravaReview(summary);
    assert.match(text, /Heart rate: average 152 bpm, max 168 bpm/);
    assert.match(text, /Cadence: 176 steps\/min/);
    assert.match(text, /Elevation gain: 328 ft/);
    assert.match(text, /Elevation range: 410–492 ft/);
    assert.match(text, /Temperature: 64°F/);
    assert.match(text, /Not recorded: heart-rate zones, splits, laps/);
    assert.doesNotMatch(text, /Bearer/);
    assert.doesNotMatch(text, /access_token/);
  });

  it("calls a faster second half a negative split", () => {
    const summary = summarizeStravaActivity({
      activity: {
        name: "Progression",
        distance: MILE * 2,
        moving_time: 480 + 450,
        elapsed_time: 480 + 450,
        splits_standard: [
          mileSplit(1, 480, { average_heartrate: 148, elevation_difference: 0 }),
          mileSplit(2, 450, { average_heartrate: 154, elevation_difference: -3 }),
        ],
      },
    });

    assert.equal(summary.splitPattern, "negative");
    assert.equal(formatPaceSeconds(summary.firstHalfPaceSecPerMile), "8:00/mi");
    assert.equal(formatPaceSeconds(summary.secondHalfPaceSecPerMile), "7:30/mi");
    const text = formatStravaReview(summary);
    assert.match(
      text,
      /Split pattern: negative split\. Second half 7:30\/mi vs first half 8:00\/mi\./,
    );
    assert.match(text, /1\. 8:00\/mi, HR 148/);
    assert.match(text, /2\. 7:30\/mi, HR 154/);
  });

  it("calls a slower second half a positive split and an even run even", () => {
    const faded = summarizeStravaActivity({
      activity: {
        splits_standard: [mileSplit(1, 480), mileSplit(2, 500)],
      },
    });
    assert.equal(faded.splitPattern, "positive");
    assert.match(formatStravaReview(faded), /positive split \(faded\)/);
    assert.match(formatStravaReview(faded), /8:20\/mi/);

    const even = summarizeStravaActivity({
      activity: {
        splits_standard: [mileSplit(1, 480), mileSplit(2, 484)],
      },
    });
    assert.equal(even.splitPattern, "even");
    assert.match(formatStravaReview(even), /Split pattern: even/);
  });

  it("credits a slower mile to the grade", () => {
    const summary = summarizeStravaActivity({
      activity: {
        total_elevation_gain: 48.28032,
        splits_standard: [
          mileSplit(1, 480, { elevation_difference: 0 }),
          mileSplit(2, 560, { elevation_difference: 48.28032 }),
        ],
      },
    });
    assert.equal(summary.gradeNotes.length, 1);
    assert.match(summary.gradeNotes[0] ?? "", /Mile 2/);
    assert.match(summary.gradeNotes[0] ?? "", /9:20\/mi/);
    assert.match(summary.gradeNotes[0] ?? "", /\+3\.0%/);
    assert.match(summary.gradeNotes[0] ?? "", /\+158 ft/);
    assert.match(formatStravaReview(summary), /Flatter splits were about 8:00\/mi/);
  });

  it("labels kilometer splits and converts their pace to minutes per mile", () => {
    const summary = summarizeStravaActivity({
      activity: {
        splits_metric: [
          {
            split: 1,
            distance: 1000,
            moving_time: 300,
            elevation_difference: 4,
          },
          {
            split: 2,
            distance: 1000,
            moving_time: 330,
            elevation_difference: -2,
          },
        ],
      },
    });
    assert.equal(summary.splitUnit, "kilometer");
    assert.equal(summary.splitPattern, "positive");
    const text = formatStravaReview(summary);
    assert.match(text, /Kilometer splits:/);
    assert.match(text, /1\. 8:03\/mi/);
    assert.match(text, /2\. 8:51\/mi/);
  });

  it("shows a short last split with its real distance", () => {
    const partial = 0.42 * MILE;
    const text = formatStravaReview(
      summarizeStravaActivity({
        activity: {
          splits_standard: [
            mileSplit(1, 480),
            { split: 2, distance: partial, moving_time: 200, elevation_difference: 0 },
          ],
        },
      }),
    );
    assert.match(text, /2\. 0\.42 mi, 7:56\/mi/);
  });

  it("says heart rate is not recorded when no monitor is present", () => {
    const summary = summarizeStravaActivity({
      activity: {
        name: "Easy",
        distance: 5000,
        moving_time: 1800,
        elapsed_time: 1800,
        has_heartrate: false,
        total_elevation_gain: 50,
        average_cadence: 86,
      },
      zones: [],
      streams: { message: "Record Not Found" },
    });
    assert.equal(summary.heartRateRecorded, false);
    assert.equal(summary.heartRateDrift, null);
    assert.equal(summary.averageHeartRateBpm, null);
    assert.equal(summary.zones.length, 0);
    const text = formatStravaReview(summary);
    assert.match(text, /Heart rate: not recorded/);
    assert.doesNotMatch(text, /Heart-rate drift/);
    assert.doesNotMatch(text, /bpm/);
    assert.match(text, /Elevation gain: 164 ft/);
    assert.match(text, /Average pace: 9:39\/mi/);
    assert.match(text, /Distance: 3\.11 mi/);
    assert.match(text, /Cadence: 172 steps\/min/);
  });

  it("does not treat a zeroed heart-rate stream as a monitor", () => {
    const summary = summarizeStravaActivity({
      activity: { has_heartrate: false, distance: 1000, moving_time: 400 },
      streams: {
        time: { data: [0, 1, 2, 3] },
        heartrate: { data: [0, 0, 0, 0] },
      },
    });
    assert.equal(summary.heartRateRecorded, false);
    assert.equal(summary.heartRateDrift, null);
  });

  it("does not invent drift on a short run", () => {
    const summary = summarizeStravaActivity({
      activity: {
        has_heartrate: true,
        average_heartrate: 150,
        moving_time: 180,
        distance: 600,
        splits_standard: [
          {
            split: 1,
            distance: 300,
            moving_time: 90,
            average_heartrate: 140,
          },
          {
            split: 2,
            distance: 300,
            moving_time: 90,
            average_heartrate: 160,
          },
        ],
      },
    });
    assert.equal(summary.heartRateDrift, null);
    assert.doesNotMatch(formatStravaReview(summary), /Heart-rate drift/);
  });

  it("computes heart-rate drift and decoupling from splits when streams are missing", () => {
    const summary = summarizeStravaActivity({
      activity: {
        has_heartrate: true,
        average_heartrate: 147,
        max_heartrate: 160,
        splits_standard: [
          mileSplit(1, 480, { average_heartrate: 140 }),
          mileSplit(2, 480, { average_heartrate: 154 }),
        ],
      },
    });
    assert.ok(summary.heartRateDrift);
    assert.equal(summary.heartRateDrift.source, "splits");
    assert.equal(summary.heartRateDrift.firstHalfBpm, 140);
    assert.equal(summary.heartRateDrift.secondHalfBpm, 154);
    assert.equal(summary.heartRateDrift.deltaBpm, 14);
    assert.equal(summary.heartRateDrift.decouplingPercent, 9.1);
    assert.match(
      formatStravaReview(summary),
      /Heart-rate drift: second half 154 bpm vs first half 140 bpm \(\+14 bpm\)\. Pace 8:00\/mi then 8:00\/mi\. Aerobic decoupling 9\.1%\. Source: splits\./,
    );
  });

  it("prefers the effort trace for drift and ignores stopped samples", () => {
    const seconds = 1200;
    const step = 10;
    const time: number[] = [];
    const heartrate: number[] = [];
    const velocity: number[] = [];
    const moving: number[] = [];
    for (let t = 0; t <= seconds; t += step) {
      const stopped = t >= 100 && t < 200;
      time.push(t);
      heartrate.push(stopped ? 200 : t < 600 ? 140 : 154);
      velocity.push(3);
      moving.push(stopped ? 0 : 1);
    }
    const streams = {
      time: { data: time },
      heartrate: { data: heartrate },
      velocity_smooth: { data: velocity },
      moving: { data: moving },
    };
    const summary = summarizeStravaActivity({
      activity: {
        has_heartrate: true,
        average_heartrate: 147,
        splits_standard: [
          mileSplit(1, 600, { average_heartrate: 100 }),
          mileSplit(2, 600, { average_heartrate: 100 }),
        ],
      },
      streams,
    });
    assert.ok(summary.heartRateDrift);
    assert.equal(summary.heartRateDrift.source, "streams");
    assert.equal(summary.heartRateDrift.firstHalfBpm, 140);
    assert.equal(summary.heartRateDrift.secondHalfBpm, 154);
    assert.equal(summary.heartRateDrift.deltaBpm, 14);
    assert.equal(summary.heartRateDrift.decouplingPercent, 9.1);
    assert.equal(formatPaceSeconds(summary.heartRateDrift.firstHalfPaceSecPerMile), "8:56/mi");
    const text = formatStravaReview(summary);
    assert.match(text, /Source: effort trace/);
    assert.doesNotMatch(text, /200 bpm/);
    assert.ok(text.length < 4000);
    assert.ok(JSON.stringify(summary).length < 8000);
  });

  it("reads the same drift from a Strava stream array", () => {
    const normalized = normalizeStravaStreams([
      { type: "time", data: [0, 10] },
      { type: "heartrate", data: [120, 121] },
    ]);
    assert.deepEqual(normalized?.heartrate?.data, [120, 121]);
    assert.equal(normalizeStravaStreams({ message: "Record Not Found" }), null);
  });

  it("formats heart-rate zones and skips empty buckets", () => {
    const text = formatStravaReview(
      summarizeStravaActivity({
        activity: { has_heartrate: true, average_heartrate: 150, max_heartrate: 175 },
        zones: [
          {
            type: "heartrate",
            distribution_buckets: [
              { min: 0, max: 120, time: 600 },
              { min: 120, max: 150, time: 1800 },
              { min: 150, max: 170, time: 0 },
            ],
          },
        ],
      }),
    );
    assert.match(
      text,
      /Heart-rate zones: Z1 0–120 bpm 10:00; Z2 120–150 bpm 30:00/,
    );
    assert.doesNotMatch(text, /Z3/);
  });

  it("separates interval work and recovery from the laps", () => {
    const warmup = {
      name: "Warmup",
      lap_index: 1,
      distance: MILE,
      moving_time: 600,
      average_heartrate: 130,
    };
    const cooldown = {
      name: "Cooldown",
      lap_index: 14,
      distance: MILE,
      moving_time: 600,
      average_heartrate: 135,
    };
    const laps = [warmup];
    for (let rep = 0; rep < 6; rep += 1) {
      laps.push({
        name: "Interval",
        lap_index: laps.length + 1,
        distance: 800,
        moving_time: 200,
        average_heartrate: 172,
      });
      laps.push({
        name: "Recovery",
        lap_index: laps.length + 1,
        distance: 400,
        moving_time: 180,
        average_heartrate: 140,
      });
    }
    laps.push(cooldown);

    const summary = summarizeStravaActivity({
      activity: {
        name: "Tuesday intervals",
        workout_type: 3,
        description: "6x800 at 5k effort with 400 jog",
        has_heartrate: true,
        average_heartrate: 160,
        splits_standard: [mileSplit(1, 500), mileSplit(2, 530)],
      },
      laps,
    });
    assert.equal(summary.lapKind, "structured");
    assert.equal(summary.workoutLabel, "workout");
    assert.equal(summary.workReps?.count, 6);
    assert.equal(formatPaceSeconds(summary.workReps?.averagePaceSecPerMile ?? null), "6:42/mi");
    assert.equal(summary.workReps?.averageHeartRateBpm, 172);
    assert.equal(summary.recoveryReps?.count, 6);
    assert.equal(
      formatPaceSeconds(summary.recoveryReps?.averagePaceSecPerMile ?? null),
      "12:04/mi",
    );

    const text = formatStravaReview(summary);
    assert.match(text, /Workout tag: workout/);
    assert.match(text, /Description: 6x800 at 5k effort with 400 jog/);
    assert.match(text, /Laps: structured workout, 14 laps\./);
    assert.match(text, /Work reps: 6 × about 0\.50 mi at 6:42\/mi, HR 172/);
    assert.match(text, /Recovery reps: 6 × about 0\.25 mi at 12:04\/mi, HR 140/);
    assert.match(text, /1\. Warmup — 1\.00 mi, 10:00\/mi, HR 130/);
    assert.match(
      text,
      /Split pattern note: these splits cut across the intervals\. Judge the workout from the laps\./,
    );
  });

  it("does not treat mile laps as an interval workout", () => {
    const laps = [1, 2, 3, 4, 5].map((index) => ({
      lap_index: index,
      distance: MILE,
      moving_time: 500 + index,
    }));
    const summary = summarizeStravaActivity({ activity: {}, laps });
    assert.equal(summary.lapKind, "distance_splits");
    assert.equal(summary.workReps, null);
    assert.match(
      formatStravaReview(summary),
      /no separate interval structure/,
    );
    assert.doesNotMatch(formatStravaReview(summary), /Work reps/);
  });

  it("summarizes steady repeats when every lap is the work", () => {
    const laps = Array.from({ length: 8 }, (_, index) => ({
      lap_index: index + 1,
      distance: 400,
      moving_time: 90,
      average_heartrate: 176,
    }));
    const summary = summarizeStravaActivity({
      activity: { workout_type: 3, has_heartrate: true },
      laps,
    });
    assert.equal(summary.lapKind, "structured");
    assert.equal(summary.steadyRepeats?.count, 8);
    assert.match(
      formatStravaReview(summary),
      /Repeats: 8 × about 0\.25 mi at 6:02\/mi, HR 176/,
    );
  });

  it("treats one lap as the whole activity", () => {
    const text = formatStravaReview(
      summarizeStravaActivity({
        laps: [{ lap_index: 1, distance: 5000, moving_time: 1500 }],
      }),
    );
    assert.match(text, /Laps: 1 \(the whole activity, no interval breakdown\)\./);
  });

  it("includes grade-adjusted pace, best efforts, and stopped time", () => {
    const summary = summarizeStravaActivity({
      activity: {
        moving_time: 480,
        elapsed_time: 600,
        distance: MILE,
        trainer: true,
        manual: false,
        best_efforts: [
          { name: "1 mile", distance: MILE, moving_time: 400 },
        ],
        splits_standard: [
          mileSplit(1, 560, { average_grade_adjusted_speed: MILE / 480 }),
        ],
      },
    });
    const text = formatStravaReview(summary);
    assert.match(text, /Moving time: 8:00/);
    assert.match(text, /Elapsed time: 10:00 \(2:00 stopped\)/);
    assert.match(text, /Indoor\/treadmill: yes/);
    assert.match(text, /GAP 8:00\/mi/);
    assert.match(text, /Best efforts: 1 mile 6:40 \(6:40\/mi\)/);
  });

  it("survives empty and malformed payloads", () => {
    const summary = summarizeStravaActivity({
      activity: "nope",
      laps: { oops: true },
      zones: null,
      streams: { message: "Record Not Found" },
    });
    assert.equal(summary.heartRateRecorded, false);
    assert.equal(summary.splits.length, 0);
    assert.equal(summary.laps.length, 0);
    const text = formatStravaReview(summary);
    assert.match(text, /Heart rate: not recorded/);
    assert.match(text, /Not recorded: heart rate, splits, laps, elevation, cadence/);
    assert.doesNotMatch(text, /velocity_smooth/);
    assert.doesNotMatch(text, /distribution_buckets/);
  });

  it("does not keep a long stream inside the summary", () => {
    const count = 5000;
    const time = Array.from({ length: count }, (_, index) => index);
    const heartrate = time.map((t) => (t < count / 2 ? 130 : 145));
    const velocity = time.map(() => 3);
    const summary = summarizeStravaActivity({
      activity: { has_heartrate: true, average_heartrate: 138 },
      streams: {
        time: { data: time },
        heartrate: { data: heartrate },
        velocity_smooth: { data: velocity },
      },
    });
    assert.equal(summary.heartRateDrift?.source, "streams");
    assert.equal(summary.heartRateDrift?.deltaBpm, 15);
    const encoded = JSON.stringify(summary);
    assert.ok(encoded.length < 5000);
    assert.equal(encoded.includes('"data"'), false);
  });
});
