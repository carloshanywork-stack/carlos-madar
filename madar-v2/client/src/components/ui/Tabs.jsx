export default function Tabs({ items, value, onChange, ariaLabel = 'التبويبات' }) {
  return (
    <div className="madar-tabs" role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.value}
          className={`madar-tab ${value === item.value ? 'active' : ''}`}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          onClick={() => onChange(item.value)}
        >
          {item.label}
          {item.count !== undefined && <span className="madar-tab-count">{item.count}</span>}
        </button>
      ))}
    </div>
  );
}
