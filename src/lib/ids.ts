/**
 * Ключи, стабильные при форке версии шаблона. Форма не важна — важно, что ключ
 * генерируется один раз и потом копируется. Читаемый префикс помогает при отладке
 * экспорта и графиков.
 */
export function mintKey(prefix: string, label?: string): string {
  const slug = (label ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  const rand = crypto.randomUUID().slice(0, 8);
  return slug ? `${prefix}_${slug}_${rand}` : `${prefix}_${rand}`;
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString("base64url");
}
