import React, { forwardRef } from "react";
import { Loader2 } from "lucide-react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className = "",
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const base =
      "inline-flex items-center justify-center font-medium transition-colors select-none rounded-sm border disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

    const sizes = {
      sm: "h-8 px-3 text-xs",
      md: "h-10 sm:h-10 px-4 text-sm",
      lg: "h-11 px-5 text-sm",
    };

    const variants = {
      primary:
        "bg-primary text-primary-fg border-primary hover:bg-primary-hover active:bg-primary-hover",
      secondary:
        "bg-surface text-text border-border hover:bg-surface-muted hover:border-border-strong active:bg-surface-muted",
      ghost:
        "bg-transparent text-text-secondary border-transparent hover:bg-surface-muted hover:text-text active:bg-surface-muted",
      destructive:
        "bg-danger text-white border-danger hover:opacity-90 active:opacity-100",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
        {...props}
      >
        {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin text-current" />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

export default Button;

