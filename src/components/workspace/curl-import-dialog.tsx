import { Button } from "@pziel/pureui";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWorkspace } from "@/components/workspace/workspace-context";

export function CurlImportDialog() {
  const { isCurlImportOpen, closeCurlImport, importCurl } = useWorkspace();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Reset the draft + error each time the dialog (re)opens, in render not an
  // effect (the project avoids setState-in-effect; mirrors the config editors).
  const [wasOpen, setWasOpen] = useState(isCurlImportOpen);
  if (isCurlImportOpen !== wasOpen) {
    setWasOpen(isCurlImportOpen);
    if (isCurlImportOpen) {
      setText("");
      setError(null);
    }
  }

  const submit = () => {
    const result = importCurl(text);
    if (!result.ok) {
      setError(result.error);
    }
  };

  return (
    <Dialog
      open={isCurlImportOpen}
      onOpenChange={(next) => {
        if (!next) {
          closeCurlImport();
        }
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Import cURL</DialogTitle>
          <DialogDescription>
            Paste a curl command to create a new request.
          </DialogDescription>
        </DialogHeader>
        <textarea
          aria-label="curl command"
          value={text}
          spellCheck={false}
          autoFocus
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
          className="h-40 w-full resize-none bg-transparent p-2 font-mono text-xs shadow-none outline-none ring-1 ring-border focus-visible:ring-ring"
        />
        {error !== null && (
          <p className="font-mono text-xs text-destructive">{error}</p>
        )}
        <DialogFooter>
          <Button type="button" disabled={text.trim() === ""} onClick={submit}>
            Import
          </Button>
          <Button type="button" variant="outline" onClick={closeCurlImport}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
