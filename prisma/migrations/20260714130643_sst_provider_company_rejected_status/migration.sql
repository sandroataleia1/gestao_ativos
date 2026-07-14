-- Sprint Comercial SST 1.4, §15 — adiciona o estado REJECTED a
-- SstProviderCompanyStatus: distinto de REVOKED (vínculo que já foi ACTIVE)
-- e de SUSPENDED (pausa reversível) — REJECTED é uma solicitação PENDING
-- recusada pela empresa sem nunca ter sido autorizada. Nenhuma linha
-- existente muda de valor; só adiciona a opção ao enum.
ALTER TYPE "SstProviderCompanyStatus" ADD VALUE 'REJECTED';
