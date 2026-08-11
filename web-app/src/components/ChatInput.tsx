import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { DocumentAttachment, ImageAttachment } from "@/lib/protocol";

// Mirrors anthropic.ts's ImageBlockParam.Source["media_type"] union - the
// narrowest common denominator between the two providers (OpenRouter
// itself accepts more, but there's no point letting a user attach
// something that breaks the moment they switch to Anthropic via
// /provider).
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
// Phase 30: PDFs only, per the guide's scope - not "any document format".
const ACCEPTED_DOCUMENT_TYPES = ["application/pdf"];
const ACCEPTED_TYPES = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_DOCUMENT_TYPES];
const MAX_FILE_BYTES = 15 * 1024 * 1024; // PDFs legitimately run larger than a typical photo

type Attachment =
  | ({ id: number; kind: "image" } & ImageAttachment & { previewUrl: string })
  | ({ id: number; kind: "document" } & DocumentAttachment);

function fileToAttachment(file: File, id: number): Promise<Attachment | null> {
  const isImage = ACCEPTED_IMAGE_TYPES.includes(file.type);
  const isDocument = ACCEPTED_DOCUMENT_TYPES.includes(file.type);
  if ((!isImage && !isDocument) || file.size > MAX_FILE_BYTES) return Promise.resolve(null);

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const data = dataUrl.slice(dataUrl.indexOf(",") + 1);
      resolve(
        isImage
          ? { id, kind: "image", mediaType: file.type, data, previewUrl: dataUrl }
          : { id, kind: "document", mediaType: file.type, data, filename: file.name },
      );
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export function ChatInput({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (line: string, images?: ImageAttachment[], documents?: DocumentAttachment[]) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const nextAttachmentId = useRef(0);

  async function addFiles(files: FileList | File[]) {
    setAttachError(null);
    const results = await Promise.all([...files].map((f) => fileToAttachment(f, nextAttachmentId.current++)));
    const accepted = results.filter((a): a is Attachment => a !== null);
    if (accepted.length < files.length) {
      setAttachError("Some files were skipped (not an image or PDF, or over 15MB).");
    }
    setAttachments((prev) => [...prev, ...accepted]);
  }

  function removeAttachment(id: number) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  function submit() {
    const el = textareaRef.current;
    const line = el?.value.trim() ?? "";
    if (!line && attachments.length === 0) return;

    const images = attachments.filter((a): a is Extract<Attachment, { kind: "image" }> => a.kind === "image");
    const documents = attachments.filter((a): a is Extract<Attachment, { kind: "document" }> => a.kind === "document");
    onSend(
      line,
      images.length ? images.map(({ mediaType, data }) => ({ mediaType, data })) : undefined,
      documents.length ? documents.map(({ mediaType, data, filename }) => ({ mediaType, data, filename })) : undefined,
    );

    if (el) el.value = "";
    setAttachments([]);
    setAttachError(null);
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((a) =>
            a.kind === "image" ? (
              <div key={a.id} className="relative">
                <img src={a.previewUrl} alt="attachment preview" className="h-16 w-16 rounded-lg border object-cover" />
                <button
                  type="button"
                  onClick={() => removeAttachment(a.id)}
                  className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-foreground text-[10px] text-background"
                  aria-label="Remove attachment"
                >
                  ×
                </button>
              </div>
            ) : (
              <div key={a.id} className="relative flex h-16 w-24 flex-col items-center justify-center gap-1 rounded-lg border px-1">
                <span className="text-lg">📄</span>
                <span className="w-full truncate text-center text-[10px] text-muted-foreground">{a.filename}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(a.id)}
                  className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-foreground text-[10px] text-background"
                  aria-label="Remove attachment"
                >
                  ×
                </button>
              </div>
            ),
          )}
        </div>
      )}
      {attachError && <p className="text-xs text-destructive">{attachError}</p>}

      <div className="flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files);
            e.target.value = ""; // lets picking the same file twice re-fire onChange
          }}
        />
        <Button type="button" variant="outline" size="lg" disabled={disabled} onClick={() => fileInputRef.current?.click()}>
          📎
        </Button>

        {/* field-sizing-content (baked into the Textarea primitive) auto-grows
            the box as you type - no manual scrollHeight measuring needed,
            unlike the Phase 6 vanilla client. */}
        <Textarea
          ref={textareaRef}
          rows={1}
          disabled={disabled}
          placeholder="Type your message or /help… (paste an image, or attach an image/PDF)"
          className="max-h-24 resize-none overflow-y-auto"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.items]
              .filter((item) => item.type.startsWith("image/"))
              .map((item) => item.getAsFile())
              .filter((f): f is File => f !== null);
            if (files.length === 0) return;
            e.preventDefault(); // an image paste shouldn't also insert e.g. its filename as text
            void addFiles(files);
          }}
        />
        <Button type="submit" disabled={disabled} size="lg">
          Send
        </Button>
      </div>
    </form>
  );
}
