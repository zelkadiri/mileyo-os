import {
  SUBSCRIPTION_CYCLE_MEAL_CUTOFF_HOUR,
  SUBSCRIPTION_CYCLE_MEAL_CUTOFF_MINUTE,
  SUBSCRIPTION_CYCLE_MEAL_CUTOFF_WEEKDAY,
  SUBSCRIPTION_CYCLE_TIMEZONE,
} from "../constants/subscriptionCycle";
import {
  resolveNextBillingCycleAfterDelivery,
  resolveScheduleOnlyResumeBillingDate,
} from "./subscriptionBillingSchedule";
import {
  DEFAULT_DELIVERY_SCHEDULE_CONFIG,
  DELIVERY_BILLING_READY_HOUR,
  DELIVERY_BILLING_READY_MINUTE,
  DELIVERY_CUTOFF_OFFSET_DAYS,
  DELIVERY_RESCHEDULE_REASON,
  DELIVERY_WEEKLY_INTERVAL_DAYS,
  type DeliveryRescheduleReason,
  type DeliveryScheduleConfig,
} from "../constants/deliverySchedule";

/** Thursday weekday in JS Date#getDay convention. */
const DELIVERY_WINDOW_THURSDAY_WEEKDAY = 4;

/** Tuesday and Wednesday — imminent delivery window is skipped after Monday cutoff. */
const DELIVERY_WINDOW_SKIP_WEEKDAYS = [2, 3] as const;

export type BuilderDeliveryWindowOption = {
  cardLabel: string;
  fridayDate: DeliveryDateString;
  key: DeliveryDateString;
  rangeLabel: string;
  scheduledDeliveryDate: DeliveryDateString;
  thursdayDate: DeliveryDateString;
  weekStartDate: DeliveryDateString;
};

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
    hour > SUBSCRIPTION_CYCLE_MEAL_CUTOFF_HOUR ||
    (hour === SUBSCRIPTION_CYCLE_MEAL_CUTOFF_HOUR &&
      minute > SUBSCRIPTION_CYCLE_MEAL_CUTOFF_MINUTE)
  );
};

/**
 * Historical billing-ready cutoff date: delivery minus
 * `DELIVERY_CUTOFF_OFFSET_DAYS` calendar days (J-3).
 * Do not use for portal meal-selection cutoff.
 */
export const getDeliveryCutoffCalendarDate = (
  scheduledDeliveryDate: DeliveryDateString,
): DeliveryDateString =>
  addCalendarDays(scheduledDeliveryDate, -DELIVERY_CUTOFF_OFFSET_DAYS);

/**
 * Monday of the civil week that contains `scheduledDeliveryDate`.
 * Thursday and Friday of the same week share this cutoff date.
 */
export const getMealSelectionCutoffCalendarDate = (
  scheduledDeliveryDate: DeliveryDateString,
): DeliveryDateString => {
  const daysFromCutoffWeekday =
    (getWeekday(scheduledDeliveryDate) -
      SUBSCRIPTION_CYCLE_MEAL_CUTOFF_WEEKDAY +
      7) %
    7;

  return addCalendarDays(scheduledDeliveryDate, -daysFromCutoffWeekday);
};

export const formatDeliveryCutoffDeadlineLabel = (
  scheduledDeliveryDate: string | null | undefined,
  options?: { locale?: string },
): string | null => {
  const parsed = parseDeliveryDate(scheduledDeliveryDate);

  if (!parsed) {
    return null;
  }

  const cutoffDate = getMealSelectionCutoffCalendarDate(parsed);
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

  return `${weekday} ${rest} à ${SUBSCRIPTION_CYCLE_MEAL_CUTOFF_HOUR}h${String(SUBSCRIPTION_CYCLE_MEAL_CUTOFF_MINUTE).padStart(2, "0")}`;
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

  const cutoffDate = getMealSelectionCutoffCalendarDate(parsed);
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

/** J-2 calendar date used by historical billing-ready (cutoff J-3 + 1 day). */
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

export type DeliveryBillingReadinessReason =
  | "ready"
  | "delivery_billing_not_ready"
  | "unknown_delivery";

export type DeliveryBillingReadiness = {
  billingReadyAt: Date | null;
  billingTargetDeliveryDate: DeliveryDateString | null;
  isReady: boolean;
  projectedActiveDeliveryDate: DeliveryDateString | null;
  reason: DeliveryBillingReadinessReason;
};

export const resolveBillingTargetDeliveryDate = ({
  config = DEFAULT_DELIVERY_SCHEDULE_CONFIG,
  now = new Date(),
  projectedActiveDeliveryDate,
}: {
  config?: DeliveryScheduleConfig;
  now?: Date;
  projectedActiveDeliveryDate: DeliveryDateString;
}): DeliveryDateString => {
  if (isDeliveryCutoffPassed(projectedActiveDeliveryDate, now, config)) {
    return projectedActiveDeliveryDate;
  }

  return computeNextWeeklyDeliveryDate(projectedActiveDeliveryDate);
};

export const evaluateDeliveryBillingReadiness = ({
  config = DEFAULT_DELIVERY_SCHEDULE_CONFIG,
  nextScheduledDeliveryDate,
  now = new Date(),
  preferredDeliveryWeekday,
}: {
  config?: DeliveryScheduleConfig;
  nextScheduledDeliveryDate: string | null;
  now?: Date;
  preferredDeliveryWeekday: number | null | undefined;
}): DeliveryBillingReadiness => {
  try {
    const projection = projectActiveScheduledDeliveryDate({
      config,
      nextScheduledDeliveryDate,
      now,
      preferredDeliveryWeekday,
    });

    if (!projection.effectiveDeliveryDate) {
      return {
        billingReadyAt: null,
        billingTargetDeliveryDate: null,
        isReady: false,
        projectedActiveDeliveryDate: null,
        reason: "unknown_delivery",
      };
    }

    const billingTargetDeliveryDate = resolveBillingTargetDeliveryDate({
      config,
      now,
      projectedActiveDeliveryDate: projection.effectiveDeliveryDate,
    });

    const billingReadyAt = computeBillingReadyAtForDelivery(
      billingTargetDeliveryDate,
      config,
    );

    if (!billingReadyAt) {
      return {
        billingReadyAt: null,
        billingTargetDeliveryDate,
        isReady: false,
        projectedActiveDeliveryDate: projection.effectiveDeliveryDate,
        reason: "unknown_delivery",
      };
    }

    const isReady = now.getTime() >= billingReadyAt.getTime();

    return {
      billingReadyAt,
      billingTargetDeliveryDate,
      isReady,
      projectedActiveDeliveryDate: projection.effectiveDeliveryDate,
      reason: isReady ? "ready" : "delivery_billing_not_ready",
    };
  } catch {
    return {
      billingReadyAt: null,
      billingTargetDeliveryDate: null,
      isReady: false,
      projectedActiveDeliveryDate: null,
      reason: "unknown_delivery",
    };
  }
};

export const shouldRealignLegacyNextBillingDate = ({
  billingReadyAt,
  nextBillingDate,
}: {
  billingReadyAt: Date | null;
  nextBillingDate: Date | null;
}): boolean => {
  if (!billingReadyAt || !nextBillingDate) {
    return false;
  }

  return nextBillingDate.getTime() < billingReadyAt.getTime();
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
  existingNextBillingDate = null,
  mode,
  now = new Date(),
  selection,
  selectionId,
}: {
  config?: DeliveryScheduleConfig;
  existingNextBillingDate?: Date | null;
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
        ? resolveScheduleOnlyResumeBillingDate({
            existingNextBillingDate,
            now,
            targetDeliveryDate: resumeTargetDeliveryDate,
            timezone: config.timezone,
          })
        : resolveNextBillingCycleAfterDelivery(
            resumeTargetDeliveryDate,
            config.timezone,
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

export const getDeliveryWeekStartForDate = (
  thursdayDate: DeliveryDateString,
): DeliveryDateString => addCalendarDays(thursdayDate, -3);

export const getNextStrictThursday = (
  referenceDate: DeliveryDateString,
): DeliveryDateString => {
  let cursor = addCalendarDays(referenceDate, 1);

  while (getWeekday(cursor) !== DELIVERY_WINDOW_THURSDAY_WEEKDAY) {
    cursor = addCalendarDays(cursor, 1);
  }

  return cursor;
};

export const getFirstEligibleDeliveryThursday = (
  referenceDate: DeliveryDateString,
): DeliveryDateString => {
  const nextThursday = getNextStrictThursday(referenceDate);
  const referenceWeekday = getWeekday(referenceDate);

  if (
    DELIVERY_WINDOW_SKIP_WEEKDAYS.includes(
      referenceWeekday as (typeof DELIVERY_WINDOW_SKIP_WEEKDAYS)[number],
    )
  ) {
    return addCalendarDays(nextThursday, DELIVERY_WEEKLY_INTERVAL_DAYS);
  }

  return nextThursday;
};

const formatDeliveryWindowWeekdayDayMonth = (
  date: DeliveryDateString,
  locale: string,
): string => {
  const { day, month, year } = splitDeliveryDate(date);
  const utcNoon = new Date(Date.UTC(year, month - 1, day, 12));
  const weekday = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "long",
  }).format(utcNoon);
  const rest = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(utcNoon);

  return `${weekday} ${rest}`;
};

export const formatDeliveryWindowRangeLabel = (
  thursdayDate: DeliveryDateString,
  fridayDate: DeliveryDateString,
  options?: { locale?: string },
): string => {
  const locale = options?.locale ?? "fr-FR";
  const thursdayLabel = formatDeliveryWindowWeekdayDayMonth(thursdayDate, locale);
  const fridayLabel = formatDeliveryWindowWeekdayDayMonth(fridayDate, locale);
  const thursdayParts = splitDeliveryDate(thursdayDate);
  const fridayParts = splitDeliveryDate(fridayDate);
  const sameMonth =
    thursdayParts.year === fridayParts.year &&
    thursdayParts.month === fridayParts.month;

  if (sameMonth) {
    return `Livraison entre ${thursdayLabel} et ${fridayLabel}`;
  }

  return `Livraison entre ${thursdayLabel} et ${fridayLabel}`;
};

export const buildWeeklyDeliveryWindow = ({
  cardLabel,
  locale = "fr-FR",
  thursdayDate,
}: {
  cardLabel: string;
  locale?: string;
  thursdayDate: DeliveryDateString;
}): BuilderDeliveryWindowOption => {
  const fridayDate = addCalendarDays(thursdayDate, 1);
  const weekStartDate = getDeliveryWeekStartForDate(thursdayDate);

  return {
    cardLabel,
    fridayDate,
    key: weekStartDate,
    rangeLabel: formatDeliveryWindowRangeLabel(thursdayDate, fridayDate, {
      locale,
    }),
    scheduledDeliveryDate: thursdayDate,
    thursdayDate,
    weekStartDate,
  };
};

export const buildBuilderDeliveryWindowOptionsFromReferenceDate = (
  referenceDate: DeliveryDateString,
  options?: { locale?: string },
): BuilderDeliveryWindowOption[] => {
  const locale = options?.locale ?? "fr-FR";
  const firstThursday = getFirstEligibleDeliveryThursday(referenceDate);
  const secondThursday = addCalendarDays(
    firstThursday,
    DELIVERY_WEEKLY_INTERVAL_DAYS,
  );

  return [
    buildWeeklyDeliveryWindow({
      cardLabel: "Prochaine livraison",
      locale,
      thursdayDate: firstThursday,
    }),
    buildWeeklyDeliveryWindow({
      cardLabel: "Livraison suivante",
      locale,
      thursdayDate: secondThursday,
    }),
  ];
};

export const buildBuilderDeliveryWindowOptions = (
  referenceInstant: Date = new Date(),
  options?: {
    locale?: string;
    timezone?: string;
  },
): BuilderDeliveryWindowOption[] => {
  const timezone = options?.timezone ?? SUBSCRIPTION_CYCLE_TIMEZONE;

  return buildBuilderDeliveryWindowOptionsFromReferenceDate(
    referenceDateFromInstant(referenceInstant, timezone),
    options,
  );
};

export const getWeeklyFirstOrderAllowedThursdays = (
  referenceDate: DeliveryDateString,
): DeliveryDateString[] =>
  buildBuilderDeliveryWindowOptionsFromReferenceDate(referenceDate).map(
    (option) => option.scheduledDeliveryDate,
  );

export const scheduleWeeklyFirstOrderDeliveryDate = ({
  desiredDeliveryDate,
  fromCustomerChoice = true,
  referenceDate,
}: {
  desiredDeliveryDate: DeliveryDateString;
  fromCustomerChoice?: boolean;
  referenceDate: DeliveryDateString;
}): DeliveryScheduleResult | null => {
  const options = buildBuilderDeliveryWindowOptionsFromReferenceDate(referenceDate);
  const allowedThursdays = options.map((option) => option.scheduledDeliveryDate);

  if (allowedThursdays.includes(desiredDeliveryDate)) {
    return {
      deliveryRescheduleReason: null,
      desiredDeliveryDate,
      scheduledDeliveryDate: desiredDeliveryDate,
    };
  }

  const imminentThursday = getNextStrictThursday(referenceDate);
  const firstEligibleThursday = options[0]?.scheduledDeliveryDate;

  if (
    fromCustomerChoice &&
    firstEligibleThursday &&
    desiredDeliveryDate === imminentThursday &&
    desiredDeliveryDate !== firstEligibleThursday
  ) {
    return {
      deliveryRescheduleReason: DELIVERY_RESCHEDULE_REASON.PAYMENT_TOO_LATE,
      desiredDeliveryDate,
      scheduledDeliveryDate: firstEligibleThursday,
    };
  }

  return null;
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
