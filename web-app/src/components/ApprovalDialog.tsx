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

export function ApprovalDialog({
  pending,
  onRespond,
}: {
  pending: PendingApproval | null;
  onRespond: (approved: boolean) => void;
}) {
  return (
    <AlertDialog open={pending !== null}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Approve tool call?</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            <span className="font-mono">{pending?.name}</span>{" "}
            {pending ? truncate(pending.input, 160) : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onRespond(false)}>No</AlertDialogCancel>
          <AlertDialogAction onClick={() => onRespond(true)}>Yes</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
