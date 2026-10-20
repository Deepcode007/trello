/**
 * Due Date Urgency calculation and formatting utilities for Kanban cards.
 * Provides granular urgency classifications (overdue, due today, due soon, upcoming, normal),
 * contextual badge labels, and accessible styling tokens.
 */

export type DueDateUrgencyLevel =
  | "overdue"
  | "due-today"
  | "due-soon"
  | "upcoming"
  | "normal"
  | "none";

export interface DueDateUrgencyInfo {
  level: DueDateUrgencyLevel;
  isPastDue: boolean;
  isDueToday: boolean;
  isDueSoon: boolean;
  daysRemaining: number;
  label: string;
  formattedDate: string;
  badgeClasses: string;
  iconName: "alert" | "clock" | "calendar";
}

/**
 * Parses raw due date input into a local Date representation and flags whether
 * the input represents a calendar-date-only value (e.g. YYYY-MM-DD or midnight UTC).
 */
export function parseDateParts(dueDate: string | Date): { date: Date; isDateOnly: boolean } | null {
  if (dueDate instanceof Date) {
    if (isNaN(dueDate.getTime())) return null;
    return { date: dueDate, isDateOnly: false };
  }

  const str = String(dueDate).trim();
  if (!str) return null;

  // Case 1: Pure YYYY-MM-DD string
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (dateOnlyMatch) {
    const [, y, m, d] = dateOnlyMatch;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const localDate = new Date(year, month - 1, day);
    if (isNaN(localDate.getTime()) || localDate.getFullYear() !== year || localDate.getMonth() !== month - 1 || localDate.getDate() !== day) {
      return null;
    }
    return { date: localDate, isDateOnly: true };
  }

  // Case 2: ISO string with midnight time (T00:00:00.000Z, T00:00:00Z, or offset)
  const midnightIsoMatch = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.000)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(str);
  if (midnightIsoMatch) {
    const [, y, m, d] = midnightIsoMatch;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const localDate = new Date(year, month - 1, day);
    if (isNaN(localDate.getTime()) || localDate.getFullYear() !== year || localDate.getMonth() !== month - 1 || localDate.getDate() !== day) {
      return null;
    }
    return { date: localDate, isDateOnly: true };
  }

  // Case 3: Other ISO strings or date formats with explicit non-midnight time
  const parsed = new Date(str);
  if (isNaN(parsed.getTime())) return null;
  return { date: parsed, isDateOnly: false };
}

/**
 * Formats a raw ISO date string to a human-friendly short month and day (e.g. "Oct 24").
 * Returns raw input on parsing failure for backwards compatibility.
 */
export function formatCardDate(isoString?: string | null): string {
  if (!isoString) return "";
  try {
    const parsed = parseDateParts(isoString);
    if (!parsed) return isoString;
    return parsed.date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return isoString;
  }
}

/**
 * Computes the urgency level, display label, and visual styling classes for a card due date.
 *
 * @param dueDate Raw ISO string, Date object, or null/undefined
 * @param referenceDate Optional reference timestamp for testing / deterministic time evaluation
 */
export function getDueDateUrgency(
  dueDate?: string | Date | null,
  referenceDate?: Date
): DueDateUrgencyInfo {
  if (!dueDate) {
    return {
      level: "none",
      isPastDue: false,
      isDueToday: false,
      isDueSoon: false,
      daysRemaining: 0,
      label: "",
      formattedDate: "",
      badgeClasses: "text-muted-foreground",
      iconName: "clock"
    };
  }

  const parsed = parseDateParts(dueDate);
  if (!parsed) {
    const rawStr = String(dueDate);
    return {
      level: "none",
      isPastDue: false,
      isDueToday: false,
      isDueSoon: false,
      daysRemaining: 0,
      label: rawStr,
      formattedDate: rawStr,
      badgeClasses: "text-muted-foreground",
      iconName: "clock"
    };
  }

  const due = parsed.date;
  const isDateOnly = parsed.isDateOnly;
  const now = referenceDate || new Date();
  const formatted = due.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  // Calculate calendar day difference using local time boundaries
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDueDate = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysDiff = Math.round((startOfDueDate - startOfToday) / msPerDay);

  // For date-only entries, the deadline is the end of the specified calendar day (not overdue until daysDiff < 0)
  const isPastDue = isDateOnly ? daysDiff < 0 : due.getTime() < now.getTime();

  // Scenario 1: Strictly past due
  if (isPastDue) {
    const overdueDays = Math.max(0, -daysDiff);
    let label = `Overdue (${formatted})`;
    if (overdueDays === 0) {
      label = "Overdue (earlier today)";
    } else if (overdueDays === 1) {
      label = "Overdue (yesterday)";
    } else if (overdueDays > 1) {
      label = `${overdueDays}d overdue (${formatted})`;
    }

    return {
      level: "overdue",
      isPastDue: true,
      isDueToday: daysDiff === 0,
      isDueSoon: false,
      daysRemaining: daysDiff,
      label,
      formattedDate: formatted,
      badgeClasses: "text-destructive bg-destructive/10 border-destructive/30 font-medium",
      iconName: "alert"
    };
  }

  // Scenario 2: Due today (same calendar date, upcoming time today or date-only today)
  if (daysDiff === 0) {
    return {
      level: "due-today",
      isPastDue: false,
      isDueToday: true,
      isDueSoon: true,
      daysRemaining: 0,
      label: "Due today",
      formattedDate: formatted,
      badgeClasses: "text-amber-700 dark:text-amber-400 bg-amber-500/15 border-amber-500/30 font-semibold",
      iconName: "clock"
    };
  }

  // Scenario 3: Due tomorrow (next calendar date)
  if (daysDiff === 1) {
    return {
      level: "due-soon",
      isPastDue: false,
      isDueToday: false,
      isDueSoon: true,
      daysRemaining: 1,
      label: "Due tomorrow",
      formattedDate: formatted,
      badgeClasses: "text-orange-600 dark:text-orange-400 bg-orange-500/10 border-orange-500/30 font-medium",
      iconName: "clock"
    };
  }

  // Scenario 4: Due within 2-3 days
  if (daysDiff > 1 && daysDiff <= 3) {
    return {
      level: "due-soon",
      isPastDue: false,
      isDueToday: false,
      isDueSoon: true,
      daysRemaining: daysDiff,
      label: `Due in ${daysDiff} days`,
      formattedDate: formatted,
      badgeClasses: "text-orange-600 dark:text-orange-400 bg-orange-500/10 border-orange-500/30 font-medium",
      iconName: "clock"
    };
  }

  // Scenario 5: Upcoming within a week (4 to 7 days)
  if (daysDiff > 3 && daysDiff <= 7) {
    return {
      level: "upcoming",
      isPastDue: false,
      isDueToday: false,
      isDueSoon: false,
      daysRemaining: daysDiff,
      label: `Due in ${daysDiff} days`,
      formattedDate: formatted,
      badgeClasses: "text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/30 font-normal",
      iconName: "calendar"
    };
  }

  // Scenario 6: Normal future due date (> 7 days)
  return {
    level: "normal",
    isPastDue: false,
    isDueToday: false,
    isDueSoon: false,
    daysRemaining: daysDiff,
    label: formatted,
    formattedDate: formatted,
    badgeClasses: "text-muted-foreground bg-secondary/50 border-border/50 font-normal",
    iconName: "calendar"
  };
}
