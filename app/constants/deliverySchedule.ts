export const DELIVERY_TIMEZONE = "Europe/Paris" as const;

export const DELIVERY_MIN_OFFSET_DAYS = 3;
export const DELIVERY_MAX_OFFSET_DAYS = 10;

/** Last calendar day for portal modifications before delivery (J-3 at 23:59 Paris). */
export const DELIVERY_CUTOFF_OFFSET_DAYS = 3;
export const DELIVERY_CUTOFF_HOUR = 23;
export const DELIVERY_CUTOFF_MINUTE = 59;

/** 0 = Sunday, 6 = Saturday */
export const DELIVERY_BLOCKED_WEEKDAYS = [0] as const;

export const DELIVERY_RESCHEDULE_REASON = {
  MIN_LEAD_TIME: "min_lead_time",
  OUT_OF_WINDOW: "out_of_window",
  PAYMENT_TOO_LATE: "payment_too_late",
  SUNDAY_EXCLUDED: "sunday_excluded",
} as const;

export type DeliveryRescheduleReason =
  (typeof DELIVERY_RESCHEDULE_REASON)[keyof typeof DELIVERY_RESCHEDULE_REASON];

export const DELIVERY_RESCHEDULE_REASON_LABELS: Record<
  DeliveryRescheduleReason,
  string
> = {
  [DELIVERY_RESCHEDULE_REASON.MIN_LEAD_TIME]:
    "délai minimum de préparation (J+3)",
  [DELIVERY_RESCHEDULE_REASON.OUT_OF_WINDOW]: "hors fenêtre de livraison",
  [DELIVERY_RESCHEDULE_REASON.PAYMENT_TOO_LATE]:
    "paiement validé trop tard pour la date choisie",
  [DELIVERY_RESCHEDULE_REASON.SUNDAY_EXCLUDED]: "dimanche non disponible",
};

export type DeliveryScheduleConfig = {
  timezone: typeof DELIVERY_TIMEZONE;
  minOffsetDays: number;
  maxOffsetDays: number;
  blockedWeekdays: readonly number[];
};

export const DEFAULT_DELIVERY_SCHEDULE_CONFIG: DeliveryScheduleConfig = {
  blockedWeekdays: DELIVERY_BLOCKED_WEEKDAYS,
  maxOffsetDays: DELIVERY_MAX_OFFSET_DAYS,
  minOffsetDays: DELIVERY_MIN_OFFSET_DAYS,
  timezone: DELIVERY_TIMEZONE,
};

/** SQL CHECK pattern for Prisma migrations (YYYY-MM-DD). */
export const DELIVERY_DATE_SQL_CHECK_PATTERN = "^[0-9]{4}-[0-9]{2}-[0-9]{2}$";
