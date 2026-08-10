import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { truncate } from "@/lib/protocol";
import type { ChatSummary } from "@/lib/protocol";

// Phase 28: the saved-conversations archive - distinct from /dashboard
// (Phase 27, live sessions this process currently holds, gone on
// restart). GET /api/chats is a plain snapshot fetch, same tradeoff
// DashboardPage makes: a list read is "give me what's on disk right now,"
// not something worth streaming incrementally.
async function fetchChats(): Promise<ChatSummary[]> {
  const res = await fetch("/api/chats");
  if (!res.ok) throw new Error(`GET /api/chats: ${res.status} ${res.statusText}`);
  return res.json();
}

async function patchChat(id: string, changes: { title?: string; pinned?: boolean }): Promise<ChatSummary> {
  const res = await fetch(`/api/chats/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(changes),
  });
  if (!res.ok) throw new Error(`PATCH /api/chats/${id}: ${res.status} ${res.statusText}`);
  return res.json();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function ChatHistoryPage() {
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const refresh = useCallback(() => {
    fetchChats()
      .then((data) => {
        setChats(data);
        setError(null);
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function startRename(chat: ChatSummary) {
    setEditingId(chat.id);
    setDraftTitle(chat.title);
  }

  async function commitRename(id: string) {
    const title = draftTitle.trim();
    setEditingId(null);
    if (!title) return;
    try {
      const updated = await patchChat(id, { title });
      setChats((prev) => prev?.map((c) => (c.id === id ? updated : c)) ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function togglePinned(chat: ChatSummary) {
    try {
      const updated = await patchChat(chat.id, { pinned: !chat.pinned });
      setChats((prev) => prev?.map((c) => (c.id === chat.id ? updated : c)) ?? null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="mx-auto flex h-svh max-w-4xl flex-col border-x">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <h1 className="text-sm font-semibold">Chats</h1>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={refresh}>
          Refresh
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/">Back to chat</Link>
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {!error && chats === null && <p className="text-sm text-muted-foreground">Loading…</p>}

        {!error && chats !== null && chats.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No saved chats yet - conversations are archived here after their first reply.
          </p>
        )}

        {!error && chats !== null && chats.length > 0 && (
          <ul className="flex flex-col gap-2">
            {chats.map((chat) => (
              <li key={chat.id} className="rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => togglePinned(chat)}
                    title={chat.pinned ? "Unpin" : "Pin"}
                    className={chat.pinned ? "text-foreground" : "text-muted-foreground"}
                  >
                    {chat.pinned ? "★" : "☆"}
                  </button>

                  {editingId === chat.id ? (
                    <Input
                      autoFocus
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      onBlur={() => commitRename(chat.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(chat.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="h-7 max-w-xs text-sm"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => startRename(chat)}
                      className="truncate text-left text-sm font-medium hover:underline"
                      title="Click to rename"
                    >
                      {chat.title}
                    </button>
                  )}

                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">{formatDate(chat.updatedAt)}</span>
                </div>

                <p className="mt-1 truncate text-xs text-muted-foreground">{truncate(chat.lastMessage, 140)}</p>

                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {chat.messageCount} messages · {chat.userId}/{chat.role}/{chat.profile}
                  </span>
                  <Button variant="ghost" size="xs" asChild className="ml-auto">
                    <Link to={`/?session=${encodeURIComponent(chat.id)}`}>Open</Link>
                  </Button>
                  <Button variant="ghost" size="xs" asChild>
                    <a href={`/api/chats/${encodeURIComponent(chat.id)}/export?format=md`}>Export .md</a>
                  </Button>
                  <Button variant="ghost" size="xs" asChild>
                    <a href={`/api/chats/${encodeURIComponent(chat.id)}/export?format=json`}>Export .json</a>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
