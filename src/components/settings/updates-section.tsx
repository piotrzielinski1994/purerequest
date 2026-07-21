import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { showUpdateToast } from "@/lib/updater/show-update-toast";
import type { UpdateController } from "@/lib/updater/update-controller";

export function UpdatesSection({
  controller,
  getVersion,
}: {
  controller: UpdateController;
  getVersion: () => Promise<string>;
}) {
  const [version, setVersion] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => {
    let active = true;
    getVersion().then((v) => {
      if (active) {
        setVersion(v);
      }
    });
    return () => {
      active = false;
    };
  }, [getVersion]);

  const check = () => {
    if (isChecking) {
      return;
    }
    setIsChecking(true);
    controller
      .check()
      .then((update) => {
        if (update === null) {
          toast("You're on the latest version");
          return;
        }
        showUpdateToast(update);
      })
      .catch(() => toast("Update check failed"))
      .finally(() => setIsChecking(false));
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Updates</h2>
      <p className="text-sm text-muted-foreground">
        Current version: {version ?? "…"}
      </p>
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={isChecking}
          onClick={check}
        >
          {isChecking ? "Checking…" : "Check for updates"}
        </Button>
      </div>
    </section>
  );
}
