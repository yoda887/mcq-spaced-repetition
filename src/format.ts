/** Число с одним знаком после запятой, без ",0": 1.5 -> "1,5", 2 -> "2". */
function oneDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return String(rounded).replace(".", ",");
}

/**
 * Интервал для кнопок оценки: до месяца — в днях, до года — в месяцах, дальше — в годах.
 * 1 -> "1 дн", 45 -> "1,5 мес", 400 -> "1,1 г".
 */
export function formatInterval(days: number): string {
  const d = Math.max(0, Math.round(days));
  if (d < 30) return `${d} дн`;
  if (d < 365) return `${oneDecimal(d / 30.4)} мес`;
  return `${oneDecimal(d / 365)} г`;
}
