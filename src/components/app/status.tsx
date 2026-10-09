import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Health = "green" | "yellow" | "red" | string | undefined | null;

const dot: Record<string, string> = {
  green: "bg-success",
  yellow: "bg-warning",
  red: "bg-destructive",
};

/** Small coloured dot for a state. */
export function StatusDot({ status, className }: { status: Health; className?: string }) {
  return <span className={cn("inline-block h-2 w-2 rounded-full", dot[String(status)] ?? "bg-muted-foreground/40", className)} aria-hidden />;
}

/** Elasticsearch/OpenSearch health (green / yellow / red) as an outline badge with a dot. */
export function HealthBadge({ status, className }: { status: Health; className?: string }) {
  const label = status ? String(status).charAt(0).toUpperCase() + String(status).slice(1) : "Unknown";
  return (
    <Badge variant="outline" className={cn("gap-1.5 font-medium", className)}>
      <StatusDot status={status} />
      {label}
    </Badge>
  );
}

const sevClass: Record<string, string> = {
  critical: "border-transparent bg-destructive text-white",
  high: "border-transparent bg-destructive/15 text-destructive",
  medium: "border-transparent bg-warning/20 text-warning-foreground dark:text-warning",
  warning: "border-transparent bg-warning/20 text-warning-foreground dark:text-warning",
  low: "border-transparent bg-info/15 text-info",
  info: "border-transparent bg-info/15 text-info",
  ok: "border-transparent bg-success/15 text-success",
  good: "border-transparent bg-success/15 text-success",
};

/** Severity / result label with consistent semantic colours. */
export function SeverityBadge({ level, children, className }: { level: string; children?: ReactNode; className?: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", sevClass[level.toLowerCase()] ?? "", className)}>
      {children ?? level}
    </Badge>
  );
}
