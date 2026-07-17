import type { Department, Employee, Position, TrainingParticipant } from "@/app/generated/prisma/client";

export type ParticipantRow = TrainingParticipant & {
  employee: Pick<Employee, "id" | "name" | "document" | "registration" | "status"> & {
    department: Pick<Department, "id" | "name"> | null;
    position: Pick<Position, "id" | "name"> | null;
  };
};

// Sprint SST 1.4G — vem de GET .../eligible-employees (paginado/com busca
// server-side), não mais de um `findMany` carregando todos os ACTIVE de
// uma vez. `participantId`/`enrollmentStatus` indicam se o colaborador já
// tem inscrição nesta turma (null = nunca inscrito; CANCELLED = pode
// reativar; ENROLLED = já inscrito).
export type EmployeeOption = Pick<Employee, "id" | "name" | "document" | "registration"> & {
  department: Pick<Department, "id" | "name"> | null;
  position: Pick<Position, "id" | "name"> | null;
  participantId: string | null;
  enrollmentStatus: "ENROLLED" | "CANCELLED" | null;
};
