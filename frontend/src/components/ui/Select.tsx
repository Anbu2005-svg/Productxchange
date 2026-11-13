import React, { forwardRef } from "react";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helperText?: string;
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, helperText, error, id, className = "", children, ...props }, ref) => {
    const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label
            htmlFor={selectId}
            className="block text-xs font-medium text-text-secondary"
          >
            {label}
          </label>
        )}
        <select
          id={selectId}
          ref={ref}
          className={`w-full h-11 px-3 text-sm bg-surface text-text rounded-sm border ${
            error
              ? "border-danger focus:border-danger"
              : "border-border focus:border-primary"
          } transition-colors focus:outline-none disabled:opacity-50 disabled:bg-surface-muted ${className}`}
          {...props}
        >
          {children}
        </select>
        {error ? (
          <p className="text-xs text-danger">{error}</p>
        ) : helperText ? (
          <p className="text-xs text-text-tertiary">{helperText}</p>
        ) : null}
      </div>
    );
  }
);
Select.displayName = "Select";

export default Select;

