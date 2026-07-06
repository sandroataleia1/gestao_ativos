import { PageHeaderSkeleton, StatCardsSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";

export default function StockLoading() {
  return (
    <div className="grid gap-6">
      <PageHeaderSkeleton />
      <StatCardsSkeleton />
      <TableSkeleton cols={6} />
    </div>
  );
}
