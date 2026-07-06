import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Permite acessar o dev server pela rede local (ex: celular/outro
  // computador testando via IP) sem bloquear o carregamento dos assets do
  // Next.js. Ajuste/adicione o IP se ele mudar (DHCP).
  allowedDevOrigins: ["192.168.1.239"],
  // Habilita as funções forbidden()/unauthorized() (next/navigation) e os
  // arquivos especiais app/forbidden.tsx / app/unauthorized.tsx.
  experimental: {
    authInterrupts: true,
  },
};

export default nextConfig;
