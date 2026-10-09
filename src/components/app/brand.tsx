import { cn } from "@/lib/utils";

/** IndexSphere mark: three stacked shards inside a rounded square. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground", className)}>
      <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]" aria-hidden>
        <path d="M4 7.5 12 4l8 3.5-8 3.5L4 7.5Z" fill="currentColor" />
        <path d="m4 12 8 3.5 8-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity=".75" />
        <path d="m4 16.5 8 3.5 8-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity=".45" />
      </svg>
    </span>
  );
}

export function BrandName({ className }: { className?: string }) {
  return <span className={cn("font-semibold tracking-tight", className)}>IndexSphere</span>;
}
