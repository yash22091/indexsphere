"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ClusterStatusProps {
  status: "green" | "yellow" | "red" | "unknown";
  className?: string;
}

export function ClusterStatus({ status, className }: ClusterStatusProps) {
  const statusConfig = {
    green: {
      label: "Healthy",
      variant: "default" as const,
      className: "bg-green-500 hover:bg-green-600",
    },
    yellow: {
      label: "Warning", 
      variant: "secondary" as const,
      className: "bg-yellow-500 hover:bg-yellow-600 text-yellow-900",
    },
    red: {
      label: "Critical",
      variant: "destructive" as const,
      className: "bg-red-500 hover:bg-red-600",
    },
    unknown: {
      label: "Unknown",
      variant: "outline" as const,
      className: "bg-gray-500 hover:bg-gray-600",
    },
  };

  const config = statusConfig[status] || statusConfig.unknown;

  return (
    <Badge 
      variant={config.variant}
      className={cn(config.className, className)}
    >
      {config.label}
    </Badge>
  );
}
