/** Единственное место, где читается окружение. Всё остальное берёт готовый объект. */

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} должен быть числом, получено: ${v}`);
  return n;
}

export type Locale = "ru" | "en";

const rawLocale = str("DEFAULT_LOCALE", "ru");
if (rawLocale !== "ru" && rawLocale !== "en") {
  throw new Error(`DEFAULT_LOCALE может быть только ru или en, получено: ${rawLocale}`);
}

export const config = {
  port: int("PORT", 3121),
  /** v1 сознательно слушает только петлю: авторизации нет, защита — сетевая. */
  host: str("HOST", "127.0.0.1"),
  dbPath: str("DB_PATH", "data/121.sqlite"),
  backupDir: str("BACKUP_DIR", "data/backups"),
  baseUrl: str("BASE_URL", `http://127.0.0.1:${int("PORT", 3121)}`),
  defaultLocale: rawLocale as Locale,
  /** Часовой пояс для арифметики каденса. См. CLAUDE.md §3. */
  timezone: str("TZ", "Europe/Moscow"),
  /** Сколько дней до срока считать «скоро». */
  dueSoonDays: int("DUE_SOON_DAYS", 3),
  /** Минимум людей в корзине агрегата, чтобы не деанонимизировать. */
  minPeoplePerBucket: int("MIN_PEOPLE_PER_BUCKET", 3),
} as const;
