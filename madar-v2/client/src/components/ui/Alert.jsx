import Icon from './Icon.jsx';

export default function Alert({ children, tone = 'info' }) {
  if (!children) return null;
  return <div className={`madar-alert madar-alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}><Icon name={tone === 'error' ? 'alert' : 'spark'} size={15} /><span>{children}</span></div>;
}
