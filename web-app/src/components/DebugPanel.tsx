import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { DebugEvent } from "@/lib/protocol";

const LEVEL_BADGE: Record<DebugEvent["level"], string> = {
  info: "border-border text-muted-foreground",
  warn: "border-amber-400/50 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
}

// A slide-over panel, not a modal - meant to stay open alongside the chat
// while you trigger tool calls and watch events arrive live via the
// debug_event message, same data /debug show would give you but without
// having to type a command per event. Debug logging itself is still
// controlled by "/debug on"/"/debug off" in chat - this panel only
// controls whether you're looking at the stream, not whether it exists.
export function DebugPanel({ events, onClose }: { events: DebugEvent[]; onClose: () => void }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex h-svh w-full max-w-md flex-col border-l bg-background shadow-xl">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Debug log</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{events.length} event{events.length === 1 ? "" : "s"}</span>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close debug panel">
            ✕
          </Button>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 p-2">
          {events.length === 0 && (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              No events yet. Run <code className="font-mono">/debug on</code> in the chat, then trigger a tool call.
            </p>
          )}
          {events.map((event) => {
            const expanded = expandedId === event.id;
            return (
              <div key={event.id} className="rounded-lg border">
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : event.id)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-muted"
                >
                  <span className="w-8 shrink-0 font-mono text-muted-foreground">#{event.id}</span>
                  <span className="shrink-0 font-mono text-muted-foreground">{formatTime(event.time)}</span>
                  <Badge variant="outline" className={cn("shrink-0", LEVEL_BADGE[event.level])}>
                    {event.source}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate">{event.message}</span>
                  {event.payload && <span aria-hidden>•</span>}
                </button>
                {expanded && (
                  <div className="border-t px-2.5 py-2">
                    {event.correlatedId !== 0 && (
                      <p className="mb-1.5 text-xs text-muted-foreground">
                        correlated with #{event.correlatedId}
                      </p>
                    )}
                    <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[0.7rem] whitespace-pre-wrap break-words">
                      {event.payload || "(no payload)"}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
