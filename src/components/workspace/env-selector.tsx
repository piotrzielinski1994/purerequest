import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@pziel/pureui";
import { useWorkspace } from "@/components/workspace/workspace-context";

const NO_ENVIRONMENT = "__none__";

export function EnvSelector() {
  const { environmentNames, activeEnvironment, setActiveEnvironment } =
    useWorkspace();

  return (
    <Select
      value={activeEnvironment ?? NO_ENVIRONMENT}
      onValueChange={(value) =>
        setActiveEnvironment(value === NO_ENVIRONMENT ? null : value)
      }
    >
      <SelectTrigger
        aria-label="Environment"
        className="h-full gap-2 rounded-none border-0 border-l border-l-border bg-transparent px-3 text-xs shadow-none hover:bg-accent focus-visible:ring-0 dark:bg-transparent dark:hover:bg-accent"
      >
        {activeEnvironment ?? "No Environment"}
      </SelectTrigger>
      <SelectContent position="popper" align="end">
        <SelectItem value={NO_ENVIRONMENT}>No Environment</SelectItem>
        {environmentNames.map((name) => (
          <SelectItem key={name} value={name}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
