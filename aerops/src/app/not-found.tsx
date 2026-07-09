import Link from "next/link";
import { Compass } from "lucide-react";
import { AeroOpsLogo } from "@/components/brand/logo";
import { EmptyState } from "@/components/ui/misc";

/**
 * Root 404. Renders outside the app shell for arbitrary unmatched routes, so it
 * is fully self-contained and branded — it must read as AeroOps in light and
 * dark without depending on any layout chrome.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background p-6">
      <AeroOpsLogo />
      <EmptyState
        icon={<Compass className="h-6 w-6" />}
        title="Page not found"
        description="We couldn't find the page you were looking for. It may have moved, or the link may be out of date."
        action={
          <Link
            href="/"
            className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            Back to home
          </Link>
        }
      />
    </div>
  );
}
