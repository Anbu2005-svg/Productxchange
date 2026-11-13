import React from "react";

export type BadgeStatus =
  | "ACTIVE"
  | "PENDING"
  | "CONFIRMED"
  | "RENTED"
  | "COMPLETED"
  | "SOLD"
  | "CANCELLED"
  | "REJECTED"
  | "neutral";

export interface BadgeProps {
  status?: BadgeStatus;
  children?: React.ReactNode;
  className?: string;
  dot?: boolean;
}

const statusStyles: Record<
  BadgeStatus,
  { bg: string; text: string; dot: string }
> = {
  ACTIVE: {
    bg: "bg-success-subtle",
    text: "text-success",
    dot: "bg-success",
  },
  PENDING: {
    bg: "bg-warning-subtle",
    text: "text-warning",
    dot: "bg-warning",
  },
  CONFIRMED: {
    bg: "bg-info-subtle",
    text: "text-info",
    dot: "bg-info",
  },
  RENTED: {
    bg: "bg-rented-subtle",
    text: "text-rented",
    dot: "bg-rented",
  },
  COMPLETED: {
    bg: "bg-surface-muted",
    text: "text-text-secondary",
    dot: "bg-text-tertiary",
  },
  SOLD: {
    bg: "bg-surface-muted",
    text: "text-text-secondary",
    dot: "bg-text-tertiary",
  },
  CANCELLED: {
    bg: "bg-danger-subtle",
    text: "text-danger",
    dot: "bg-danger",
  },
  REJECTED: {
    bg: "bg-danger-subtle",
    text: "text-danger",
    dot: "bg-danger",
  },
  neutral: {
    bg: "bg-surface-muted",
    text: "text-text-secondary",
    dot: "bg-text-tertiary",
  },
};

export function Badge({
  status = "neutral",
  children,
  className = "",
  dot = true,
}: BadgeProps) {
  const current = statusStyles[status] || statusStyles.neutral;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${current.bg} ${current.text} ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${current.dot}`} />}
      {children || status}
    </span>
  );
}

export function TypeTag({
  type,
  className = "",
}: {
  type: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border border-border text-text-secondary bg-surface ${className}`}
    >
      {type}
    </span>
  );
}

export default Badge;
