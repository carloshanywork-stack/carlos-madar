import { statusLabels, statusTone } from '../../lib/format.js';

export default function Badge({ status, children, tone }) {
  const label = children ?? statusLabels[status] ?? status;
  return <span className={`madar-badge madar-badge-${tone ?? statusTone(status)}`}>{label}</span>;
}
