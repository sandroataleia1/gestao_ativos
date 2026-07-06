-- Índice único parcial: garante no banco que uma AssetUnit nunca tenha mais
-- de uma AssetCustody com status ACTIVE ao mesmo tempo. Complementa (não
-- substitui) a checagem em aplicação em
-- app/api/custodies/deliver/route.ts, fechando a corrida de concorrência
-- entre duas entregas simultâneas da mesma unidade. Prisma não expressa
-- índices parciais (cláusula WHERE) na DSL do schema — por isso esta
-- migration é escrita manualmente e não tem `@@unique`/`@@index`
-- correspondente em schema.prisma.
CREATE UNIQUE INDEX "AssetCustody_active_assetUnit_unique"
ON "AssetCustody" ("assetUnitId")
WHERE "status" = 'ACTIVE' AND "assetUnitId" IS NOT NULL;
