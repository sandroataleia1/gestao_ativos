import { PageHeaderSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";

export default function TrainingsLoading() {
  return (
    <div className="grid gap-6">
      <PageHeaderSkeleton />
      <TableSkeleton cols={6} />
    </div>
  );
}
