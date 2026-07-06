import { PageHeaderSkeleton, TableSkeleton } from "@/components/layout/page-skeletons";

export default function EmployeesLoading() {
  return (
    <div className="grid gap-6">
      <PageHeaderSkeleton />
      <TableSkeleton cols={5} />
    </div>
  );
}
