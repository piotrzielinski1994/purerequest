import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { UpdateController } from "@/lib/updater/update-controller";
import { showUpdateToast } from "@/lib/updater/show-update-toast";

export function UpdatesSection({
  controller,
  getVersion,
}: {
  controller: UpdateController;
  getVersion: () => Promise<string>;
}) {
  const { show } = useToast();
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
          show("You're on the latest version");
          return;
        }
        showUpdateToast(show, update);
      })
      .catch(() => show("Update check failed"))
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
