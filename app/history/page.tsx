import { TabShell } from "@/components/tab-shell";
import { InitialFeed, FeedSkeleton } from "@/components/initial-feed";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default function Page(){
  return (
    <Suspense fallback={<div className="p-6 text-sm opacity-70">Loading…</div>}>
      <TabShell>
        <Suspense fallback={<FeedSkeleton />}><InitialFeed section="history" /></Suspense>
      </TabShell>
    </Suspense>
  );
}
