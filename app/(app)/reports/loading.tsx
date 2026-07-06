import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";

export default function ReportsLoading() {
  return (
    <div className="grid gap-6">
      <PageHeaderSkeleton />
      <div className="flex gap-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-32" />
      </div>
      <TableSkeleton cols={6} />
    </div>
  );
}
