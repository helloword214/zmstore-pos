import { SoTCard } from "~/components/ui/SoTCard";

export type SoTRouteLoadingPreviewKind =
  | "dashboard"
  | "operational-list"
  | "generic";

type SoTRouteLoadingPreviewProps = {
  kind?: SoTRouteLoadingPreviewKind;
  className?: string;
};

function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-xl bg-indigo-100/90 ${className}`.trim()}
    />
  );
}

function SkeletonLine({ className = "" }: { className?: string }) {
  return <SkeletonBlock className={`h-3 rounded-full ${className}`.trim()} />;
}

function DashboardPreview() {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SkeletonLine className="w-36" />
        <SkeletonBlock className="h-8 w-20 rounded-full" />
        <SkeletonBlock className="h-8 w-24 rounded-full bg-slate-200/90" />
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.1fr_1.35fr_0.85fr]">
        <SoTCard className="space-y-3 border-indigo-100/80 bg-white/90">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <SkeletonLine className="w-28" />
              <SkeletonLine className="w-40 bg-slate-200/90" />
            </div>
            <SkeletonBlock className="h-7 w-20 rounded-full" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={`dashboard-queue-${index}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3"
              >
                <div className="space-y-2">
                  <SkeletonLine className="w-28" />
                  <SkeletonLine className="w-16 bg-slate-200/90" />
                </div>
                <SkeletonLine className="w-12" />
              </div>
            ))}
          </div>
        </SoTCard>

        <SoTCard className="space-y-3 border-indigo-100/80 bg-white/90">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <SkeletonLine className="w-24" />
              <SkeletonLine className="w-36 bg-slate-200/90" />
            </div>
            <SkeletonBlock className="h-7 w-24 rounded-full" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={`dashboard-signal-${index}`}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"
              >
                <SkeletonLine className="w-16 bg-slate-200/90" />
                <SkeletonLine className="mt-3 w-10" />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <SkeletonBlock className="h-9 w-32 rounded-xl" />
            <SkeletonBlock className="h-9 w-24 rounded-xl bg-slate-200/90" />
            <SkeletonBlock className="h-9 w-28 rounded-xl bg-slate-200/90" />
          </div>
        </SoTCard>

        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <SoTCard
              key={`dashboard-reference-${index}`}
              compact
              className="space-y-2 border-indigo-100/70 bg-white/90"
            >
              <SkeletonLine className="w-20 bg-slate-200/90" />
              <SkeletonLine className="w-10" />
              <SkeletonLine className="w-24 bg-slate-200/90" />
            </SoTCard>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <SoTCard
            key={`dashboard-actions-${index}`}
            compact
            className="space-y-3 border-indigo-100/70 bg-white/90"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <SkeletonLine className="w-24" />
                <SkeletonLine className="w-32 bg-slate-200/90" />
              </div>
              <SkeletonBlock className="h-7 w-16 rounded-full" />
            </div>
            <SkeletonLine className="w-28" />
          </SoTCard>
        ))}
      </div>
    </div>
  );
}

function OperationalListPreview() {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <SkeletonLine className="w-24" />
          <SkeletonLine className="w-40 bg-slate-200/90" />
        </div>
        <SkeletonBlock className="h-9 w-28 rounded-xl" />
      </div>

      <div className="flex flex-wrap gap-2">
        <SkeletonBlock className="h-8 w-16 rounded-full bg-slate-200/90" />
        <SkeletonBlock className="h-8 w-24 rounded-full" />
        <SkeletonBlock className="h-8 w-20 rounded-full bg-slate-200/90" />
        <SkeletonBlock className="h-8 w-20 rounded-full bg-slate-200/90" />
      </div>

      <SoTCard className="space-y-3 border-indigo-100/80 bg-white/90">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SkeletonLine className="w-40 bg-slate-200/90" />
          <div className="flex flex-wrap gap-2">
            <SkeletonBlock className="h-9 w-24 rounded-xl bg-slate-200/90" />
            <SkeletonBlock className="h-9 w-28 rounded-xl" />
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <div className="grid grid-cols-[1.2fr_1fr_0.7fr_1fr_0.9fr] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <SkeletonLine className="w-16 bg-slate-200/90" />
            <SkeletonLine className="w-14 bg-slate-200/90" />
            <SkeletonLine className="w-12 bg-slate-200/90" />
            <SkeletonLine className="w-16 bg-slate-200/90" />
            <SkeletonLine className="w-20 bg-slate-200/90" />
          </div>
          <div className="divide-y divide-slate-100 bg-white">
            {Array.from({ length: 5 }).map((_, index) => (
              <div
                key={`operational-row-${index}`}
                className="grid grid-cols-[1.2fr_1fr_0.7fr_1fr_0.9fr] gap-3 px-4 py-3"
              >
                <div className="space-y-2">
                  <SkeletonLine className="w-28" />
                  <SkeletonLine className="w-16 bg-slate-200/90" />
                </div>
                <div className="space-y-2">
                  <SkeletonLine className="w-20" />
                  <SkeletonLine className="w-24 bg-slate-200/90" />
                </div>
                <SkeletonBlock className="h-7 w-20 rounded-full" />
                <SkeletonLine className="w-24 bg-slate-200/90" />
                <div className="flex items-center justify-between gap-3">
                  <SkeletonLine className="w-20 bg-slate-200/90" />
                  <SkeletonLine className="w-14" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </SoTCard>
    </div>
  );
}

function GenericPreview() {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <SkeletonLine className="w-28" />
        <SkeletonLine className="w-44 bg-slate-200/90" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <SoTCard
            key={`generic-card-${index}`}
            className="space-y-3 border-indigo-100/70 bg-white/90"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <SkeletonLine className="w-24" />
                <SkeletonLine className="w-32 bg-slate-200/90" />
              </div>
              <SkeletonBlock className="h-8 w-20 rounded-full" />
            </div>
            <SkeletonLine className="w-full bg-slate-200/90" />
            <SkeletonLine className="w-4/5 bg-slate-200/90" />
          </SoTCard>
        ))}
      </div>

      <SoTCard className="space-y-3 border-indigo-100/70 bg-white/90">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={`generic-row-${index}`}
            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3"
          >
            <div className="space-y-2">
              <SkeletonLine className="w-32" />
              <SkeletonLine className="w-20 bg-slate-200/90" />
            </div>
            <SkeletonLine className="w-16" />
          </div>
        ))}
      </SoTCard>
    </div>
  );
}

export function SoTRouteLoadingPreview({
  kind = "generic",
  className = "",
}: SoTRouteLoadingPreviewProps) {
  const content =
    kind === "dashboard" ? (
      <DashboardPreview />
    ) : kind === "operational-list" ? (
      <OperationalListPreview />
    ) : (
      <GenericPreview />
    );

  return <div className={className}>{content}</div>;
}
