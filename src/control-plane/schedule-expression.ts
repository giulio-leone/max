export type SupportedScheduleType = "cron" | "interval" | "manual";

const CRON_FIELD_COUNT = 5;
const MAX_CRON_SCAN_MINUTES = 366 * 24 * 60;

function parsePositiveInteger(value: string, label: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid ${label}: "${value}"`);
  }
  return Number(value);
}

function normalizeWeekday(value: number): number {
  return value === 7 ? 0 : value;
}

function parseCronPart(
  part: string,
  min: number,
  max: number,
  label: string,
  normalize?: (value: number) => number,
): number[] {
  const [rangePart, stepPart] = part.split("/");
  const step = stepPart === undefined ? 1 : parsePositiveInteger(stepPart, `${label} step`);
  if (step <= 0) {
    throw new Error(`${label} step must be greater than zero`);
  }

  const addValue = (bucket: Set<number>, value: number) => {
    const normalized = normalize ? normalize(value) : value;
    if (normalized < min || normalized > max) {
      throw new Error(`${label} value ${value} is out of range (${min}-${max})`);
    }
    bucket.add(normalized);
  };

  const values = new Set<number>();
  if (rangePart === "*") {
    for (let value = min; value <= max; value += step) {
      addValue(values, value);
    }
    return Array.from(values).sort((left, right) => left - right);
  }

  const [startText, endText] = rangePart.includes("-")
    ? rangePart.split("-", 2)
    : [rangePart, rangePart];
  const start = parsePositiveInteger(startText, `${label} range start`);
  const end = parsePositiveInteger(endText, `${label} range end`);

  if (end < start) {
    throw new Error(`${label} range "${rangePart}" is invalid`);
  }

  for (let value = start; value <= end; value += step) {
    addValue(values, value);
  }
  return Array.from(values).sort((left, right) => left - right);
}

function parseCronField(
  field: string,
  min: number,
  max: number,
  label: string,
  normalize?: (value: number) => number,
): Set<number> {
  const trimmed = field.trim();
  if (!trimmed) throw new Error(`${label} field cannot be empty`);

  const values = new Set<number>();
  for (const part of trimmed.split(",")) {
    for (const value of parseCronPart(part.trim(), min, max, label, normalize)) {
      values.add(value);
    }
  }
  return values;
}

function parseIntervalExpression(expression: string): number {
  const normalized = expression.trim().toLowerCase();
  const candidate = normalized.startsWith("every-")
    ? normalized.slice("every-".length)
    : normalized.startsWith("every ")
      ? normalized.slice("every ".length)
      : normalized;

  const match = candidate.match(/^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?$/);
  if (!match) {
    throw new Error(`Unsupported interval expression "${expression}"`);
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Interval expression "${expression}" must be greater than zero`);
  }

  const unit = match[2] ?? "s";
  switch (unit) {
    case "s":
    case "sec":
    case "secs":
    case "second":
    case "seconds":
      return amount * 1_000;
    case "m":
    case "min":
    case "mins":
    case "minute":
    case "minutes":
      return amount * 60_000;
    case "h":
    case "hr":
    case "hrs":
    case "hour":
    case "hours":
      return amount * 3_600_000;
    case "d":
    case "day":
    case "days":
      return amount * 86_400_000;
    default:
      throw new Error(`Unsupported interval unit in "${expression}"`);
  }
}

interface ParsedCronExpression {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  dayOfMonthWildcard: boolean;
  dayOfWeekWildcard: boolean;
}

function parseCronExpression(expression: string): ParsedCronExpression {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== CRON_FIELD_COUNT) {
    throw new Error(`Cron expression "${expression}" must contain exactly 5 fields`);
  }

  return {
    minute: parseCronField(fields[0], 0, 59, "minute"),
    hour: parseCronField(fields[1], 0, 23, "hour"),
    dayOfMonth: parseCronField(fields[2], 1, 31, "day of month"),
    month: parseCronField(fields[3], 1, 12, "month"),
    dayOfWeek: parseCronField(fields[4], 0, 6, "day of week", normalizeWeekday),
    dayOfMonthWildcard: fields[2] === "*",
    dayOfWeekWildcard: fields[4] === "*",
  };
}

function matchesCron(spec: ParsedCronExpression, candidate: Date): boolean {
  const minute = candidate.getUTCMinutes();
  const hour = candidate.getUTCHours();
  const dayOfMonth = candidate.getUTCDate();
  const month = candidate.getUTCMonth() + 1;
  const dayOfWeek = candidate.getUTCDay();

  if (!spec.minute.has(minute) || !spec.hour.has(hour) || !spec.month.has(month)) {
    return false;
  }

  const dayOfMonthMatches = spec.dayOfMonth.has(dayOfMonth);
  const dayOfWeekMatches = spec.dayOfWeek.has(dayOfWeek);

  if (spec.dayOfMonthWildcard && spec.dayOfWeekWildcard) {
    return true;
  }
  if (spec.dayOfMonthWildcard) {
    return dayOfWeekMatches;
  }
  if (spec.dayOfWeekWildcard) {
    return dayOfMonthMatches;
  }
  return dayOfMonthMatches || dayOfWeekMatches;
}

export function normalizeScheduleType(value: string): SupportedScheduleType {
  const normalized = value.trim().toLowerCase();
  if (normalized === "cron" || normalized === "interval" || normalized === "manual") {
    return normalized;
  }
  throw new Error(`Unsupported schedule type "${value}"`);
}

export function validateScheduleDefinition(scheduleType: string, expression: string): {
  scheduleType: SupportedScheduleType;
  expression: string;
} {
  const normalizedType = normalizeScheduleType(scheduleType);
  const normalizedExpression = expression.trim();

  if (!normalizedExpression) {
    throw new Error("Schedule expression is required");
  }

  if (normalizedType === "interval") {
    parseIntervalExpression(normalizedExpression);
  } else if (normalizedType === "cron") {
    parseCronExpression(normalizedExpression);
  }

  return {
    scheduleType: normalizedType,
    expression: normalizedExpression,
  };
}

export function parseControlPlaneTimestamp(value: string): Date {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Timestamp cannot be empty");
  }

  const normalized = trimmed.includes("T")
    ? trimmed
    : `${trimmed.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp "${value}"`);
  }
  return date;
}

export function formatControlPlaneTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

export function computeNextScheduleRun(
  scheduleType: string,
  expression: string,
  after: Date,
): Date | null {
  const validated = validateScheduleDefinition(scheduleType, expression);

  if (validated.scheduleType === "manual") {
    return null;
  }

  if (validated.scheduleType === "interval") {
    return new Date(after.getTime() + parseIntervalExpression(validated.expression));
  }

  const spec = parseCronExpression(validated.expression);
  const cursor = new Date(after.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  for (let step = 0; step < MAX_CRON_SCAN_MINUTES; step += 1) {
    if (matchesCron(spec, cursor)) {
      return new Date(cursor.getTime());
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }

  throw new Error(`Could not determine the next cron run for "${expression}"`);
}
