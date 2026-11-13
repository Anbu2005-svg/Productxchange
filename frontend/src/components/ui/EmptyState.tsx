import React from "react";
import Link from "next/link";
import Button from "./Button";
import { LucideIcon } from "lucide-react";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center p-8 text-center bg-surface border border-border rounded-md ${className}`}
    >
      {Icon && (
        <div className="w-10 h-10 rounded-full bg-surface-muted flex items-center justify-center text-text-tertiary mb-3">
          <Icon className="w-5 h-5" />
        </div>
      )}
      <h3 className="text-sm font-semibold text-text">{title}</h3>
      <p className="text-xs text-text-secondary mt-1 max-w-sm">{description}</p>
      {actionLabel && actionHref && (
        <div className="mt-4">
          <Link href={actionHref}>
            <Button variant="secondary" size="sm">
              {actionLabel}
            </Button>
          </Link>
        </div>
      )}
      {actionLabel && onAction && !actionHref && (
        <Button variant="secondary" size="sm" onClick={onAction} className="mt-4">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

export default EmptyState;
