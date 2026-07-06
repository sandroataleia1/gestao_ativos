import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton, StatCardsSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";

export default function CustodiesLoading() {
  return (
    <div className="grid gap-6">
      <PageHeaderSkeleton />
      <StatCardsSkeleton count={3} />
      <div className="flex gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-48" />
      </div>
      <TableSkeleton cols={5} />
    </div>
  );
}
