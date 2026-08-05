import { ApprovalDialog } from "@/components/ApprovalDialog";
import { ChatFeed } from "@/components/ChatFeed";
import { ChatInput } from "@/components/ChatInput";
import { StatusBadge } from "@/components/StatusBadge";
import { useHarnessSocket } from "@/hooks/useHarnessSocket";

function App() {
  const { status, mode, feed, pendingApproval, send, respondApproval } = useHarnessSocket();

  return (
    <div className="mx-auto flex h-svh max-w-3xl flex-col border-x">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <h1 className="text-sm font-semibold">boilerplate-harness</h1>
        <StatusBadge status={status} />
      </header>

      <ChatFeed items={feed} />

      <footer className="border-t bg-background px-4 py-3">
        {mode === "thinking" && <p className="mb-2 text-xs text-muted-foreground">thinking…</p>}
        <ChatInput disabled={mode !== "idle"} onSend={send} />
      </footer>

      <ApprovalDialog pending={pendingApproval} onRespond={respondApproval} />
    </div>
  );
}

export default App;
