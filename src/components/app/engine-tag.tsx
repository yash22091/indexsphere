import { ArrowRight } from "lucide-react";
import { ENGINE_LABEL, type Engine } from "@/constants/navigation";
import { cn } from "@/lib/utils";

/** Small ES / CH marker identifying which engine a page belongs to or works with. */
export function EngineTag({ engine, solid }: { engine: Engine; solid?: boolean }) {
  return (
    <span
      title={ENGINE_LABEL[engine].long}
      className={cn(
        "inline-flex h-4 shrink-0 items-center rounded px-1 font-mono text-[9px] font-semibold leading-none tracking-normal",
        engine === "search"
          ? solid ? "bg-info/15 text-info" : "border border-info/30 text-info"
          : solid ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "border border-amber-500/40 text-amber-700 dark:text-amber-400",
      )}
    >
      {ENGINE_LABEL[engine].short}
    </span>
  );
}

/** Tags shown on cross-engine pages: "ES CH" or a directional "ES → CH". */
export function EngineTags({ engines, flow }: { engines?: Engine[]; flow?: [Engine, Engine] }) {
  if (flow) {
    const [from, to] = flow;
    return (
      <span
        className="flex shrink-0 items-center gap-0.5"
        title={`${ENGINE_LABEL[from].long} → ${ENGINE_LABEL[to].long}`}
      >
        <EngineTag engine={from} />
        <ArrowRight className="h-2.5 w-2.5 text-muted-foreground" />
        <EngineTag engine={to} />
      </span>
    );
  }
  if (!engines?.length) return null;
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {engines.map(e => <EngineTag key={e} engine={e} />)}
    </span>
  );
}
