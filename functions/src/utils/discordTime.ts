/**
 * A time as Discord timestamp markup, relative and with the date: "in 3 days (31/10/2026, 10:35)".
 * Each reader sees it in their own timezone and date format. Dates added on request, 2026-10-28.
 */
export function discordTime(ms: number): string {
  const sec = Math.floor(ms / 1000);
  return `<t:${sec}:R> (<t:${sec}:s>)`;
}
