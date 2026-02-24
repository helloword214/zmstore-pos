import * as React from "react";

type Tone = "default" | "success" | "danger";

type SnapshotStatCardProps = {
  title: string;
  value: React.ReactNode;
  description: React.ReactNode;
  tone?: Tone;
  compact?: boolean;
};

function toneClasses(tone: Tone) {
  if (tone === "success") {
    return {
      card: "border-emerald-200 bg-emerald-50",
      title: "text-emerald-700",
      value: "text-slate-900",
      desc: "text-emerald-900/80",
    };
  }

  if (tone === "danger") {
    return {
      card: "border-rose-200 bg-rose-50",
      title: "text-rose-700",
      value: "text-rose-700",
      desc: "text-rose-900/80",
    };
  }

  return {
    card: "border-slate-200 bg-white",
    title: "text-slate-600",
    value: "text-slate-900",
    desc: "text-slate-500",
  };
}

export function SnapshotStatCard({
  title,
  value,
  description,
  tone = "default",
  compact = false,
}: SnapshotStatCardProps) {
  const t = toneClasses(tone);
  const pad = compact ? "p-3" : "p-4";
  const spacing = compact ? "mt-1" : "mt-2";

  return (
    <div className={`rounded-2xl border ${t.card} ${pad} shadow-sm`}>
      <div className={`text-xs font-semibold uppercase tracking-wide ${t.title}`}>
        {title}
      </div>
      <div className={`${spacing} text-sm font-semibold ${t.value}`}>{value}</div>
      <p className={`${spacing} text-xs ${t.desc}`}>{description}</p>
    </div>
  );
}
