import React from "react";
import Button from "./Button";
import { AlertCircle } from "lucide-react";

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  className = "",
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center p-6 text-center bg-surface border border-danger/30 rounded-md ${className}`}
    >
      <div className="w-9 h-9 rounded-full bg-danger-subtle flex items-center justify-center text-danger mb-2.5">
        <AlertCircle className="w-5 h-5" />
      </div>
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      <p className="text-xs text-text-secondary mt-1 max-w-sm">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-3.5">
          Retry
        </Button>
      )}
    </div>
  );
}

export default ErrorState;

