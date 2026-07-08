"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";

/**
 * App-shell error boundary. Renders inside the authenticated shell whenever a
 * page or its data throws, so operators get a calm, branded recovery point
 * instead of Next's unstyled default. Raw error internals stay in the console
 * (developer-facing), never on screen (DESIGN_SYSTEM.md — error states are
 * part of the feature).
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <EmptyState
        icon={<AlertTriangle className="h-6 w-6" />}
        title="Something went wrong"
        description="This page ran into an unexpected error. Your data is safe — try again, and if it keeps happening, contact AeroOps support."
        action={<Button onClick={() => reset()}>Try again</Button>}
      />
    </div>
  );
}
