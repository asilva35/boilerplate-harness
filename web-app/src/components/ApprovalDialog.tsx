import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { truncate } from "@/lib/protocol";
import type { PendingApproval } from "@/hooks/useHarnessSocket";

// Diff lines are rendered as siblings of AlertDialogDescription, not
// inside it — Radix's Description renders a <p>, and a <p> can't legally
// contain the <div>s a multi-line, colored diff needs.
function DiffLine({ line }: { line: string }) {
  const color =
    line.startsWith("+") && !line.startsWith("+++")
      ? "text-green-600 dark:text-green-400"
      : line.startsWith("-") && !line.startsWith("---")
        ? "text-red-600 dark:text-red-400"
        : "text-muted-foreground";
  return <div className={color}>{line || " "}</div>;
}

export function ApprovalDialog({
  pending,
  onRespond,
}: {
  pending: PendingApproval | null;
  onRespond: (approved: boolean) => void;
}) {
  const diff = pending?.diff;

  return (
    <AlertDialog open={pending !== null}>
      <AlertDialogContent className={diff ? "sm:max-w-lg" : undefined}>
        <AlertDialogHeader>
          <AlertDialogTitle>Approve tool call?</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            <span className="font-mono">{pending?.name}</span>{" "}
            {pending && !diff ? truncate(pending.input, 160) : "Review the change below."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {diff && (
          <div className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-xs">
            {diff
              .split("\n")
              .map((line, i) => <DiffLine key={i} line={line} />)}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onRespond(false)}>No</AlertDialogCancel>
          <AlertDialogAction onClick={() => onRespond(true)}>Yes</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
