import type { Department, Employee, Position } from "@/app/generated/prisma/client";

export type LookupOption = Pick<Department | Position, "id" | "name">;

export type EmployeeRow = Employee & {
  department: Pick<Department, "id" | "name"> | null;
  position: Pick<Position, "id" | "name"> | null;
};
