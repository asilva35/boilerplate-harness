import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { FeedItem } from "@/hooks/useHarnessSocket";

export function ChatFeed({ items }: { items: FeedItem[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  // Depends on `items` itself, not items.length: a streaming bubble grows
  // in place (text_delta chunks update an existing item, see
  // useHarnessSocket.ts) without changing the array's length, but setFeed
  // always produces a new array reference, so this still re-fires on every
  // chunk.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [items]);

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-2 px-4 py-4">
        {items.map((item) => (
          <FeedRow key={item.id} item={item} />
        ))}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}

function FeedRow({ item }: { item: FeedItem }) {
  if (item.kind === "bubble") {
    return (
      <div className={cn("flex", item.role === "user" && "justify-end")}>
        <div
          className={cn(
            "max-w-[70%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap",
            item.role === "user"
              ? "rounded-br-sm bg-primary text-primary-foreground"
              : "rounded-bl-sm bg-muted text-foreground",
          )}
        >
          {item.text}
        </div>
      </div>
    );
  }

  if (item.kind === "chip") {
    return (
      <div className="w-fit max-w-[85%] self-start rounded-lg bg-amber-100 px-2.5 py-1.5 font-mono text-xs break-words text-amber-900 dark:bg-amber-950 dark:text-amber-300">
        {item.text}
      </div>
    );
  }

  if (item.kind === "command") {
    return (
      <div className="w-fit max-w-[85%] self-start rounded-lg bg-muted px-2.5 py-1.5 font-mono text-xs break-words whitespace-pre-wrap text-muted-foreground">
        {item.text}
      </div>
    );
  }

  return (
    <div className="w-fit max-w-[85%] self-start rounded-lg bg-destructive/15 px-3 py-2 text-sm text-destructive">
      error: {item.text}
    </div>
  );
}
