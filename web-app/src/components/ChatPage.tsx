import { useState } from "react";
import { Link } from "react-router-dom";
import { ApprovalDialog } from "@/components/ApprovalDialog";
import { ChatFeed } from "@/components/ChatFeed";
import { ChatInput } from "@/components/ChatInput";
import { DebugPanel } from "@/components/DebugPanel";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { useHarnessSocket } from "@/hooks/useHarnessSocket";

// The original single-page App.tsx from Phase 10, moved here unchanged
// except for the new "Dashboard" nav link - Phase 27 needed a second,
// separately-routed page (see App.tsx), so this stopped being the app's
// only screen.
export function ChatPage() {
  const { status, mode, feed, pendingApproval, debugEvents, send, respondApproval } = useHarnessSocket();
  const [showDebug, setShowDebug] = useState(false);

  return (
    <div className="mx-auto flex h-svh max-w-3xl flex-col border-x">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <h1 className="text-sm font-semibold">boilerplate-harness</h1>
        <StatusBadge status={status} />
        <Button variant="ghost" size="sm" className="ml-auto" asChild>
          <Link to="/chats">Chats</Link>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/dashboard">Dashboard</Link>
        </Button>
        {/* Toggles whether this panel is visible - debug logging itself
            stays controlled by "/debug on"/"/debug off" in chat. */}
        <Button
          variant={showDebug ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setShowDebug((v) => !v)}
        >
          Debug{debugEvents.length > 0 ? ` (${debugEvents.length})` : ""}
        </Button>
      </header>

      <ChatFeed items={feed} />

      <footer className="border-t bg-background px-4 py-3">
        {mode === "thinking" && <p className="mb-2 text-xs text-muted-foreground">thinking…</p>}
        <ChatInput disabled={mode !== "idle"} onSend={send} />
      </footer>

      <ApprovalDialog pending={pendingApproval} onRespond={respondApproval} />
      {showDebug && <DebugPanel events={debugEvents} onClose={() => setShowDebug(false)} />}
    </div>
  );
}
