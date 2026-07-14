-- Sprint Comercial SST 1.4, §8 — unicidade canônica de documento de empresa.
-- `documentType`/`documentNormalized` continuam NULLABLE (não viram NOT
-- NULL nesta migration): 1 empresa (dado possivelmente real, CNPJ com
-- dígito verificador inválido) ainda não tem os campos preenchidos e não
-- deve receber um valor inventado — ver scripts/backfill-company-documents.ts
-- e o relatório de entrega da sprint. Índice único do Postgres permite
-- múltiplos NULLs, então essa empresa não bloqueia nem conflita com as
-- demais enquanto aguarda correção manual.
--
-- Confirmado antes de aplicar (ver relatório de entrega):
--   - 0 duplicatas em `documentNormalized` entre as 20 empresas já migradas.
--   - A 21ª empresa ("Alves Shopping da construção LTDA") tem
--     documentType/documentNormalized NULL — não participa da unicidade.
--   - Backup fora do repositório tirado antes de aplicar em produção.

-- CreateIndex
CREATE UNIQUE INDEX "Company_documentType_documentNormalized_key" ON "Company"("documentType", "documentNormalized");
