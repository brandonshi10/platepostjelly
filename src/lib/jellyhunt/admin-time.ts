const localDateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function partsAt(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

export function formatMissionDateTime(
  timestamp: number | undefined,
  timeZone: string,
) {
  if (timestamp === undefined) return "";
  const value = partsAt(timestamp, timeZone);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.year}-${pad(value.month)}-${pad(value.day)}T${pad(value.hour)}:${pad(value.minute)}`;
}

export function parseMissionDateTime(value: string, timeZone: string) {
  if (!value) return undefined;
  const match = localDateTimePattern.exec(value);
  if (!match) throw new Error("Use a complete local date and time");

  const [, year, month, day, hour, minute] = match.map(Number);
  const targetWallClock = Date.UTC(year, month - 1, day, hour, minute);
  let timestamp = targetWallClock;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = partsAt(timestamp, timeZone);
    const actualWallClock = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const difference = targetWallClock - actualWallClock;
    timestamp += difference;
    if (difference === 0) break;
  }

  if (formatMissionDateTime(timestamp, timeZone) !== value) {
    throw new Error(`The selected time does not exist in ${timeZone}`);
  }
  return timestamp;
}
