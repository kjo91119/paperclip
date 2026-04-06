import { DollarSign } from "lucide-react";

export function BudgetSidebarMarker({ title = "예산으로 일시중지됨" }: { title?: string }) {
  return (
    <span
      title={title}
      aria-label={title}
      className="ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500/90 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
    >
      <DollarSign className="h-3 w-3" />
    </span>
  );
}
