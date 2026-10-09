import type { ComponentType, ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type Tone = "default" | "success" | "warning" | "danger" | "info";

const toneText: Record<Tone, string> = {
  default: "",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  info: "text-info",
};

/**
 * Metric tile: muted label + icon, large value, optional hint.
 * Colour is reserved for the value's state (tone), never decoration.
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  tone?: Tone;
  className?: string;
}) {
  return (
    <Card className={cn("gap-0 py-0", className)}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-muted-foreground truncate">{label}</span>
          {Icon && <Icon className="h-4 w-4 text-muted-foreground shrink-0" />}
        </div>
        <div className={cn("mt-2 text-2xl font-semibold tracking-tight tabular-nums", toneText[tone])}>{value}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-4 grid-cols-2 lg:grid-cols-4", className)}>{children}</div>;
}
