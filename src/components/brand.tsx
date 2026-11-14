import { cn } from "@/lib/utils";

/** DevFest Toronto wordmark using Google's four primary colours. */
export function Brand({ className, sub }: { className?: string; sub?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span aria-hidden className="grid grid-cols-2 gap-0.5">
        <span className="h-2.5 w-2.5 rounded-full bg-g-blue" />
        <span className="h-2.5 w-2.5 rounded-full bg-g-red" />
        <span className="h-2.5 w-2.5 rounded-full bg-g-yellow" />
        <span className="h-2.5 w-2.5 rounded-full bg-g-green" />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block text-sm font-bold">
          <span className="text-g-blue">Dev</span>
          <span className="text-g-red">Fest</span> <span className="text-[#b06000] dark:text-g-yellow">Toronto</span> <span className="hidden text-g-green min-[400px]:inline">2026</span>
        </span>
        {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
      </span>
    </div>
  );
}
