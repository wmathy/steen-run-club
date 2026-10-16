/**
 * Compact Strava workout detail for the coach review.
 *
 * The activity list already returns pace, heart rate, elevation, and cadence,
 * but the importer used to keep only distance, moving time, and a mapped type.
 * Laps, zones, and streams are separate reads. A missing sensor (no heart-rate
 * monitor, no watch streams) is reported as not recorded and does not fail
 * the import or the review.
 */

const STRAVA_API = "https://www.strava.com/api/v3";
const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const FEET_PER_METER = 3.28084;

const STREAM_KEYS = [
  "time",
  "distance",
  "altitude",
  "velocity_smooth",
  "heartrate",
  "cadence",
  "grade_smooth",
  "temp",
  "moving",
] as const;

export type StravaSplitSummary = {
  index: number;
  unit: "mile" | "kilometer";
  distanceMeters: number;
  movingSeconds: number;
  paceSecPerMile: number | null;
  heartRateBpm: number | null;
  elevationChangeMeters: number | null;
  gradePercent: number | null;
  gapSecPerMile: number | null;
};

export type StravaLapSummary = {
  index: number;
  name: string | null;
  distanceMeters: number;
  movingSeconds: number;
  paceSecPerMile: number | null;
  heartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  cadenceStepsPerMin: number | null;
  elevationGainMeters: number | null;
};

export type StravaHrDrift = {
  source: "streams" | "splits";
  firstHalfBpm: number;
  secondHalfBpm: number;
  deltaBpm: number;
  firstHalfPaceSecPerMile: number | null;
  secondHalfPaceSecPerMile: number | null;
  decouplingPercent: number | null;
};

export type StravaZoneSummary = {
  kind: "heartrate" | "power" | "other";
  index: number;
  min: number | null;
  max: number | null;
  seconds: number;
};

export type StravaRepGroup = {
  count: number;
  averageDistanceMeters: number;
  averagePaceSecPerMile: number | null;
  averageHeartRateBpm: number | null;
};

export type StravaBestEffort = {
  name: string;
  seconds: number;
  paceSecPerMile: number | null;
};

export type SplitPattern = "negative" | "positive" | "even" | "insufficient";

export type StravaReviewSummary = {
  name: string | null;
  sport: string | null;
  description: string | null;
  workoutLabel: "race" | "long run" | "workout" | null;
  startedLocal: string | null;
  distanceMeters: number | null;
  movingSeconds: number | null;
  elapsedSeconds: number | null;
  averagePaceSecPerMile: number | null;
  elevationGainMeters: number | null;
  elevationHighMeters: number | null;
  elevationLowMeters: number | null;
  heartRateRecorded: boolean;
  averageHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
  heartRateDrift: StravaHrDrift | null;
  cadenceStepsPerMin: number | null;
  temperatureF: number | null;
  calories: number | null;
  perceivedExertion: number | null;
  relativeEffort: number | null;
  averageWatts: number | null;
  indoor: boolean;
  manual: boolean;
  splitUnit: "mile" | "kilometer" | null;
  splits: StravaSplitSummary[];
  splitPattern: SplitPattern;
  firstHalfPaceSecPerMile: number | null;
  secondHalfPaceSecPerMile: number | null;
  laps: StravaLapSummary[];
  lapKind: "none" | "whole_activity" | "distance_splits" | "structured";
  workReps: StravaRepGroup | null;
  recoveryReps: StravaRepGroup | null;
  steadyRepeats: StravaRepGroup | null;
  zones: StravaZoneSummary[];
  gradeNotes: string[];
  bestEfforts: StravaBestEffort[];
};

type NormalizedStream = { data: unknown[] };

export function stravaReviewRequestPaths(activityId: string): string[] | null {
  if (!/^\d{1,20}$/.test(activityId)) return null;
  const keys = STREAM_KEYS.join(",");
  return [
    `/activities/${activityId}`,
    `/activities/${activityId}/laps`,
    `/activities/${activityId}/zones`,
    `/activities/${activityId}/streams?keys=${keys}&key_by_type=true`,
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function paceSecondsPerMile(
  distanceMeters: number,
  movingSeconds: number,
): number | null {
  if (!(distanceMeters > 0) || !(movingSeconds > 0)) return null;
  const pace = (movingSeconds / distanceMeters) * METERS_PER_MILE;
  if (pace < 90 || pace > 45 * 60) return null;
  return pace;
}

export function formatPaceSeconds(secPerMile: number | null): string {
  if (secPerMile == null || !Number.isFinite(secPerMile) || secPerMile <= 0) {
    return "n/a";
  }
  const total = Math.round(secPerMile);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}/mi`;
}

function formatClock(totalSeconds: number): string {
  const rounded = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatMilesFromMeters(meters: number): string {
  const miles = meters / METERS_PER_MILE;
  return `${miles.toFixed(miles >= 10 ? 1 : 2)} mi`;
}

function metersToFeet(meters: number): number {
  return Math.round(meters * FEET_PER_METER);
}

function formatGrade(grade: number): string {
  const rounded = roundTo(grade, 1);
  const body = Math.abs(rounded).toFixed(1);
  if (rounded > 0) return `+${body}%`;
  if (rounded < 0) return `-${body}%`;
  return "0.0%";
}

function formatElevChange(meters: number): string {
  const feet = metersToFeet(meters);
  if (feet > 0) return `+${feet} ft`;
  if (feet < 0) return `${feet} ft`;
  return "0 ft";
}

/**
 * Strava's running cadence is usually one foot (rpm). Values at or under 130
 * are doubled into steps/min for both feet. Values already in a both-feet
 * range are left alone.
 */
export function cadenceStepsPerMin(raw: number | null): number | null {
  if (raw == null || !Number.isFinite(raw) || raw < 40 || raw > 250) return null;
  if (raw <= 130) return Math.round(raw * 2);
  return Math.round(raw);
}

function heartRate(value: unknown): number | null {
  const n = num(value);
  if (n == null || n < 30 || n > 230) return null;
  return Math.round(n);
}

function celsiusToF(value: number): number {
  return Math.round((value * 9) / 5 + 32);
}

function localClock(value: unknown): string | null {
  const text = str(value);
  if (!text) return null;
  const match = text.match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : null;
}

function clipText(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

function usableActivity(raw: unknown): Record<string, unknown> | null {
  if (!isRecord(raw)) return null;
  const looksLikeError =
    typeof raw.message === "string" && raw.id == null && raw.distance == null;
  if (looksLikeError) return null;
  const hasPayload =
    raw.id != null ||
    raw.distance != null ||
    raw.moving_time != null ||
    raw.splits_standard != null ||
    raw.splits_metric != null ||
    raw.laps != null ||
    raw.average_heartrate != null;
  return hasPayload ? raw : null;
}

function mergeActivity(
  fallback: unknown,
  detail: unknown,
): Record<string, unknown> | null {
  const base = usableActivity(fallback);
  const extra = usableActivity(detail);
  if (base && extra) return { ...base, ...extra };
  return extra ?? base;
}

export function normalizeStravaStreams(
  input: unknown,
): Record<string, NormalizedStream> | null {
  const out: Record<string, NormalizedStream> = {};
  if (Array.isArray(input)) {
    for (const item of input) {
      if (!isRecord(item) || !Array.isArray(item.data)) continue;
      const type = str(item.type);
      if (!type) continue;
      out[type] = { data: item.data };
    }
  } else if (isRecord(input)) {
    const errorOnly =
      typeof input.message === "string" &&
      input.time == null &&
      input.heartrate == null &&
      input.cadence == null;
    if (errorOnly) return null;
    for (const [key, value] of Object.entries(input)) {
      if (!isRecord(value) || !Array.isArray(value.data)) continue;
      out[key] = { data: value.data };
    }
  }
  return Object.keys(out).length ? out : null;
}

function numberAt(data: unknown[] | undefined, index: number): number | null {
  if (!data || index >= data.length) return null;
  return num(data[index]);
}

function isStopped(value: unknown): boolean {
  return value === false || value === 0;
}

function workoutLabel(
  value: unknown,
): StravaReviewSummary["workoutLabel"] {
  const n = num(value);
  if (n === 1) return "race";
  if (n === 2) return "long run";
  if (n === 3) return "workout";
  return null;
}

function paceFromSpeed(metersPerSecond: number | null): number | null {
  if (metersPerSecond == null || metersPerSecond <= 0.3 || metersPerSecond > 12) {
    return null;
  }
  return paceSecondsPerMile(METERS_PER_MILE, METERS_PER_MILE / metersPerSecond);
}

function buildSplits(
  activity: Record<string, unknown> | null,
): { unit: "mile" | "kilometer"; splits: StravaSplitSummary[] } | null {
  if (!activity) return null;
  const standard = asArray(activity.splits_standard);
  const metric = asArray(activity.splits_metric);
  const source = standard.length ? standard : metric;
  if (!source.length) return null;
  const unit = standard.length ? "mile" : "kilometer";
  const splits: StravaSplitSummary[] = [];
  source.forEach((item, position) => {
    if (!isRecord(item)) return;
    const distance = num(item.distance);
    const moving = num(item.moving_time) ?? num(item.elapsed_time);
    if (distance == null || moving == null || distance <= 0 || moving <= 0) return;
    const elevation = num(item.elevation_difference);
    const gapSpeed = num(item.average_grade_adjusted_speed);
    splits.push({
      index: num(item.split) ?? position + 1,
      unit,
      distanceMeters: distance,
      movingSeconds: moving,
      paceSecPerMile: paceSecondsPerMile(distance, moving),
      heartRateBpm: heartRate(item.average_heartrate),
      elevationChangeMeters: elevation,
      gradePercent:
        elevation == null ? null : (elevation / distance) * 100,
      gapSecPerMile: paceFromSpeed(gapSpeed),
    });
  });
  return splits.length ? { unit, splits } : null;
}

function buildLaps(rawLaps: unknown): StravaLapSummary[] {
  const laps: StravaLapSummary[] = [];
  asArray(rawLaps).forEach((item, position) => {
    if (!isRecord(item)) return;
    const distance = num(item.distance) ?? 0;
    const moving = num(item.moving_time) ?? num(item.elapsed_time) ?? 0;
    if (distance <= 0 && moving <= 0) return;
    laps.push({
      index: num(item.lap_index) ?? num(item.split) ?? position + 1,
      name: str(item.name),
      distanceMeters: Math.max(0, distance),
      movingSeconds: Math.max(0, moving),
      paceSecPerMile:
        distance > 0 && moving > 0
          ? paceSecondsPerMile(distance, moving)
          : null,
      heartRateBpm: heartRate(item.average_heartrate),
      maxHeartRateBpm: heartRate(item.max_heartrate),
      cadenceStepsPerMin: cadenceStepsPerMin(num(item.average_cadence)),
      elevationGainMeters: num(item.total_elevation_gain),
    });
  });
  return laps;
}

function buildZones(raw: unknown): StravaZoneSummary[] {
  const zones: StravaZoneSummary[] = [];
  for (const item of asArray(raw)) {
    if (!isRecord(item)) continue;
    const type = str(item.type);
    const kind: StravaZoneSummary["kind"] =
      type === "heartrate" ? "heartrate" : type === "power" ? "power" : "other";
    let index = 0;
    for (const bucket of asArray(item.distribution_buckets)) {
      if (!isRecord(bucket)) continue;
      index += 1;
      const seconds = num(bucket.time);
      if (seconds == null || seconds <= 0) continue;
      zones.push({
        kind,
        index,
        min: num(bucket.min),
        max: num(bucket.max),
        seconds,
      });
    }
  }
  return zones;
}

function buildBestEfforts(activity: Record<string, unknown> | null): StravaBestEffort[] {
  if (!activity) return [];
  const efforts: StravaBestEffort[] = [];
  for (const item of asArray(activity.best_efforts)) {
    if (!isRecord(item)) continue;
    const name = str(item.name);
    const seconds = num(item.moving_time) ?? num(item.elapsed_time);
    const distance = num(item.distance);
    if (!name || seconds == null || seconds <= 0) continue;
    efforts.push({
      name,
      seconds: Math.round(seconds),
      paceSecPerMile:
        distance != null && distance > 0
          ? paceSecondsPerMile(distance, seconds)
          : null,
    });
    if (efforts.length >= 6) break;
  }
  return efforts;
}

type HalfStats = {
  firstPace: number | null;
  secondPace: number | null;
  firstHr: number | null;
  secondHr: number | null;
  firstHrSeconds: number;
  secondHrSeconds: number;
  totalSeconds: number;
};

function halvesFromSplits(splits: StravaSplitSummary[]): HalfStats {
  const empty: HalfStats = {
    firstPace: null,
    secondPace: null,
    firstHr: null,
    secondHr: null,
    firstHrSeconds: 0,
    secondHrSeconds: 0,
    totalSeconds: 0,
  };
  const usable = splits.filter(
    (split) => split.distanceMeters > 0 && split.movingSeconds > 0,
  );
  const totalDist = usable.reduce((sum, split) => sum + split.distanceMeters, 0);
  if (!(totalDist > 0)) return empty;
  const mid = totalDist / 2;
  let acc = 0;
  let firstDist = 0;
  let firstTime = 0;
  let secondDist = 0;
  let secondTime = 0;
  let firstHrWeight = 0;
  let firstHrTime = 0;
  let secondHrWeight = 0;
  let secondHrTime = 0;

  const add = (
    split: StravaSplitSummary,
    distancePart: number,
    which: "first" | "second",
  ) => {
    const ratio = distancePart / split.distanceMeters;
    const time = split.movingSeconds * ratio;
    if (which === "first") {
      firstDist += distancePart;
      firstTime += time;
      if (split.heartRateBpm != null) {
        firstHrWeight += split.heartRateBpm * time;
        firstHrTime += time;
      }
    } else {
      secondDist += distancePart;
      secondTime += time;
      if (split.heartRateBpm != null) {
        secondHrWeight += split.heartRateBpm * time;
        secondHrTime += time;
      }
    }
  };

  for (const split of usable) {
    const end = acc + split.distanceMeters;
    if (end <= mid + 1e-6) add(split, split.distanceMeters, "first");
    else if (acc >= mid - 1e-6) add(split, split.distanceMeters, "second");
    else {
      add(split, mid - acc, "first");
      add(split, end - mid, "second");
    }
    acc = end;
  }

  return {
    firstPace:
      firstDist > 0 && firstTime > 0
        ? paceSecondsPerMile(firstDist, firstTime)
        : null,
    secondPace:
      secondDist > 0 && secondTime > 0
        ? paceSecondsPerMile(secondDist, secondTime)
        : null,
    firstHr: firstHrTime > 0 ? firstHrWeight / firstHrTime : null,
    secondHr: secondHrTime > 0 ? secondHrWeight / secondHrTime : null,
    firstHrSeconds: firstHrTime,
    secondHrSeconds: secondHrTime,
    totalSeconds: firstTime + secondTime,
  };
}

function patternFromHalves(
  first: number | null,
  second: number | null,
): SplitPattern {
  if (first == null || second == null) return "insufficient";
  const delta = second - first;
  if (delta <= -5) return "negative";
  if (delta >= 5) return "positive";
  return "even";
}

function decouplingPercent(
  firstPace: number | null,
  secondPace: number | null,
  firstHr: number | null,
  secondHr: number | null,
): number | null {
  if (
    firstPace == null ||
    secondPace == null ||
    firstHr == null ||
    secondHr == null ||
    !(firstHr > 0) ||
    !(secondHr > 0)
  ) {
    return null;
  }
  const efficiency = (pace: number, hr: number) => METERS_PER_MILE / pace / hr;
  const first = efficiency(firstPace, firstHr);
  const second = efficiency(secondPace, secondHr);
  if (!(first > 0)) return null;
  return roundTo(((first - second) / first) * 100, 1);
}

function driftFromHalves(
  source: StravaHrDrift["source"],
  halves: HalfStats,
  minimumSeconds: number,
): StravaHrDrift | null {
  if (halves.totalSeconds < minimumSeconds) return null;
  if (halves.firstHr == null || halves.secondHr == null) return null;
  if (halves.firstHrSeconds < 60 || halves.secondHrSeconds < 60) return null;
  const first = Math.round(halves.firstHr);
  const second = Math.round(halves.secondHr);
  return {
    source,
    firstHalfBpm: first,
    secondHalfBpm: second,
    deltaBpm: second - first,
    firstHalfPaceSecPerMile: halves.firstPace,
    secondHalfPaceSecPerMile: halves.secondPace,
    decouplingPercent: decouplingPercent(
      halves.firstPace,
      halves.secondPace,
      halves.firstHr,
      halves.secondHr,
    ),
  };
}

function streamDrift(streams: Record<string, NormalizedStream> | null): StravaHrDrift | null {
  if (!streams?.time || !streams.heartrate) return null;
  const time = streams.time.data;
  const hr = streams.heartrate.data;
  const count = Math.min(time.length, hr.length, 20000);
  if (count < 31) return null;
  const speed = streams.velocity_smooth?.data;
  const moving = streams.moving?.data;

  let firstHrWeight = 0;
  let firstHrTime = 0;
  let secondHrWeight = 0;
  let secondHrTime = 0;
  let firstSpeedWeight = 0;
  let firstSpeedTime = 0;
  let secondSpeedWeight = 0;
  let secondSpeedTime = 0;
  let includedStart: number | null = null;
  let includedEnd: number | null = null;

  const times: number[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    const t0 = num(time[index]);
    const t1 = num(time[index + 1]);
    const bpm = num(hr[index]);
    if (t0 == null || t1 == null || bpm == null) continue;
    const dt = t1 - t0;
    if (!(dt > 0) || dt > 30) continue;
    if (bpm < 40 || bpm > 230) continue;
    if (moving && index < moving.length && isStopped(moving[index])) continue;
    times.push(t0);
    if (includedStart == null) includedStart = t0;
    includedEnd = t0;
  }

  if (includedStart == null || includedEnd == null) return null;
  if (includedEnd - includedStart < 8 * 60 || times.length < 30) return null;
  const mid = (includedStart + includedEnd) / 2;

  for (let index = 0; index < count - 1; index += 1) {
    const t0 = num(time[index]);
    const t1 = num(time[index + 1]);
    const bpm = num(hr[index]);
    if (t0 == null || t1 == null || bpm == null) continue;
    const dt = t1 - t0;
    if (!(dt > 0) || dt > 30) continue;
    if (bpm < 40 || bpm > 230) continue;
    if (moving && index < moving.length && isStopped(moving[index])) continue;
    const velocity = numberAt(speed, index);
    const usableSpeed =
      velocity != null && velocity > 0.4 && velocity < 12 ? velocity : null;
    const first = t0 <= mid;
    if (first) {
      firstHrWeight += bpm * dt;
      firstHrTime += dt;
      if (usableSpeed != null) {
        firstSpeedWeight += usableSpeed * dt;
        firstSpeedTime += dt;
      }
    } else {
      secondHrWeight += bpm * dt;
      secondHrTime += dt;
      if (usableSpeed != null) {
        secondSpeedWeight += usableSpeed * dt;
        secondSpeedTime += dt;
      }
    }
  }

  // Average speed = speedWeight / speedTime, so paceSecondsPerMile(speedWeight, speedTime)
  // is meters-per-mile / average speed.
  const firstPace =
    firstSpeedTime >= 60
      ? paceSecondsPerMile(firstSpeedWeight, firstSpeedTime)
      : null;
  const secondPace =
    secondSpeedTime >= 60
      ? paceSecondsPerMile(secondSpeedWeight, secondSpeedTime)
      : null;

  return driftFromHalves(
    "streams",
    {
      firstPace,
      secondPace,
      firstHr: firstHrTime > 0 ? firstHrWeight / firstHrTime : null,
      secondHr: secondHrTime > 0 ? secondHrWeight / secondHrTime : null,
      firstHrSeconds: firstHrTime,
      secondHrSeconds: secondHrTime,
      totalSeconds: firstHrTime + secondHrTime,
    },
    8 * 60,
  );
}

function averageCadence(
  activity: Record<string, unknown> | null,
  streams: Record<string, NormalizedStream> | null,
): number | null {
  const fromActivity = cadenceStepsPerMin(
    activity ? num(activity.average_cadence) : null,
  );
  if (fromActivity != null) return fromActivity;
  const cadence = streams?.cadence?.data;
  if (!cadence?.length) return null;
  const moving = streams?.moving?.data;
  let weight = 0;
  let count = 0;
  for (let index = 0; index < cadence.length; index += 1) {
    if (moving && index < moving.length && isStopped(moving[index])) continue;
    const value = num(cadence[index]);
    if (value == null || value < 40 || value > 250) continue;
    weight += value;
    count += 1;
  }
  if (!count) return null;
  return cadenceStepsPerMin(weight / count);
}

function averageTempF(
  activity: Record<string, unknown> | null,
  streams: Record<string, NormalizedStream> | null,
): number | null {
  const fromActivity = activity ? num(activity.average_temp) : null;
  if (fromActivity != null && fromActivity > -40 && fromActivity < 60) {
    return celsiusToF(fromActivity);
  }
  const temp = streams?.temp?.data;
  if (!temp?.length) return null;
  let weight = 0;
  let count = 0;
  for (const value of temp) {
    const n = num(value);
    if (n == null || n <= -40 || n >= 60) continue;
    weight += n;
    count += 1;
  }
  if (!count) return null;
  return celsiusToF(weight / count);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid] ?? null;
  const left = sorted[mid - 1];
  const right = sorted[mid];
  if (left == null || right == null) return null;
  return (left + right) / 2;
}

function classifyLaps(
  laps: StravaLapSummary[],
): StravaReviewSummary["lapKind"] {
  if (!laps.length) return "none";
  if (laps.length === 1) return "whole_activity";
  const distances = laps
    .map((lap) => lap.distanceMeters)
    .filter((distance) => distance > 0);
  const typical = median(distances);
  if (typical == null) return "structured";
  const near = (unit: number) => Math.abs(typical - unit) / unit < 0.12;
  if (!near(METERS_PER_MILE) && !near(METERS_PER_KM)) return "structured";
  const unit = near(METERS_PER_MILE) ? METERS_PER_MILE : METERS_PER_KM;
  const body = distances.slice(0, -1);
  if (!body.length) return "structured";
  const uniform = body.every((distance) => Math.abs(distance - unit) / unit < 0.15);
  return uniform ? "distance_splits" : "structured";
}

function repGroup(laps: StravaLapSummary[]): StravaRepGroup | null {
  if (!laps.length) return null;
  const distance = laps.reduce((sum, lap) => sum + lap.distanceMeters, 0);
  const time = laps.reduce((sum, lap) => sum + lap.movingSeconds, 0);
  let hrWeight = 0;
  let hrTime = 0;
  for (const lap of laps) {
    if (lap.heartRateBpm == null || !(lap.movingSeconds > 0)) continue;
    hrWeight += lap.heartRateBpm * lap.movingSeconds;
    hrTime += lap.movingSeconds;
  }
  return {
    count: laps.length,
    averageDistanceMeters: distance / laps.length,
    averagePaceSecPerMile:
      distance > 0 && time > 0 ? paceSecondsPerMile(distance, time) : null,
    averageHeartRateBpm: hrTime > 0 ? Math.round(hrWeight / hrTime) : null,
  };
}

function clusterLaps(laps: StravaLapSummary[]): {
  workReps: StravaRepGroup | null;
  recoveryReps: StravaRepGroup | null;
  steadyRepeats: StravaRepGroup | null;
} {
  const clusterable = laps.filter(
    (lap) =>
      lap.paceSecPerMile != null &&
      lap.distanceMeters >= 150 &&
      lap.movingSeconds >= 30,
  );
  const paces = clusterable
    .map((lap) => lap.paceSecPerMile)
    .filter((pace): pace is number => pace != null);
  const mid = median(paces);
  if (mid == null) {
    return { workReps: null, recoveryReps: null, steadyRepeats: null };
  }
  const work = clusterable.filter(
    (lap) => (lap.paceSecPerMile ?? Infinity) < mid * 0.92,
  );
  const recovery = clusterable.filter(
    (lap) => (lap.paceSecPerMile ?? 0) > mid * 1.08,
  );
  if (work.length >= 2) {
    return {
      workReps: repGroup(work),
      recoveryReps: recovery.length ? repGroup(recovery) : null,
      steadyRepeats: null,
    };
  }
  const mean = paces.reduce((sum, pace) => sum + pace, 0) / paces.length;
  const tight =
    clusterable.length >= 3 &&
    paces.every((pace) => Math.abs(pace - mean) <= 8);
  return {
    workReps: null,
    recoveryReps: null,
    steadyRepeats: tight ? repGroup(clusterable) : null,
  };
}

function splitLabel(split: StravaSplitSummary): string {
  return split.unit === "mile" ? `Mile ${split.index}` : `Kilometer ${split.index}`;
}

function gradeNotesFor(splits: StravaSplitSummary[]): string[] {
  const substantial = splits.filter(
    (split) =>
      split.paceSecPerMile != null &&
      split.gradePercent != null &&
      split.distanceMeters >= METERS_PER_MILE * 0.4,
  );
  const flat = substantial.filter(
    (split) => Math.abs(split.gradePercent ?? 0) < 1,
  );
  const referencePool = flat.length ? flat : substantial;
  const reference = median(
    referencePool
      .map((split) => split.paceSecPerMile)
      .filter((pace): pace is number => pace != null),
  );
  if (reference == null) return [];
  const notes: string[] = [];
  for (const split of substantial) {
    if (split.gradePercent == null || split.paceSecPerMile == null) continue;
    const slower = split.paceSecPerMile - reference;
    if (split.gradePercent >= 1.5 && slower >= 10) {
      notes.push(
        `${splitLabel(split)} was slower (${formatPaceSeconds(split.paceSecPerMile)}) on a ${formatGrade(split.gradePercent)} grade (${formatElevChange(split.elevationChangeMeters ?? 0)}). Flatter splits were about ${formatPaceSeconds(reference)}.`,
      );
    } else if (split.gradePercent <= -1.5 && slower <= -10) {
      notes.push(
        `${splitLabel(split)} was faster (${formatPaceSeconds(split.paceSecPerMile)}) on a ${formatGrade(split.gradePercent)} grade (${formatElevChange(split.elevationChangeMeters ?? 0)}).`,
      );
    }
    if (notes.length >= 4) break;
  }
  return notes;
}

function streamHasHeartRate(
  streams: Record<string, NormalizedStream> | null,
): boolean {
  return (
    streams?.heartrate?.data.some((value) => {
      const bpm = num(value);
      return bpm != null && bpm >= 40 && bpm <= 230;
    }) ?? false
  );
}

function heartRateWasRecorded(input: {
  activity: Record<string, unknown> | null;
  splits: StravaSplitSummary[];
  laps: StravaLapSummary[];
  zones: StravaZoneSummary[];
  streams: Record<string, NormalizedStream> | null;
  average: number | null;
  max: number | null;
}): boolean {
  const fromSamples =
    input.average != null ||
    input.max != null ||
    input.splits.some((split) => split.heartRateBpm != null) ||
    input.laps.some((lap) => lap.heartRateBpm != null) ||
    input.zones.some((zone) => zone.kind === "heartrate") ||
    streamHasHeartRate(input.streams);
  if (input.activity?.has_heartrate === false) return fromSamples;
  if (fromSamples) return true;
  return input.activity?.has_heartrate === true;
}

function emptySummary(): StravaReviewSummary {
  return {
    name: null,
    sport: null,
    description: null,
    workoutLabel: null,
    startedLocal: null,
    distanceMeters: null,
    movingSeconds: null,
    elapsedSeconds: null,
    averagePaceSecPerMile: null,
    elevationGainMeters: null,
    elevationHighMeters: null,
    elevationLowMeters: null,
    heartRateRecorded: false,
    averageHeartRateBpm: null,
    maxHeartRateBpm: null,
    heartRateDrift: null,
    cadenceStepsPerMin: null,
    temperatureF: null,
    calories: null,
    perceivedExertion: null,
    relativeEffort: null,
    averageWatts: null,
    indoor: false,
    manual: false,
    splitUnit: null,
    splits: [],
    splitPattern: "insufficient",
    firstHalfPaceSecPerMile: null,
    secondHalfPaceSecPerMile: null,
    laps: [],
    lapKind: "none",
    workReps: null,
    recoveryReps: null,
    steadyRepeats: null,
    zones: [],
    gradeNotes: [],
    bestEfforts: [],
  };
}

export function summarizeStravaActivity(input: {
  activity?: unknown;
  laps?: unknown;
  zones?: unknown;
  streams?: unknown;
}): StravaReviewSummary {
  const activity = usableActivity(input.activity);
  const summary = emptySummary();
  if (activity) {
    summary.name = str(activity.name);
    summary.sport = str(activity.sport_type) ?? str(activity.type);
    const description = str(activity.description);
    summary.description = description ? clipText(description, 400) : null;
    summary.workoutLabel = workoutLabel(activity.workout_type);
    summary.startedLocal = localClock(activity.start_date_local);
    summary.distanceMeters = num(activity.distance);
    summary.movingSeconds = num(activity.moving_time);
    summary.elapsedSeconds = num(activity.elapsed_time);
    const moving = summary.movingSeconds;
    const distance = summary.distanceMeters;
    summary.averagePaceSecPerMile =
      distance != null && moving != null
        ? paceSecondsPerMile(distance, moving)
        : paceFromSpeed(num(activity.average_speed));
    summary.elevationGainMeters = num(activity.total_elevation_gain);
    summary.elevationHighMeters = num(activity.elev_high);
    summary.elevationLowMeters = num(activity.elev_low);
    summary.averageHeartRateBpm = heartRate(activity.average_heartrate);
    summary.maxHeartRateBpm = heartRate(activity.max_heartrate);
    summary.temperatureF = null;
    summary.calories = (() => {
      const calories = num(activity.calories);
      return calories != null && calories > 0 ? Math.round(calories) : null;
    })();
    const exertion = num(activity.perceived_exertion);
    summary.perceivedExertion =
      exertion != null && exertion > 0 && exertion <= 10
        ? Math.round(exertion)
        : null;
    const effort = num(activity.suffer_score);
    summary.relativeEffort =
      effort != null && effort > 0 ? Math.round(effort) : null;
    const watts = num(activity.average_watts);
    summary.averageWatts = watts != null && watts > 0 ? Math.round(watts) : null;
    summary.indoor = activity.trainer === true;
    summary.manual = activity.manual === true;
    summary.bestEfforts = buildBestEfforts(activity);
  }

  const splitBuild = buildSplits(activity);
  if (splitBuild) {
    summary.splitUnit = splitBuild.unit;
    summary.splits = splitBuild.splits;
  }

  const explicitLaps = asArray(input.laps);
  const lapSource =
    explicitLaps.length > 0 ? explicitLaps : activity ? activity.laps : [];
  summary.laps = buildLaps(lapSource);
  summary.lapKind = classifyLaps(summary.laps);
  if (summary.lapKind === "structured") {
    const clustered = clusterLaps(summary.laps);
    summary.workReps = clustered.workReps;
    summary.recoveryReps = clustered.recoveryReps;
    summary.steadyRepeats = clustered.steadyRepeats;
  }

  if (
    summary.elevationGainMeters == null &&
    summary.laps.some((lap) => lap.elevationGainMeters != null)
  ) {
    summary.elevationGainMeters = summary.laps.reduce(
      (sum, lap) => sum + (lap.elevationGainMeters ?? 0),
      0,
    );
  }

  summary.zones = buildZones(input.zones);
  const streams = normalizeStravaStreams(input.streams);
  summary.cadenceStepsPerMin = averageCadence(activity, streams);
  summary.temperatureF = averageTempF(activity, streams);

  const halves = halvesFromSplits(summary.splits);
  summary.firstHalfPaceSecPerMile = halves.firstPace;
  summary.secondHalfPaceSecPerMile = halves.secondPace;
  summary.splitPattern =
    summary.splits.length >= 2
      ? patternFromHalves(halves.firstPace, halves.secondPace)
      : "insufficient";
  summary.gradeNotes = gradeNotesFor(summary.splits);

  summary.heartRateRecorded = heartRateWasRecorded({
    activity,
    splits: summary.splits,
    laps: summary.laps,
    zones: summary.zones,
    streams,
    average: summary.averageHeartRateBpm,
    max: summary.maxHeartRateBpm,
  });
  if (!summary.heartRateRecorded) {
    summary.averageHeartRateBpm = null;
    summary.maxHeartRateBpm = null;
    summary.zones = summary.zones.filter((zone) => zone.kind !== "heartrate");
  }

  const fromStreams = summary.heartRateRecorded ? streamDrift(streams) : null;
  const fromSplits =
    summary.heartRateRecorded && summary.splits.length >= 2
      ? driftFromHalves("splits", halves, 8 * 60)
      : null;
  summary.heartRateDrift = fromStreams ?? fromSplits;

  return summary;
}

function zoneUnit(kind: StravaZoneSummary["kind"]): string {
  if (kind === "heartrate") return "bpm";
  if (kind === "power") return "W";
  return "";
}

function formatZone(zone: StravaZoneSummary): string {
  const prefix = zone.kind === "power" ? "P" : zone.kind === "heartrate" ? "Z" : "Z";
  const unit = zoneUnit(zone.kind);
  const range =
    zone.min != null && zone.max != null
      ? `${Math.round(zone.min)}–${Math.round(zone.max)}${unit ? ` ${unit}` : ""}`
      : unit;
  return `${prefix}${zone.index} ${range} ${formatClock(zone.seconds)}`.replace(
    /\s+/g,
    " ",
  );
}

function formatSplit(split: StravaSplitSummary): string {
  const fullUnit =
    split.unit === "mile"
      ? Math.abs(split.distanceMeters - METERS_PER_MILE) / METERS_PER_MILE < 0.02
      : Math.abs(split.distanceMeters - METERS_PER_KM) / METERS_PER_KM < 0.02;
  const bits = [`${split.index}.`];
  if (!fullUnit) bits.push(formatMilesFromMeters(split.distanceMeters));
  bits.push(formatPaceSeconds(split.paceSecPerMile));
  if (split.heartRateBpm != null) bits.push(`HR ${split.heartRateBpm}`);
  if (split.elevationChangeMeters != null) {
    bits.push(formatElevChange(split.elevationChangeMeters));
  }
  if (split.gradePercent != null) bits.push(`grade ${formatGrade(split.gradePercent)}`);
  if (
    split.gapSecPerMile != null &&
    split.paceSecPerMile != null &&
    Math.abs(split.gapSecPerMile - split.paceSecPerMile) >= 5
  ) {
    bits.push(`GAP ${formatPaceSeconds(split.gapSecPerMile)}`);
  }
  return bits.join(", ").replace(", ", " ");
}

function formatLap(lap: StravaLapSummary): string {
  const name = lap.name ? `${lap.name} — ` : "";
  const bits = [
    `${lap.index}. ${name}${formatMilesFromMeters(lap.distanceMeters)}`,
    formatPaceSeconds(lap.paceSecPerMile),
  ];
  if (lap.heartRateBpm != null) {
    bits.push(
      lap.maxHeartRateBpm != null
        ? `HR ${lap.heartRateBpm} (max ${lap.maxHeartRateBpm})`
        : `HR ${lap.heartRateBpm}`,
    );
  }
  if (lap.cadenceStepsPerMin != null) bits.push(`cadence ${lap.cadenceStepsPerMin}`);
  if (lap.elevationGainMeters != null && lap.elevationGainMeters > 0) {
    bits.push(`+${metersToFeet(lap.elevationGainMeters)} ft`);
  }
  return bits.join(", ");
}

function formatReps(label: string, group: StravaRepGroup): string {
  const distance = formatMilesFromMeters(group.averageDistanceMeters);
  const pace = formatPaceSeconds(group.averagePaceSecPerMile);
  const hr =
    group.averageHeartRateBpm != null ? `, HR ${group.averageHeartRateBpm}` : "";
  return `${label}: ${group.count} × about ${distance} at ${pace}${hr}`;
}

function absentFields(summary: StravaReviewSummary): string[] {
  const missing: string[] = [];
  if (!summary.heartRateRecorded) missing.push("heart rate");
  else if (!summary.zones.some((zone) => zone.kind === "heartrate")) {
    missing.push("heart-rate zones");
  }
  if (!summary.splits.length) missing.push("splits");
  if (summary.lapKind === "none") missing.push("laps");
  if (summary.elevationGainMeters == null) missing.push("elevation");
  if (summary.cadenceStepsPerMin == null) missing.push("cadence");
  return missing;
}

export function formatStravaReview(summary: StravaReviewSummary): string {
  const lines: string[] = [];
  if (summary.name) lines.push(`Name: ${summary.name}`);
  if (summary.sport) lines.push(`Sport: ${summary.sport}`);
  if (summary.workoutLabel) lines.push(`Workout tag: ${summary.workoutLabel}`);
  if (summary.startedLocal) lines.push(`Started: ${summary.startedLocal}`);
  if (summary.indoor) lines.push("Indoor/treadmill: yes");
  if (summary.manual) {
    lines.push("Entry: typed into Strava (device data may be missing)");
  }
  if (summary.movingSeconds != null) {
    const moving = `Moving time: ${formatClock(summary.movingSeconds)}`;
    const elapsed = summary.elapsedSeconds;
    if (elapsed != null && elapsed - summary.movingSeconds >= 30) {
      lines.push(
        `${moving}`,
        `Elapsed time: ${formatClock(elapsed)} (${formatClock(elapsed - summary.movingSeconds)} stopped)`,
      );
    } else if (elapsed != null) {
      lines.push(moving, `Elapsed time: ${formatClock(elapsed)}`);
    } else {
      lines.push(moving);
    }
  } else if (summary.elapsedSeconds != null) {
    lines.push(`Elapsed time: ${formatClock(summary.elapsedSeconds)}`);
  }
  if (summary.distanceMeters != null && summary.distanceMeters > 0) {
    lines.push(`Distance: ${formatMilesFromMeters(summary.distanceMeters)}`);
  }
  if (summary.averagePaceSecPerMile != null) {
    lines.push(`Average pace: ${formatPaceSeconds(summary.averagePaceSecPerMile)}`);
  }
  if (summary.elevationGainMeters != null) {
    lines.push(`Elevation gain: ${metersToFeet(summary.elevationGainMeters)} ft`);
  }
  if (summary.elevationHighMeters != null && summary.elevationLowMeters != null) {
    lines.push(
      `Elevation range: ${metersToFeet(summary.elevationLowMeters)}–${metersToFeet(summary.elevationHighMeters)} ft`,
    );
  }
  if (summary.heartRateRecorded) {
    const bits = [
      summary.averageHeartRateBpm != null
        ? `average ${summary.averageHeartRateBpm} bpm`
        : null,
      summary.maxHeartRateBpm != null ? `max ${summary.maxHeartRateBpm} bpm` : null,
    ].filter(Boolean);
    lines.push(bits.length ? `Heart rate: ${bits.join(", ")}` : "Heart rate: recorded");
  } else {
    lines.push("Heart rate: not recorded");
  }
  if (summary.heartRateDrift) {
    const drift = summary.heartRateDrift;
    const sign = drift.deltaBpm > 0 ? "+" : "";
    const pace =
      drift.firstHalfPaceSecPerMile != null && drift.secondHalfPaceSecPerMile != null
        ? ` Pace ${formatPaceSeconds(drift.firstHalfPaceSecPerMile)} then ${formatPaceSeconds(drift.secondHalfPaceSecPerMile)}.`
        : "";
    const decoupling =
      drift.decouplingPercent != null
        ? ` Aerobic decoupling ${drift.decouplingPercent}%.`
        : "";
    const source = drift.source === "streams" ? "effort trace" : "splits";
    lines.push(
      `Heart-rate drift: second half ${drift.secondHalfBpm} bpm vs first half ${drift.firstHalfBpm} bpm (${sign}${drift.deltaBpm} bpm).${pace}${decoupling} Source: ${source}.`,
    );
  }
  if (summary.cadenceStepsPerMin != null) {
    lines.push(`Cadence: ${summary.cadenceStepsPerMin} steps/min`);
  }
  if (summary.temperatureF != null) lines.push(`Temperature: ${summary.temperatureF}°F`);
  if (summary.averageWatts != null) lines.push(`Power: average ${summary.averageWatts} W`);
  if (summary.relativeEffort != null) {
    lines.push(`Relative effort: ${summary.relativeEffort}`);
  }
  if (summary.perceivedExertion != null) {
    lines.push(`Perceived exertion: ${summary.perceivedExertion}/10`);
  }
  if (summary.calories != null) lines.push(`Calories: ${summary.calories}`);
  if (summary.description) lines.push(`Description: ${summary.description}`);

  const hrZones = summary.zones.filter((zone) => zone.kind === "heartrate");
  const powerZones = summary.zones.filter((zone) => zone.kind === "power");
  if (hrZones.length) {
    lines.push(`Heart-rate zones: ${hrZones.map(formatZone).join("; ")}`);
  }
  if (powerZones.length) {
    lines.push(`Power zones: ${powerZones.map(formatZone).join("; ")}`);
  }
  if (summary.bestEfforts.length) {
    const efforts = summary.bestEfforts.map((effort) => {
      const pace = effort.paceSecPerMile
        ? ` (${formatPaceSeconds(effort.paceSecPerMile)})`
        : "";
      return `${effort.name} ${formatClock(effort.seconds)}${pace}`;
    });
    lines.push(`Best efforts: ${efforts.join("; ")}`);
  }

  if (summary.splits.length) {
    const unit = summary.splitUnit === "kilometer" ? "Kilometer" : "Mile";
    lines.push(`${unit} splits:`);
    const shown =
      summary.splits.length > 32
        ? [...summary.splits.slice(0, 8), ...summary.splits.slice(-4)]
        : summary.splits;
    for (const split of shown) lines.push(formatSplit(split));
    if (summary.splits.length > 32) {
      lines.push(
        `…${summary.splits.length - 12} middle splits omitted; pattern below uses every split.`,
      );
    }
    const paces = summary.splits
      .map((split) => split.paceSecPerMile)
      .filter((pace): pace is number => pace != null);
    if (paces.length >= 2) {
      const fastest = Math.min(...paces);
      const slowest = Math.max(...paces);
      lines.push(
        `Pace range: ${formatPaceSeconds(fastest)}–${formatPaceSeconds(slowest)} (${Math.round(slowest - fastest)}s spread).`,
      );
    }
    if (summary.splitPattern === "negative") {
      lines.push(
        `Split pattern: negative split. Second half ${formatPaceSeconds(summary.secondHalfPaceSecPerMile)} vs first half ${formatPaceSeconds(summary.firstHalfPaceSecPerMile)}.`,
      );
    } else if (summary.splitPattern === "positive") {
      lines.push(
        `Split pattern: positive split (faded). Second half ${formatPaceSeconds(summary.secondHalfPaceSecPerMile)} vs first half ${formatPaceSeconds(summary.firstHalfPaceSecPerMile)}.`,
      );
    } else if (summary.splitPattern === "even") {
      lines.push(
        `Split pattern: even. Second half ${formatPaceSeconds(summary.secondHalfPaceSecPerMile)} vs first half ${formatPaceSeconds(summary.firstHalfPaceSecPerMile)}.`,
      );
    } else if (summary.splits.length === 1) {
      lines.push("Split pattern: only one split, so pacing across the run is not available.");
    }
    if (summary.lapKind === "structured") {
      lines.push(
        "Split pattern note: these splits cut across the intervals. Judge the workout from the laps.",
      );
    }
    for (const note of summary.gradeNotes) lines.push(note);
  }

  if (summary.lapKind === "whole_activity") {
    lines.push("Laps: 1 (the whole activity, no interval breakdown).");
  } else if (summary.lapKind === "distance_splits") {
    lines.push(
      "Laps: these match the distance splits, so there is no separate interval structure.",
    );
  } else if (summary.lapKind === "structured") {
    lines.push(`Laps: structured workout, ${summary.laps.length} laps.`);
    if (summary.workReps) lines.push(formatReps("Work reps", summary.workReps));
    if (summary.recoveryReps) {
      lines.push(formatReps("Recovery reps", summary.recoveryReps));
    }
    if (summary.steadyRepeats) {
      lines.push(formatReps("Repeats", summary.steadyRepeats));
    }
    const shown = summary.laps.slice(0, 30);
    for (const lap of shown) lines.push(formatLap(lap));
    if (summary.laps.length > shown.length) {
      lines.push(`…${summary.laps.length - shown.length} more laps omitted.`);
    }
  }

  const missing = absentFields(summary);
  if (missing.length) lines.push(`Not recorded: ${missing.join(", ")}`);

  let text = lines.join("\n");
  const max = 7000;
  if (text.length > max) {
    text = `${text.slice(0, max - 32).trimEnd()}\n…detail truncated.`;
  }
  return text;
}

async function stravaGet(
  accessToken: string,
  path: string,
): Promise<unknown | null> {
  try {
    const response = await fetch(`${STRAVA_API}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.status === 404 || response.status === 204) return null;
    if (!response.ok) {
      const body = await response.text();
      const safe = accessToken ? body.replaceAll(accessToken, "[redacted]") : body;
      console.error(
        "Strava workout detail request failed:",
        response.status,
        path.split("?")[0],
        safe.slice(0, 180),
      );
      return null;
    }
    return (await response.json()) as unknown;
  } catch (err) {
    console.error(
      "Strava workout detail request error:",
      path.split("?")[0],
      err instanceof Error ? err.message : "unknown",
    );
    return null;
  }
}

/**
 * Read activity detail, laps, zones, and streams. Any one of those can be
 * missing. The access token is sent only as a header and is never logged.
 * `fallbackActivity` is the list/detail payload already in hand, used when
 * the detail read fails.
 */
export async function fetchStravaActivityReview(
  accessToken: string,
  activityId: string,
  fallbackActivity?: unknown,
): Promise<string | null> {
  const paths = stravaReviewRequestPaths(activityId);
  if (!paths || !accessToken) return null;
  const [detailPath, lapsPath, zonesPath, streamsPath] = paths;
  const [detail, laps, zones, streams] = await Promise.all([
    stravaGet(accessToken, detailPath!),
    stravaGet(accessToken, lapsPath!),
    stravaGet(accessToken, zonesPath!),
    stravaGet(accessToken, streamsPath!),
  ]);
  const activity = mergeActivity(fallbackActivity, detail);
  const hasLaps = Array.isArray(laps) && laps.length > 0;
  const hasZones = Array.isArray(zones) && zones.length > 0;
  const hasStreams = normalizeStravaStreams(streams) != null;
  if (!activity && !hasLaps && !hasZones && !hasStreams) return null;
  const text = formatStravaReview(
    summarizeStravaActivity({
      activity,
      laps,
      zones,
      streams,
    }),
  ).trim();
  return text || null;
}
