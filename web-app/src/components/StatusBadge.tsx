import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ConnectionStatus } from "@/hooks/useHarnessSocket";

const LABEL: Record<ConnectionStatus, string> = {
  connecting: "connecting…",
  connected: "connected",
  disconnected: "disconnected, retrying…",
};

const DOT_COLOR: Record<ConnectionStatus, string> = {
  connecting: "bg-amber-500",
  connected: "bg-emerald-500",
  disconnected: "bg-red-500",
};

export function StatusBadge({ status }: { status: ConnectionStatus }) {
  return (
    <Badge variant="outline" className="gap-1.5 text-muted-foreground">
      <span className={cn("size-1.5 shrink-0 rounded-full", DOT_COLOR[status])} />
      {LABEL[status]}
    </Badge>
  );
}
