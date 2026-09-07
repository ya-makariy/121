/** The only place the environment is read. Everything else takes the finished object. */

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got: ${v}`);
  return n;
}

export type Locale = "ru" | "en";

const rawLocale = str("DEFAULT_LOCALE", "ru");
if (rawLocale !== "ru" && rawLocale !== "en") {
  throw new Error(`DEFAULT_LOCALE must be ru or en, got: ${rawLocale}`);
}

export const config = {
  port: int("PORT", 3121),
  /** v1 deliberately listens on loopback only: there is no auth, the network is the guard. */
  host: str("HOST", "127.0.0.1"),
  dbPath: str("DB_PATH", "data/121.sqlite"),
  backupDir: str("BACKUP_DIR", "data/backups"),
  baseUrl: str("BASE_URL", `http://127.0.0.1:${int("PORT", 3121)}`),
  defaultLocale: rawLocale as Locale,
  /** Timezone for cadence arithmetic. See CLAUDE.md rule 4. */
  timezone: str("TZ", "Europe/Moscow"),
  /** How many days before the due date still counts as "due soon". */
  dueSoonDays: int("DUE_SOON_DAYS", 3),
  /** Minimum people in an aggregate bucket, so it cannot de-anonymize anyone. */
  minPeoplePerBucket: int("MIN_PEOPLE_PER_BUCKET", 3),
} as const;
