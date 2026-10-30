import Icon from './Icon.jsx';

export default function Button({
  children,
  variant = 'primary',
  size = 'normal',
  icon,
  iconOnly = false,
  className = '',
  type = 'button',
  ...props
}) {
  const classes = [
    'madar-button',
    `madar-button-${variant}`,
    size === 'small' ? 'madar-button-small' : '',
    iconOnly ? 'madar-button-icon' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <button className={classes} type={type} {...props}>
      {icon && <Icon name={icon} size={15} />}
      {children && <span>{children}</span>}
    </button>
  );
}
