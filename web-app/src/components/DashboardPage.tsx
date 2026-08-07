import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { truncate } from "@/lib/protocol";
import type { SessionSummary } from "@/lib/protocol";

// Phase 27: a snapshot view, not a live one - GET /api/sessions is a plain
// REST fetch (unlike the rest of this app, which speaks the WebSocket
// protocol), since a dashboard read is "give me the numbers right now,"
// not something worth pushing incrementally the way tool calls/text are.
// Refreshes on mount and on demand (the button below), same tradeoff
// DebugPanel makes for its own data.
async function fetchSessions(): Promise<SessionSummary[]> {
  const res = await fetch("/api/sessions");
  if (!res.ok) throw new Error(`GET /api/sessions: ${res.status} ${res.statusText}`);
  return res.json();
}

function formatThousands(n: number): string {
  return n.toLocaleString();
}

function formatCost(usd: number): string {
  return usd >= 0 ? `$${usd.toFixed(4)}` : "—";
}

export function DashboardPage() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchSessions()
      .then((data) => {
        setSessions(data);
        setError(null);
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="mx-auto flex h-svh max-w-4xl flex-col border-x">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <h1 className="text-sm font-semibold">Sessions dashboard</h1>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={refresh}>
          Refresh
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/">Back to chat</Link>
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {!error && sessions === null && <p className="text-sm text-muted-foreground">Loading…</p>}

        {!error && sessions !== null && sessions.length === 0 && (
          <p className="text-sm text-muted-foreground">No sessions yet - open the chat and send a message.</p>
        )}

        {!error && sessions !== null && sessions.length > 0 && (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Session</th>
                <th className="py-1.5 pr-3 font-medium">User / role / profile</th>
                <th className="py-1.5 pr-3 font-medium">Model</th>
                <th className="py-1.5 pr-3 font-medium">Input</th>
                <th className="py-1.5 pr-3 font-medium">Output</th>
                <th className="py-1.5 pr-3 font-medium">Cost</th>
                <th className="py-1.5 font-medium">Last message</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-b last:border-0">
                  <td className="py-1.5 pr-3 font-mono">{truncate(s.id, 12)}</td>
                  <td className="py-1.5 pr-3">
                    {s.userId} / {s.role} / {s.profile}
                  </td>
                  <td className="py-1.5 pr-3 font-mono">
                    {s.kind}/{s.model}
                  </td>
                  <td className="py-1.5 pr-3">{formatThousands(s.usage.inputTokens)}</td>
                  <td className="py-1.5 pr-3">{formatThousands(s.usage.outputTokens)}</td>
                  <td className="py-1.5 pr-3">{formatCost(s.estimatedCostUSD)}</td>
                  <td className="max-w-xs truncate py-1.5 text-muted-foreground">{s.lastMessage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
