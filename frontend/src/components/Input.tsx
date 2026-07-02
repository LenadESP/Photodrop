import { forwardRef, type InputHTMLAttributes } from 'react';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { label, className = '', id, ...rest },
  ref,
) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>}
      <input
        ref={ref}
        id={id}
        className={`h-10 w-full rounded-lg border border-line bg-surface px-3 text-ink placeholder:text-muted/70 transition-colors focus:border-ink focus:outline-none ${className}`}
        {...rest}
      />
    </label>
  );
});
