// Extraído de lib/auth.ts (Sprint SST 1.4D.2) para um módulo próprio, sem
// nenhuma outra dependência — lib/auth.ts é mockado inteiro em vários
// testes (`vi.mock("@/lib/auth", ...)`, ver
// tests/tenant-isolation/platform-admin.test.ts), então qualquer outro
// módulo que precise só desta constante (ex.: lib/mutation-origin.ts) não
// pode importá-la de lá sem quebrar nesses testes.
//
// Mesmo IP de `allowedDevOrigins` em next.config.ts — sem isso, o Better
// Auth rejeita com 403 "Missing or null Origin" qualquer requisição feita a
// partir do dev server acessado pelo IP da rede local (ex.: testando no
// celular), já que só confia por padrão na origem derivada de
// BETTER_AUTH_URL (http://localhost:3010). Ajuste/adicione o IP aqui junto
// com next.config.ts se ele mudar (DHCP).
export const DEV_LAN_ORIGINS = ["http://192.168.1.239:3010"];
