import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// CSP sem nonce (abordagem "Without Nonces" da própria doc do Next —
// node_modules/next/dist/docs/.../content-security-policy.md). Um CSP com
// nonce exigiria forçar renderização dinâmica em todas as páginas
// (desliga otimização estática/ISR), o que é uma mudança de estratégia de
// renderização maior do que cabe numa sprint só de hardening — fica
// registrado como melhoria futura se um CSP mais estrito for exigido.
// `unsafe-inline` em script-src é necessário porque o `next-themes`
// (components/theme-provider.tsx) injeta um pequeno script inline para
// aplicar o tema antes da hidratação (evita flash de tema errado); em
// style-src é necessário pelos estilos inline que Next/Base UI aplicam em
// popovers/diálogos posicionados dinamicamente.
const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""};
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  font-src 'self';
  connect-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
`
  .replace(/\s{2,}/g, " ")
  .trim();

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
  // Gera `.next/standalone` (server.js mínimo + só os arquivos de
  // node_modules realmente usados, rastreados a partir do código) — é o
  // formato recomendado pelo próprio Next para imagens Docker enxutas (ver
  // node_modules/next/dist/docs/.../output.md). O Dockerfile copia esse
  // diretório em vez de `node_modules` inteiro.
  output: "standalone",
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Cross-Site Scripting/injeção: restringe de onde scripts,
          // estilos, imagens etc. podem ser carregados.
          { key: "Content-Security-Policy", value: cspHeader },
          // Clickjacking: impede que a aplicação seja carregada dentro de
          // um <iframe> em outro site (equivalente legado ao
          // frame-ancestors do CSP acima, para navegadores mais antigos).
          { key: "X-Frame-Options", value: "DENY" },
          // Impede que o navegador tente "adivinhar" (sniff) um
          // Content-Type diferente do declarado pelo servidor — evita que
          // um upload disfarçado seja interpretado como HTML/script.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Não vaza a URL completa (com tokens públicos de QR/assinatura
          // na query, por exemplo) para sites de terceiros referenciados a
          // partir daqui; ainda envia a origem em navegação cross-origin.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Desliga acesso a APIs sensíveis do navegador que a aplicação
          // não usa (sem scanner de câmera embutido, sem geolocalização
          // etc. — confirmado por busca no código por getUserMedia/
          // geolocation).
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          // Força HTTPS por 2 anos incluindo subdomínios; só tem efeito em
          // respostas servidas via HTTPS (produção, atrás de nginx/certbot
          // — em dev via http:// o navegador ignora este header).
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // Sem isso, o nginx faz buffer da resposta inteira antes de
          // enviar pro client — quebra o streaming/Suspense (ver
          // app/(app)/dashboard/page.tsx) tornando-o efetivamente síncrono.
          // Recomendação oficial do próprio Next para self-hosting atrás de
          // nginx (node_modules/next/dist/docs/.../self-hosting.md, seção
          // "Streaming and Suspense").
          { key: "X-Accel-Buffering", value: "no" },
        ],
      },
    ];
  },
};

export default nextConfig;
