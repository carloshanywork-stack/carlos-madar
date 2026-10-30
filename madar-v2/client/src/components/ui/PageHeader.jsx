export default function PageHeader({ kicker, title, description, actions }) {
  return (
    <header className="madar-page-header">
      <div>
        {kicker && <span className="madar-page-kicker">{kicker}</span>}
        <h1 className="madar-page-heading">{title}</h1>
        {description && <p className="madar-page-description">{description}</p>}
      </div>
      {actions && <div className="madar-page-actions">{actions}</div>}
    </header>
  );
}
