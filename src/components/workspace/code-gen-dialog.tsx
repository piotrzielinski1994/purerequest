import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@pziel/pureui";
import { useState } from "react";
import { toast } from "sonner";
import { CodeEditor } from "@/components/workspace/code-editor";
import { useEditorExtensions } from "@/components/workspace/use-editor-extensions";
import { useWorkspace } from "@/components/workspace/workspace-context";
import {
  CODE_TARGETS,
  type CodeTargetId,
  codeTargetById,
} from "@/lib/codegen/targets";

export function CodeGenDialog() {
  const { isCodeGenOpen, closeCodeGen, resolveActiveWire } = useWorkspace();
  const { viewerExtensions } = useEditorExtensions();
  const [targetId, setTargetId] = useState<CodeTargetId>(CODE_TARGETS[0].id);
  // Reset the language to the default each time the dialog (re)opens, in render
  // not an effect (mirrors curl-import-dialog.tsx).
  const [wasOpen, setWasOpen] = useState(isCodeGenOpen);
  if (isCodeGenOpen !== wasOpen) {
    setWasOpen(isCodeGenOpen);
    if (isCodeGenOpen) {
      setTargetId(CODE_TARGETS[0].id);
    }
  }

  const target = codeTargetById(targetId);
  const wire = isCodeGenOpen ? resolveActiveWire() : null;
  const code = wire ? target.generate(wire) : "";

  const copy = () => {
    navigator.clipboard?.writeText(code);
    toast(`Copied as ${target.label}`);
    closeCodeGen();
  };

  return (
    <Dialog
      open={isCodeGenOpen}
      onOpenChange={(next) => {
        if (!next) {
          closeCodeGen();
        }
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Copy as code</DialogTitle>
          <DialogDescription>
            Generate client code for the active request.
          </DialogDescription>
        </DialogHeader>
        <Select
          value={targetId}
          onValueChange={(next) => setTargetId(next as CodeTargetId)}
        >
          <SelectTrigger
            aria-label="Language"
            className="w-full rounded-none bg-transparent text-xs shadow-none focus-visible:ring-ring dark:bg-transparent"
          >
            {target.label}
          </SelectTrigger>
          <SelectContent position="popper">
            {CODE_TARGETS.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="h-64 overflow-auto ring-1 ring-border">
          <CodeEditor
            value={code}
            editable={false}
            extensions={viewerExtensions}
          />
        </div>
        <DialogFooter>
          <Button type="button" onClick={copy}>
            Copy
          </Button>
          <Button type="button" variant="outline" onClick={closeCodeGen}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
