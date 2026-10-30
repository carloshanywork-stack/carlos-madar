import { forwardRef } from 'react';

export function Field({ label, hint, error, children, className = '', htmlFor }) {
  return (
    <label className={`madar-field ${className}`} htmlFor={htmlFor}>
      {label && <span>{label}</span>}
      {children}
      {hint && !error && <small className="madar-field-hint">{hint}</small>}
      {error && <small className="madar-field-error">{error}</small>}
    </label>
  );
}

export const Input = forwardRef(function Input({ label, hint, error, className = '', id, ...props }, ref) {
  return <Field label={label} hint={hint} error={error} className={className} htmlFor={id}><input ref={ref} id={id} {...props} /></Field>;
});

export const Select = forwardRef(function Select({ label, hint, error, className = '', id, children, ...props }, ref) {
  return <Field label={label} hint={hint} error={error} className={className} htmlFor={id}><select ref={ref} id={id} {...props}>{children}</select></Field>;
});

export const Textarea = forwardRef(function Textarea({ label, hint, error, className = '', id, ...props }, ref) {
  return <Field label={label} hint={hint} error={error} className={className} htmlFor={id}><textarea ref={ref} id={id} {...props} /></Field>;
});
