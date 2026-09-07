import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { useDb } from "../src/db/index.ts";
import { getAppUser } from "../src/db/queries/app-user.ts";
import { mountRoutes } from "../src/routes/index.ts";
import { onError, onNotFound } from "../src/middleware/errors.ts";
import { errorMessage } from "../src/i18n/index.ts";
import { SettingsError } from "../src/lib/errors.ts";
import { completeMeeting, makeMeeting, makePerson, testDb } from "./helpers.ts";

/**
 * CLAUDE.md rule 4, checked where the user actually meets it.
 *
 * The zone is not a preference: it is the sole input to todayInTz(), and every cadence
 * query is handed the ?today derived from it. So the test does not set the column by
 * fixture — it posts the form, the way the manager does, and then reads the dashboard.
 * A rule verified one layer below the request is a rule that can still break on the way
 * to the user.
 *
 * The instant is pinned to 21:30 UTC on 7 September 2026. At that moment UTC still says
 * the 7th while Moscow is already on the 8th, which is exactly the day-boundary bug the
 * rule exists to prevent.
 */
const EVENING = new Date("2026-09-07T21:30:00Z");

let db: Database;
let app: Hono;

async function post(path: string, fields: Record<string, string>): Promise<Response> {
  return await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

/** The dashboard renders the status as a class, so the assertion does not depend on wording. */
async function dashboardBadge(): Promise<"overdue" | "due_soon" | "other"> {
  const body = await (await app.request("/")).text();
  if (body.includes('class="badge overdue"')) return "overdue";
  if (body.includes('class="badge due_soon"')) return "due_soon";
  return "other";
}

beforeAll(() => {
  setSystemTime(EVENING);
  db = testDb();
  useDb(db);

  // Cadence 14 days from a meeting held on 24 August: due on 7 September. On the 7th that
  // is "due today"; one day later it is overdue. The zone alone decides which.
  const person = makePerson(db, "Placeholder Person");
  completeMeeting(db, makeMeeting(db, person, null, "2026-08-24"));

  app = new Hono();
  app.onError(onError);
  app.notFound(onNotFound);
  mountRoutes(app);
});

afterAll(() => {
  useDb(undefined);
  db.close();
  setSystemTime();
});

describe("timezone in settings", () => {
  test("the form writes app_user.timezone", async () => {
    const res = await post("/settings/timezone", { timezone: "Asia/Tashkent" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/settings");
    expect(getAppUser(db)!.timezone).toBe("Asia/Tashkent");
  });

  test("an unknown zone is refused by error code and nothing is stored", async () => {
    const before = getAppUser(db)!.timezone;
    const res = await post("/settings/timezone", { timezone: "Mars/Olympus_Mons" });
    const body = await res.text();

    expect(getAppUser(db)!.timezone).toBe(before);
    expect(body).toContain(
      errorMessage("ru", new SettingsError("TIMEZONE_INVALID", { timezone: "Mars/Olympus_Mons" })),
    );
  });

  test("an empty zone is refused too, rather than blanking the column", async () => {
    const before = getAppUser(db)!.timezone;
    await post("/settings/timezone", { timezone: "" });
    expect(getAppUser(db)!.timezone).toBe(before);
  });

  test("the zone chosen in the form decides which day the cadence is measured against", async () => {
    // 21:30 UTC on the 7th: UTC is still on the 7th, so the meeting is due today.
    expect((await post("/settings/timezone", { timezone: "UTC" })).status).toBe(303);
    expect(await dashboardBadge()).toBe("due_soon");

    // The same instant in Moscow is already the 8th, so the same meeting is a day overdue.
    expect((await post("/settings/timezone", { timezone: "Europe/Moscow" })).status).toBe(303);
    expect(await dashboardBadge()).toBe("overdue");

    // And back: the dashboard follows the stored zone on every read, with no cron and no
    // cache to go stale.
    expect((await post("/settings/timezone", { timezone: "UTC" })).status).toBe(303);
    expect(await dashboardBadge()).toBe("due_soon");
  });

  test("the settings page offers the stored zone as the selected option", async () => {
    await post("/settings/timezone", { timezone: "Asia/Tashkent" });
    const body = await (await app.request("/settings")).text();
    expect(body).toContain('<option value="Asia/Tashkent" selected>');
    expect(body).toContain('<option value="Europe/Moscow" >');
  });
});
