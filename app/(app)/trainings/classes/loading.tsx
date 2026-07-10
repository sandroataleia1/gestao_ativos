import { PageHeaderSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";

export default function TrainingClassesLoading() {
  return (
    <div className="grid gap-6">
      <PageHeaderSkeleton />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="h-24 animate-pulse rounded-xl border bg-muted/40" />
        <div className="h-24 animate-pulse rounded-xl border bg-muted/40" />
        <div className="h-24 animate-pulse rounded-xl border bg-muted/40" />
        <div className="h-24 animate-pulse rounded-xl border bg-muted/40" />
      </div>
      <TableSkeleton cols={6} />
    </div>
  );
}
