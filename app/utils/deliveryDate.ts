import {
  DEFAULT_DELIVERY_SCHEDULE_CONFIG,
  DELIVERY_BILLING_READY_HOUR,
  DELIVERY_BILLING_READY_MINUTE,
  DELIVERY_CUTOFF_HOUR,
  DELIVERY_CUTOFF_MINUTE,
  DELIVERY_CUTOFF_OFFSET_DAYS,
  DELIVERY_RESCHEDULE_REASON,
  DELIVERY_WEEKLY_INTERVAL_DAYS,
  type DeliveryRescheduleReason,
  type DeliveryScheduleConfig,
} from "../constants/deliverySchedule";

/** Calendar date in Europe/Paris, ISO `YYYY-MM-DD`. */
export type DeliveryDateString = string & { readonly __brand: "DeliveryDateString" };

export type DeliveryScheduleResult = {
  deliveryRescheduleReason: DeliveryRescheduleReason | null;
  desiredDeliveryDate: DeliveryDateString;
  scheduledDeliveryDate: DeliveryDateString;
};

export type DeliveryCutoffStatus = {
  cutoffDate: DeliveryDateString | null;
  deadlineLabel: string | null;
  isKnown: boolean;
  isPassed: boolean;
};

export type ActiveScheduledDeliveryProjection = {
  effectiveDeliveryDate: DeliveryDateString | null;
  projectedFromStoredDate: DeliveryDateString | null;
  wasProjected: boolean;
};

export type ScheduleDeliveryDateInput = {
  config?: DeliveryScheduleConfig;
  desiredDeliveryDate: DeliveryDateString;
  /** True when the customer explicitly picked this date in the builder. */
  fromCustomerChoice?: boolean;
  referenceDate: DeliveryDateString;
};

const DELIVERY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const compareDeliveryDates = (left: DeliveryDateString, right: DeliveryDateString) =>
  left.localeCompare(right);

const maxDeliveryDate = (
  left: DeliveryDateString,
  right: DeliveryDateString,
): DeliveryDateString => (compareDeliveryDates(left, right) >= 0 ? left : right);

const splitDeliveryDate = (date: DeliveryDateString) => {
  const [year, month, day] = date.split("-").map(Number);

  return { day, month, year };
};

const toDeliveryDateString = (year: number, month: number, day: number) => {
  const candidate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = parseDeliveryDate(candidate);

  if (!parsed) {
    throw new Error(`Invalid calendar date: ${candidate}`);
  }

  return parsed;
};

const utcDateFromDeliveryDate = (date: DeliveryDateString) => {
  const { day, month, year } = splitDeliveryDate(date);

  return new Date(Date.UTC(year, month - 1, day));
};

export const parseDeliveryDate = (
  value: string | null | undefined,
): DeliveryDateString | null => {
  if (!value || !DELIVERY_DATE_PATTERN.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));

  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    return null;
  }

  return value as DeliveryDateString;
};

export const referenceDateFromInstant = (
  instant: Date,
  timezone: string = DEFAULT_DELIVERY_SCHEDULE_CONFIG.timezone,
): DeliveryDateString => {
  const formatted = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).format(instant);
  const parsed = parseDeliveryDate(formatted);

  if (!parsed) {
    throw new Error(
      `Unable to derive delivery date from instant ${instant.toISOString()} (${timezone}).`,
    );
  }

  return parsed;
};

export const getTodayDeliveryDate = (
  timezone: string = DEFAULT_DELIVERY_SCHEDULE_CONFIG.timezone,
): DeliveryDateString => referenceDateFromInstant(new Date(), timezone);

export const addCalendarDays = (
  date: DeliveryDateString,
  days: number,
): DeliveryDateString => {
  const utcDate = utcDateFromDeliveryDate(date);
  utcDate.setUTCDate(utcDate.getUTCDate() + days);

  return toDeliveryDateString(
    utcDate.getUTCFullYear(),
    utcDate.getUTCMonth() + 1,
    utcDate.getUTCDate(),
  );
};

export const getWeekday = (date: DeliveryDateString): number =>
  utcDateFromDeliveryDate(date).getUTCDay();

export const isSunday = (date: DeliveryDateString): boolean => getWeekday(date) === 0;

export const isBlockedWeekday = (
  date: DeliveryDateString,
  blockedWeekdays: readonly number[] = DEFAULT_DELIVERY_SCHEDULE_CONFIG.blockedWeekdays,
): boolean => blockedWeekdays.includes(getWeekday(date));

export const getDeliveryWindowBounds = (
  referenceDate: DeliveryDateString,
  config: DeliveryScheduleConfig = DEFAULT_DELIVERY_SCHEDULE_CONFIG,
) => ({
  earliest: addCalendarDays(referenceDate, config.minOffsetDays),
  latest: addCalendarDays(referenceDate, config.maxOffsetDays),
});

export const isWithinDeliveryWindow = (
  date: DeliveryDateString,
  referenceDate: DeliveryDateString,
  config: DeliveryScheduleConfig = DEFAULT_DELIVERY_SCHEDULE_CONFIG,
): boolean => {
  const { earliest, latest } = getDeliveryWindowBounds(referenceDate, config);

  return (
    !isBlockedWeekday(date, config.blockedWeekdays) &&
    compareDeliveryDates(date, earliest) >= 0 &&
    compareDeliveryDates(date, latest) <= 0
  );
};

export const firstValidDeliveryDateFrom = (
  startDate: DeliveryDateString,
  referenceDate: DeliveryDateString,
  config: DeliveryScheduleConfig = DEFAULT_DELIVERY_SCHEDULE_CONFIG,
): DeliveryDateString => {
  const { earliest, latest } = getDeliveryWindowBounds(referenceDate, config);
  let cursor = maxDeliveryDate(startDate, earliest);

  while (compareDeliveryDates(cursor, latest) <= 0) {
    if (!isBlockedWeekday(cursor, config.blockedWeekdays)) {
      return cursor;
    }

    cursor = addCalendarDays(cursor, 1);
  }

  throw new Error(
    `No valid delivery date in window for reference ${referenceDate} starting from ${startDate}.`,
  );
};

export const getAvailableDeliveryDates = (
  referenceDate: DeliveryDateString = getTodayDeliveryDate(),
  config: DeliveryScheduleConfig = DEFAULT_DELIVERY_SCHEDULE_CONFIG,
): DeliveryDateString[] => {
  const { earliest, latest } = getDeliveryWindowBounds(referenceDate, config);
  const dates: DeliveryDateString[] = [];
  let cursor = earliest;

  while (compareDeliveryDates(cursor, latest) <= 0) {
    if (!isBlockedWeekday(cursor, config.blockedWeekdays)) {
      dates.push(cursor);
    }

    cursor = addCalendarDays(cursor, 1);
  }

  return dates;
};

export const getDefaultDeliveryDate = (
  referenceDate: DeliveryDateString = getTodayDeliveryDate(),
  config: DeliveryScheduleConfig = DEFAULT_DELIVERY_SCHEDULE_CONFIG,
): DeliveryDateString => {
  const availableDates = getAvailableDeliveryDates(referenceDate, config);

  if (availableDates.length === 0) {
    throw new Error(`No available delivery dates for reference ${referenceDate}.`);
  }

  return availableDates[0];
};

export const normalizeDeliveryDate = (
  desired: DeliveryDateString,
  referenceDate: DeliveryDateString,
  config: DeliveryScheduleConfig = DEFAULT_DELIVERY_SCHEDULE_CONFIG,
): DeliveryDateString => {
  const { earliest, latest } = getDeliveryWindowBounds(referenceDate, config);
  const start =
    compareDeliveryDates(desired, latest) > 0
      ? earliest
      : maxDeliveryDate(desired, earliest);

  return firstValidDeliveryDateFrom(start, referenceDate, config);
};

const resolveRescheduleReason = ({
  desired,
  earliest,
  fromCustomerChoice,
  latest,
  scheduled,
}: {
  desired: DeliveryDateString;
  earliest: DeliveryDateString;
  fromCustomerChoice: boolean;
  latest: DeliveryDateString;
  scheduled: DeliveryDateString;
}): DeliveryRescheduleReason | null => {
  if (compareDeliveryDates(scheduled, desired) === 0) {
    return null;
  }

  if (isSunday(desired)) {
    return DELIVERY_RESCHEDULE_REASON.SUNDAY_EXCLUDED;
  }

  if (compareDeliveryDates(desired, latest) > 0) {
    return DELIVERY_RESCHEDULE_REASON.OUT_OF_WINDOW;
  }

  if (compareDeliveryDates(desired, earliest) < 0) {
    return fromCustomerChoice
      ? DELIVERY_RESCHEDULE_REASON.PAYMENT_TOO_LATE
      : DELIVERY_RESCHEDULE_REASON.MIN_LEAD_TIME;
  }

  if (isBlockedWeekday(desired)) {
    return DELIVERY_RESCHEDULE_REASON.SUNDAY_EXCLUDED;
  }

  return null;
};

export const scheduleDeliveryDate = ({
  config = DEFAULT_DELIVERY_SCHEDULE_CONFIG,
  desiredDeliveryDate,
  fromCustomerChoice = false,
  referenceDate,
}: ScheduleDeliveryDateInput): DeliveryScheduleResult => {
  const { earliest, latest } = getDeliveryWindowBounds(referenceDate, config);
  let scheduled = desiredDeliveryDate;

  if (
    compareDeliveryDates(desiredDeliveryDate, earliest) < 0 ||
    compareDeliveryDates(desiredDeliveryDate, latest) > 0 ||
    isBlockedWeekday(desiredDeliveryDate, config.blockedWeekdays)
  ) {
    const start =
      compareDeliveryDates(desiredDeliveryDate, latest) > 0
        ? earliest
        : maxDeliveryDate(desiredDeliveryDate, earliest);

    scheduled = firstValidDeliveryDateFrom(start, referenceDate, config);
  }

  return {
    deliveryRescheduleReason: resolveRescheduleReason({
      desired: desiredDeliveryDate,
      earliest,
      fromCustomerChoice,
      latest,
      scheduled,
    }),
    desiredDeliveryDate,
    scheduledDeliveryDate: scheduled,
  };
};

export const computeRenewalDeliveryDate = ({
  config = DEFAULT_DELIVERY_SCHEDULE_CONFIG,
  preferredDeliveryWeekday,
  referenceDate,
}: {
  config?: DeliveryScheduleConfig;
  preferredDeliveryWeekday: number;
  referenceDate: DeliveryDateString;
}): DeliveryScheduleResult => {
  if (preferredDeliveryWeekday < 0 || preferredDeliveryWeekday > 6) {
    throw new Error(
      `preferredDeliveryWeekday must be between 0 and 6, got ${preferredDeliveryWeekday}.`,
    );
  }

  const { earliest } = getDeliveryWindowBounds(referenceDate, config);
  let cursor = referenceDate;

  while (getWeekday(cursor) !== preferredDeliveryWeekday) {
    cursor = addCalendarDays(cursor, 1);
  }

  if (compareDeliveryDates(cursor, earliest) < 0) {
    cursor = addCalendarDays(cursor, 7);
  }

  return scheduleDeliveryDate({
    config,
    desiredDeliveryDate: cursor,
    fromCustomerChoice: false,
    referenceDate,
  });
};

const getParisTimeParts = (
  instant: Date,
  timezone: string = DEFAULT_DELIVERY_SCHEDULE_CONFIG.timezone,
) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: timezone,
  }).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  return {
    hour: read("hour"),
    minute: read("minute"),
  };
};

const isCutoffDeadlinePassedOnCalendarDay = (
  instant: Date,
  timezone: string = DEFAULT_DELIVERY_SCHEDULE_CONFIG.timezone,
) => {
  const { hour, minute } = getParisTimeParts(instant, timezone);

  return (
    hour > DELIVERY_CUTOFF_HOUR ||
    (hour === DELIVERY_CUTOFF_HOUR && minute > DELIVERY_CUTOFF_MINUTE)
  );
};

export const getDeliveryCutoffCalendarDate = (
  scheduledDeliveryDate: DeliveryDateString,
): DeliveryDateString =>
  addCalendarDays(scheduledDeliveryDate, -DELIVERY_CUTOFF_OFFSET_DAYS);

export const formatDeliveryCutoffDeadlineLabel = (
  scheduledDeliveryDate: string | null | undefined,
  options?: { locale?: string },
): string | null => {
  const parsed = parseDeliveryDate(scheduledDeliveryDate);

  if (!parsed) {
    return null;
  }

  const cutoffDate = getDeliveryCutoffCalendarDate(parsed);
  const { day, month, year } = splitDeliveryDate(cutoffDate);
  const utcNoon = new Date(Date.UTC(year, month - 1, day, 12));
  const locale = options?.locale ?? "fr-FR";
  const weekday = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "long",
  }).format(utcNoon);
  const rest = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(utcNoon);

  return `${weekday} ${rest} à ${DELIVERY_CUTOFF_HOUR}h${String(DELIVERY_CUTOFF_MINUTE).padStart(2, "0")}`;
};

export const isDeliveryCutoffPassed = (
  scheduledDeliveryDate: string | null | undefined,
  now: Date = new Date(),
  config: DeliveryScheduleConfig = DEFAULT_DELIVERY_SCHEDULE_CONFIG,
): boolean => getDeliveryCutoffStatus(scheduledDeliveryDate, now, config).isPassed;

export const getDeliveryCutoffStatus = (
  scheduledDeliveryDate: string | null | undefined,
  now: Date = new Date(),
  config: DeliveryScheduleConfig = DEFAULT_DELIVERY_SCHEDULE_CONFIG,
): DeliveryCutoffStatus => {
  const parsed = parseDeliveryDate(scheduledDeliveryDate);

  if (!parsed) {
    return {
      cutoffDate: null,
      deadlineLabel: null,
      isKnown: false,
      isPassed: false,
    };
  }

  const cutoffDate = getDeliveryCutoffCalendarDate(parsed);
  const todayParis = referenceDateFromInstant(now, config.timezone);
  const deadlineLabel = formatDeliveryCutoffDeadlineLabel(parsed);
  let isPassed = false;

  if (compareDeliveryDates(todayParis, cutoffDate) > 0) {
    isPassed = true;
  } else if (compareDeliveryDates(todayParis, cutoffDate) === 0) {
    isPassed = isCutoffDeadlinePassedOnCalendarDay(now, config.timezone);
  }

  return {
    cutoffDate,
    deadlineLabel,
    isKnown: true,
    isPassed,
  };
};

export const projectActiveScheduledDeliveryDate = ({
  config = DEFAULT_DELIVERY_SCHEDULE_CONFIG,
  nextScheduledDeliveryDate,
  now = new Date(),
  preferredDeliveryWeekday,
}: {
  config?: DeliveryScheduleConfig;
  nextScheduledDeliveryDate: string | null | undefined;
  now?: Date;
  preferredDeliveryWeekday: number | null | undefined;
}): ActiveScheduledDeliveryProjection => {
  try {
    const todayParis = referenceDateFromInstant(now, config.timezone);
    const parsedStored = parseDeliveryDate(nextScheduledDeliveryDate);

    if (parsedStored) {
      if (compareDeliveryDates(parsedStored, todayParis) >= 0) {
        return {
          effectiveDeliveryDate: parsedStored,
          projectedFromStoredDate: parsedStored,
          wasProjected: false,
        };
      }

      let cursor = parsedStored;

      while (compareDeliveryDates(cursor, todayParis) < 0) {
        cursor = addCalendarDays(cursor, DELIVERY_WEEKLY_INTERVAL_DAYS);
      }

      return {
        effectiveDeliveryDate: cursor,
        projectedFromStoredDate: parsedStored,
        wasProjected: true,
      };
    }

    if (
      preferredDeliveryWeekday != null &&
      Number.isInteger(preferredDeliveryWeekday) &&
      preferredDeliveryWeekday >= 0 &&
      preferredDeliveryWeekday <= 6
    ) {
      let cursor = todayParis;

      while (getWeekday(cursor) !== preferredDeliveryWeekday) {
        cursor = addCalendarDays(cursor, 1);
      }

      return {
        effectiveDeliveryDate: cursor,
        projectedFromStoredDate: null,
        wasProjected: true,
      };
    }

    return {
      effectiveDeliveryDate: null,
      projectedFromStoredDate: null,
      wasProjected: false,
    };
  } catch {
    return {
      effectiveDeliveryDate: null,
      projectedFromStoredDate: null,
      wasProjected: false,
    };
  }
};

export const parisWallClockToInstant = ({
  date,
  hour,
  minute,
  second = 0,
  timezone = DEFAULT_DELIVERY_SCHEDULE_CONFIG.timezone,
}: {
  date: DeliveryDateString;
  hour: number;
  minute: number;
  second?: number;
  timezone?: string;
}): Date => {
  const { day, month, year } = splitDeliveryDate(date);
  const target = { day, hour, minute, month, second, year };

  const readWallClock = (instant: Date) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone: timezone,
      year: "numeric",
    }).formatToParts(instant);

    const read = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value ?? "0");

    return {
      day: read("day"),
      hour: read("hour"),
      minute: read("minute"),
      month: read("month"),
      second: read("second"),
      year: read("year"),
    };
  };

  const compareWallClock = (
    left: typeof target,
    right: typeof target,
  ) => {
    for (const key of ["year", "month", "day", "hour", "minute", "second"] as const) {
      if (left[key] !== right[key]) {
        return left[key] - right[key];
      }
    }

    return 0;
  };

  const base = Date.UTC(year, month - 1, day);
  let lo = base - 24 * 60 * 60 * 1000;
  let hi = base + 48 * 60 * 60 * 1000;

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const wallClock = readWallClock(new Date(mid));

    if (compareWallClock(wallClock, target) < 0) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  return new Date(lo);
};

export const getBillingReadyCalendarDate = (
  deliveryDate: DeliveryDateString,
): DeliveryDateString =>
  addCalendarDays(getDeliveryCutoffCalendarDate(deliveryDate), 1);

export const computeNextWeeklyDeliveryDate = (
  currentDeliveryDate: DeliveryDateString,
): DeliveryDateString =>
  addCalendarDays(currentDeliveryDate, DELIVERY_WEEKLY_INTERVAL_DAYS);

export const computeBillingReadyAtForDelivery = (
  deliveryDate: string | null | undefined,
  config: DeliveryScheduleConfig = DEFAULT_DELIVERY_SCHEDULE_CONFIG,
): Date | null => {
  const parsed = parseDeliveryDate(deliveryDate);

  if (!parsed) {
    return null;
  }

  const billingReadyDate = getBillingReadyCalendarDate(parsed);

  return parisWallClockToInstant({
    date: billingReadyDate,
    hour: DELIVERY_BILLING_READY_HOUR,
    minute: DELIVERY_BILLING_READY_MINUTE,
    timezone: config.timezone,
  });
};

export const computeNextBillingDateFromCurrentDelivery = (
  currentDeliveryDate: string | null | undefined,
  config: DeliveryScheduleConfig = DEFAULT_DELIVERY_SCHEDULE_CONFIG,
): Date | null => {
  const parsed = parseDeliveryDate(currentDeliveryDate);

  if (!parsed) {
    return null;
  }

  const nextDeliveryDate = computeNextWeeklyDeliveryDate(parsed);

  return computeBillingReadyAtForDelivery(nextDeliveryDate, config);
};

export type ResumeDeliveryScheduleMode = "schedule_only" | "immediate_payment";

export type ResumeDeliveryScheduleResolution = {
  alignedNextBillingDate: Date;
  nextDeliveryAfterResume: DeliveryDateString;
  resumeTargetDeliveryDate: DeliveryDateString;
};

export const logResumeAlignment = ({
  alignedNextBillingDate,
  mode,
  nextDeliveryAfterResume,
  resumeTargetDeliveryDate,
  selectionId,
  wasCutoffSkipped,
}: {
  alignedNextBillingDate: Date | null;
  mode: ResumeDeliveryScheduleMode;
  nextDeliveryAfterResume: DeliveryDateString | null;
  resumeTargetDeliveryDate: DeliveryDateString | null;
  selectionId?: string;
  wasCutoffSkipped: boolean;
}) => {
  try {
    console.log("[RESUME_ALIGNMENT]", {
      alignedNextBillingDate: alignedNextBillingDate?.toISOString() ?? null,
      mode,
      nextDeliveryAfterResume,
      resumeTargetDeliveryDate,
      selectionId,
      wasCutoffSkipped,
    });
  } catch {
    // Logger must never throw.
  }
};

export const resolveResumeDeliverySchedule = ({
  config = DEFAULT_DELIVERY_SCHEDULE_CONFIG,
  mode,
  now = new Date(),
  selection,
  selectionId,
}: {
  config?: DeliveryScheduleConfig;
  mode: ResumeDeliveryScheduleMode;
  now?: Date;
  selection: {
    nextScheduledDeliveryDate: string | null;
    preferredDeliveryWeekday: number | null;
  };
  selectionId?: string;
}): ResumeDeliveryScheduleResolution | null => {
  try {
    const projection = projectActiveScheduledDeliveryDate({
      config,
      nextScheduledDeliveryDate: selection.nextScheduledDeliveryDate,
      now,
      preferredDeliveryWeekday: selection.preferredDeliveryWeekday,
    });

    let resumeTargetDeliveryDate = projection.effectiveDeliveryDate;
    let wasCutoffSkipped = false;

    if (!resumeTargetDeliveryDate) {
      logResumeAlignment({
        alignedNextBillingDate: null,
        mode,
        nextDeliveryAfterResume: null,
        resumeTargetDeliveryDate: null,
        selectionId,
        wasCutoffSkipped: false,
      });

      return null;
    }

    if (isDeliveryCutoffPassed(resumeTargetDeliveryDate, now, config)) {
      resumeTargetDeliveryDate = computeNextWeeklyDeliveryDate(
        resumeTargetDeliveryDate,
      );
      wasCutoffSkipped = true;
    }

    const alignedNextBillingDate =
      mode === "schedule_only"
        ? computeBillingReadyAtForDelivery(resumeTargetDeliveryDate, config)
        : computeNextBillingDateFromCurrentDelivery(
            resumeTargetDeliveryDate,
            config,
          );

    if (!alignedNextBillingDate) {
      logResumeAlignment({
        alignedNextBillingDate: null,
        mode,
        nextDeliveryAfterResume: null,
        resumeTargetDeliveryDate,
        selectionId,
        wasCutoffSkipped,
      });

      return null;
    }

    const nextDeliveryAfterResume = computeNextWeeklyDeliveryDate(
      resumeTargetDeliveryDate,
    );

    logResumeAlignment({
      alignedNextBillingDate,
      mode,
      nextDeliveryAfterResume,
      resumeTargetDeliveryDate,
      selectionId,
      wasCutoffSkipped,
    });

    return {
      alignedNextBillingDate,
      nextDeliveryAfterResume,
      resumeTargetDeliveryDate,
    };
  } catch {
    return null;
  }
};

export const formatDeliveryDateLabel = (
  date: DeliveryDateString,
  options?: { locale?: string; short?: boolean },
): string => {
  const { day, month, year } = splitDeliveryDate(date);
  const utcNoon = new Date(Date.UTC(year, month - 1, day, 12));
  const locale = options?.locale ?? "fr-FR";

  if (options?.short) {
    const weekday = new Intl.DateTimeFormat(locale, {
      timeZone: "UTC",
      weekday: "short",
    }).format(utcNoon);
    const rest = new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    }).format(utcNoon);

    const capitalizedWeekday =
      weekday.charAt(0).toUpperCase() + weekday.slice(1).replace(/\.$/, ".");

    return `${capitalizedWeekday} ${rest}`;
  }

  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
  }).format(utcNoon);
};
