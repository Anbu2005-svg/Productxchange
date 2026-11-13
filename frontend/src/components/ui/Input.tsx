import React, { forwardRef } from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, helperText, error, id, className = "", ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-xs font-medium text-text-secondary"
          >
            {label}
          </label>
        )}
        <input
          id={inputId}
          ref={ref}
          className={`w-full h-11 px-3 text-sm bg-surface text-text rounded-sm border ${
            error
              ? "border-danger focus:border-danger"
              : "border-border focus:border-primary"
          } transition-colors placeholder:text-text-tertiary focus:outline-none disabled:opacity-50 disabled:bg-surface-muted ${className}`}
          {...props}
        />
        {error ? (
          <p className="text-xs text-danger">{error}</p>
        ) : helperText ? (
          <p className="text-xs text-text-tertiary">{helperText}</p>
        ) : null}
      </div>
    );
  }
);
Input.displayName = "Input";

export default Input;

