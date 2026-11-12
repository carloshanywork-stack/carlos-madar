/** Presentation only: never rewrite catalog labels or stored quantities. */
export function maintenanceLineText(label, line) {
  const text = String(label ?? '').trim();
  const quantity = Number(line?.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1) return text;
  const replacement = text.match(/^(?:تم\s+)?(?:تغيير|تغير|استبدال|تبديل)\s+(.+)$/u);
  if (replacement && line.actionMeaning !== 'required_work') return `تم تغيير عدد ${quantity} ${replacement[1]}`;
  const installation = text.match(/^(?:تم\s+)?تركيب\s+(.+)$/u);
  if (installation && line.actionMeaning !== 'required_work') return `تم تركيب عدد ${quantity} ${installation[1]}`;
  return `${text} (العدد: ${quantity})`;
}
