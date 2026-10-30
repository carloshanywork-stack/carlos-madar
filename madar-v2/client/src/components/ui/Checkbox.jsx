export default function Checkbox({ checked, onChange, label, title, description, className = '', ...props }) {
  if (title || description) {
    return (
      <label className={`employee-checkbox-card ${checked ? 'selected' : ''} ${className}`}>
        <input className="madar-checkbox" type="checkbox" checked={checked} onChange={onChange} {...props} />
        <span>
          <strong className="madar-checkbox-title">{title ?? label}</strong>
          {description && <small className="madar-checkbox-description">{description}</small>}
        </span>
      </label>
    );
  }
  return (
    <label className={`madar-checkbox-label ${className}`}>
      <input className="madar-checkbox" type="checkbox" checked={checked} onChange={onChange} {...props} />
      <span>{label}</span>
    </label>
  );
}
