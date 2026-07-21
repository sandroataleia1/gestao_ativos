// Formatos cujo container suporta canal alfa — logo em PNG com fundo
// transparente (configurações da empresa) é o caso real; se reexportado
// sempre como JPEG (sem alfa), a área transparente vira preta (o canvas
// começa com rgba(0,0,0,0), e o encoder JPEG descarta o alfa mantendo só o
// RGB preto). Fotos de entrega/devolução (câmera, sempre opacas) continuam
// indo para JPEG, que comprime bem melhor para foto.
const ALPHA_CAPABLE_TYPES = new Set(["image/png", "image/webp", "image/gif"]);

// Comprime/redimensiona uma imagem no browser antes de mandar pro servidor —
// tanto fotos de entrega/devolução quanto a logo da empresa são guardadas
// como data URL direto no banco (mesmo padrão de
// CustodySignature.signatureData), então um arquivo sem compressão (vários
// MB) explodiria o tamanho do registro. Redimensiona para no máximo
// `maxDimension` no lado maior; reexporta como PNG (preserva transparência)
// quando o formato de origem suporta alfa, senão como JPEG com a `quality`
// informada (ignorada para PNG, que é sempre sem perdas).
export async function compressImageFile(
  file: File,
  maxDimension = 1280,
  quality = 0.7,
): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível processar a imagem.");
  ctx.drawImage(bitmap, 0, 0, width, height);

  if (ALPHA_CAPABLE_TYPES.has(file.type)) {
    return canvas.toDataURL("image/png");
  }
  return canvas.toDataURL("image/jpeg", quality);
}
