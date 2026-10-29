export default function MachineCode({ value, className = '' }) {
  return <strong className={className}>{value || '—'}</strong>
}
