export default function DomainTabs({ tabs, value, onChange, label }) {
  return <div className="domain-tabs" role="tablist" aria-label={label}>
    {tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={value === tab.id}
      className={`domain-tab ${value === tab.id ? 'domain-tab-active' : ''}`} onClick={() => onChange(tab.id)}>
      {tab.icon && <tab.icon size={16}/>}<span>{tab.label}</span>{tab.count != null && <small>{tab.count}</small>}
    </button>)}
  </div>
}
