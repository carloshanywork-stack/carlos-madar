import Icon from './Icon.jsx';

export default function EmptyState({ icon = 'spark', title = 'لا توجد بيانات', description, action }) {
  return (
    <div className="madar-empty">
      <div>
        <span className="madar-empty-icon"><Icon name={icon} /></span>
        <p className="madar-empty-title">{title}</p>
        {description && <p className="madar-empty-description">{description}</p>}
        {action && <div className="madar-empty-action">{action}</div>}
      </div>
    </div>
  );
}
