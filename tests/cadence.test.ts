import { describe, expect, test } from "bun:test";
import { classifyCadence } from "../src/domain/cadence.ts";
import { addDays, daysBetween, todayInTz } from "../src/lib/dates.ts";

describe("каденс", () => {
  test("вечер в Москве не сдвигает дату на следующий день", () => {
    // 2026-09-07 21:30 по Москве = 18:30 UTC. date('now') в SQLite отдал бы уже
    // 2026-09-07 корректно, но в 23:30 MSK (20:30 UTC) — всё ещё 7-е по UTC,
    // а вот в 02:00 MSK 8-го (23:00 UTC 7-го) UTC сказал бы 7-е, тогда как в Москве уже 8-е.
    expect(todayInTz("Europe/Moscow", new Date("2026-09-07T18:30:00Z"))).toBe("2026-09-07");
    expect(todayInTz("Europe/Moscow", new Date("2026-09-07T21:30:00Z"))).toBe("2026-09-08");
    expect(todayInTz("UTC", new Date("2026-09-07T21:30:00Z"))).toBe("2026-09-07");
  });

  test("просрочка считается от последней завершённой встречи", () => {
    const s = classifyCadence(
      { cadenceDays: 14, lastHeldOn: "2026-08-20", anchorOn: null }, "2026-09-07",
    );
    expect(s.status).toBe("overdue");
    expect(s.dueOn).toBe("2026-09-03");
    expect(s.daysUntilDue).toBe(-4);
    expect(s.daysSinceLast).toBe(18);
  });

  test("до первой встречи каденс считается от опоры", () => {
    const s = classifyCadence(
      { cadenceDays: 14, lastHeldOn: null, anchorOn: "2026-09-01" }, "2026-09-07",
    );
    expect(s.status).toBe("ok");
    expect(s.dueOn).toBe("2026-09-15");
    expect(s.daysSinceLast).toBeNull();
  });

  test("без каденса статус no_cadence, а не просрочка", () => {
    const s = classifyCadence(
      { cadenceDays: null, lastHeldOn: "2026-01-01", anchorOn: null }, "2026-09-07",
    );
    expect(s.status).toBe("no_cadence");
    expect(s.dueOn).toBeNull();
  });

  test("граница due_soon зависит от порога", () => {
    const input = { cadenceDays: 14, lastHeldOn: "2026-08-27", anchorOn: null };
    expect(classifyCadence(input, "2026-09-07", 3).status).toBe("due_soon"); // due 09-10
    expect(classifyCadence(input, "2026-09-07", 1).status).toBe("ok");
    expect(classifyCadence(input, "2026-09-10", 3).status).toBe("due_soon");
    expect(classifyCadence(input, "2026-09-11", 3).status).toBe("overdue");
  });

  test("арифметика дат не ломается на переходе на зимнее время", () => {
    // В конце октября в европейских зонах сдвиг часов; счёт в UTC-полдне это игнорирует.
    expect(addDays("2026-10-24", 7)).toBe("2026-10-31");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(daysBetween("2026-10-24", "2026-11-01")).toBe(8);
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});
