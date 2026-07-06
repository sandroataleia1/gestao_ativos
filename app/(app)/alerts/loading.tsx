import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton, StatCardsSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";

export default function AlertsLoading() {
  return (
    <div className="grid gap-6">
      <PageHeaderSkeleton />
      <StatCardsSkeleton count={3} />
      <Skeleton className="h-8 w-64" />
      <TableSkeleton cols={4} />
    </div>
  );
}
