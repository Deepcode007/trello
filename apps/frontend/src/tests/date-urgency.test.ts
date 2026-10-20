import { describe, it, expect } from "bun:test";
import {
  getDueDateUrgency,
  formatCardDate
} from "../lib/date-urgency";

describe("Step 8: Date Urgency Math & Utility Suite", () => {
  const fixedNow = new Date("2026-10-20T12:00:00.000Z");

  describe("formatCardDate", () => {
    it("returns empty string when date is null, undefined, or empty", () => {
      expect(formatCardDate(null)).toBe("");
      expect(formatCardDate(undefined)).toBe("");
      expect(formatCardDate("")).toBe("");
    });

    it("returns raw string if malformed date string cannot be parsed", () => {
      expect(formatCardDate("not-a-date")).toBe("not-a-date");
      expect(formatCardDate("2026-99-99")).toBe("2026-99-99");
    });

    it("formats valid ISO date strings to localized short month and day", () => {
      const formatted = formatCardDate("2026-10-25T14:30:00.000Z");
      expect(formatted).toContain("Oct");
      expect(formatted).toContain("25");
    });
  });

  describe("getDueDateUrgency Boundary & Classification Analysis", () => {
    it("returns level 'none' when dueDate is null or undefined", () => {
      const resNull = getDueDateUrgency(null, fixedNow);
      expect(resNull.level).toBe("none");
      expect(resNull.isPastDue).toBe(false);
      expect(resNull.isDueToday).toBe(false);
      expect(resNull.label).toBe("");

      const resUndef = getDueDateUrgency(undefined, fixedNow);
      expect(resUndef.level).toBe("none");
      expect(resUndef.isPastDue).toBe(false);
    });

    it("returns level 'none' with raw label on invalid date input", () => {
      const res = getDueDateUrgency("corrupted-date-xyz", fixedNow);
      expect(res.level).toBe("none");
      expect(res.isPastDue).toBe(false);
      expect(res.label).toBe("corrupted-date-xyz");
      expect(res.formattedDate).toBe("corrupted-date-xyz");
    });

    it("classifies past timestamp as overdue with appropriate badge classes", () => {
      // 3 days ago
      const threeDaysAgo = new Date("2026-10-17T12:00:00.000Z");
      const res = getDueDateUrgency(threeDaysAgo, fixedNow);

      expect(res.level).toBe("overdue");
      expect(res.isPastDue).toBe(true);
      expect(res.isDueToday).toBe(false);
      expect(res.daysRemaining).toBeLessThan(0);
      expect(res.badgeClasses).toContain("text-destructive");
      expect(res.badgeClasses).toContain("bg-destructive/10");
      expect(res.iconName).toBe("alert");
      expect(res.label).toContain("overdue");
    });

    it("classifies overdue yesterday accurately", () => {
      const yesterday = new Date("2026-10-19T10:00:00.000Z");
      const res = getDueDateUrgency(yesterday, fixedNow);

      expect(res.level).toBe("overdue");
      expect(res.isPastDue).toBe(true);
      expect(res.daysRemaining).toBe(-1);
      expect(res.label).toContain("yesterday");
    });

    it("classifies due today (same calendar date, upcoming time today)", () => {
      const laterToday = new Date("2026-10-20T18:00:00.000Z");
      const res = getDueDateUrgency(laterToday, fixedNow);

      expect(res.level).toBe("due-today");
      expect(res.isPastDue).toBe(false);
      expect(res.isDueToday).toBe(true);
      expect(res.daysRemaining).toBe(0);
      expect(res.label).toBe("Due today");
      expect(res.badgeClasses).toContain("amber");
      expect(res.iconName).toBe("clock");
    });

    it("classifies due tomorrow (next day) as due-soon", () => {
      const tomorrow = new Date("2026-10-21T12:00:00.000Z");
      const res = getDueDateUrgency(tomorrow, fixedNow);

      expect(res.level).toBe("due-soon");
      expect(res.isPastDue).toBe(false);
      expect(res.isDueSoon).toBe(true);
      expect(res.daysRemaining).toBe(1);
      expect(res.label).toBe("Due tomorrow");
      expect(res.badgeClasses).toContain("orange");
      expect(res.iconName).toBe("clock");
    });

    it("classifies 2-3 days ahead as due-soon", () => {
      const inThreeDays = new Date("2026-10-23T12:00:00.000Z");
      const res = getDueDateUrgency(inThreeDays, fixedNow);

      expect(res.level).toBe("due-soon");
      expect(res.isPastDue).toBe(false);
      expect(res.isDueSoon).toBe(true);
      expect(res.daysRemaining).toBe(3);
      expect(res.label).toBe("Due in 3 days");
      expect(res.badgeClasses).toContain("orange");
    });

    it("classifies 4-7 days ahead as upcoming", () => {
      const inFiveDays = new Date("2026-10-25T12:00:00.000Z");
      const res = getDueDateUrgency(inFiveDays, fixedNow);

      expect(res.level).toBe("upcoming");
      expect(res.isPastDue).toBe(false);
      expect(res.isDueSoon).toBe(false);
      expect(res.daysRemaining).toBe(5);
      expect(res.label).toBe("Due in 5 days");
      expect(res.badgeClasses).toContain("blue");
      expect(res.iconName).toBe("calendar");
    });

    it("classifies > 7 days ahead as normal future date", () => {
      const inTwoWeeks = new Date("2026-11-03T12:00:00.000Z");
      const res = getDueDateUrgency(inTwoWeeks, fixedNow);

      expect(res.level).toBe("normal");
      expect(res.isPastDue).toBe(false);
      expect(res.isDueToday).toBe(false);
      expect(res.isDueSoon).toBe(false);
      expect(res.daysRemaining).toBeGreaterThan(7);
      expect(res.badgeClasses).toContain("text-muted-foreground");
      expect(res.iconName).toBe("calendar");
    });

    it("handles boundary between yesterday and today at midnight transition cleanly", () => {
      const midnightToday = new Date("2026-10-20T00:00:00.000Z");
      const justBeforeMidnight = new Date("2026-10-19T23:59:59.999Z");

      const resOverdue = getDueDateUrgency(justBeforeMidnight, midnightToday);
      expect(resOverdue.isPastDue).toBe(true);
      expect(resOverdue.level).toBe("overdue");

      const resExactMidnight = getDueDateUrgency(midnightToday, midnightToday);
      expect(resExactMidnight.isPastDue).toBe(false);
      expect(resExactMidnight.isDueToday).toBe(true);
      expect(resExactMidnight.level).toBe("due-today");
    });

    it("treats date-only YYYY-MM-DD input as due today (not overdue) throughout the entire due date", () => {
      const dateOnlyStr = "2026-10-20";

      // Test at midday (12:00)
      const resMidday = getDueDateUrgency(dateOnlyStr, fixedNow);
      expect(resMidday.level).toBe("due-today");
      expect(resMidday.isPastDue).toBe(false);
      expect(resMidday.isDueToday).toBe(true);
      expect(resMidday.label).toBe("Due today");

      // Test at late night (23:45)
      const lateNight = new Date("2026-10-20T23:45:00.000Z");
      const resLate = getDueDateUrgency(dateOnlyStr, lateNight);
      expect(resLate.level).toBe("due-today");
      expect(resLate.isPastDue).toBe(false);
      expect(resLate.isDueToday).toBe(true);

      // Next calendar day at 00:05 should be overdue yesterday
      const nextDayMorning = new Date("2026-10-21T00:05:00.000Z");
      const resNextDay = getDueDateUrgency(dateOnlyStr, nextDayMorning);
      expect(resNextDay.level).toBe("overdue");
      expect(resNextDay.isPastDue).toBe(true);
      expect(resNextDay.daysRemaining).toBe(-1);
      expect(resNextDay.label).toContain("yesterday");
    });

    it("treats midnight ISO string T00:00:00.000Z as due today (not overdue) throughout the due date", () => {
      const midnightIso = "2026-10-20T00:00:00.000Z";
      const res = getDueDateUrgency(midnightIso, fixedNow);

      expect(res.level).toBe("due-today");
      expect(res.isPastDue).toBe(false);
      expect(res.isDueToday).toBe(true);
      expect(res.label).toBe("Due today");
    });

    it("formats date-only string consistently without timezone day shifts", () => {
      expect(formatCardDate("2026-10-20")).toContain("Oct");
      expect(formatCardDate("2026-10-20")).toContain("20");

      expect(formatCardDate("2026-10-20T00:00:00.000Z")).toContain("Oct");
      expect(formatCardDate("2026-10-20T00:00:00.000Z")).toContain("20");
    });
  });
});
