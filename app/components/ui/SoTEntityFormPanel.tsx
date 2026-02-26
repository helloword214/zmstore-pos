import type { ReactNode } from "react";
import { SoTCard } from "~/components/ui/SoTCard";
import { SoTSectionHeader } from "~/components/ui/SoTSectionHeader";

type SoTEntityFormPanelProps = {
  title: string;
  children: ReactNode;
};

export function SoTEntityFormPanel({ title, children }: SoTEntityFormPanelProps) {
  return (
    <SoTCard interaction="form">
      <SoTSectionHeader title={title} />
      {children}
    </SoTCard>
  );
}
