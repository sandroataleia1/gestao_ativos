import type { Department, Employee, Position, TrainingParticipant } from "@/app/generated/prisma/client";

export type ParticipantRow = TrainingParticipant & {
  employee: Pick<Employee, "id" | "name" | "document" | "registration"> & {
    department: Pick<Department, "id" | "name"> | null;
    position: Pick<Position, "id" | "name"> | null;
  };
};

export type EmployeeOption = Pick<Employee, "id" | "name" | "document" | "registration">;
