import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ChatInput({ disabled, onSend }: { disabled: boolean; onSend: (line: string) => void }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const el = textareaRef.current;
    if (!el) return;
    const line = el.value.trim();
    if (!line) return;
    onSend(line);
    el.value = "";
  }

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {/* field-sizing-content (baked into the Textarea primitive) auto-grows
          the box as you type - no manual scrollHeight measuring needed,
          unlike the Phase 6 vanilla client. */}
      <Textarea
        ref={textareaRef}
        rows={1}
        disabled={disabled}
        placeholder="Type your message or /help…"
        className="max-h-24 resize-none overflow-y-auto"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <Button type="submit" disabled={disabled} size="lg">
        Send
      </Button>
    </form>
  );
}
