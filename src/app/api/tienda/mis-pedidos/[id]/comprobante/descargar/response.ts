import { NextResponse } from "next/server";

export function respuestaComprobantePdf(pdf: Uint8Array, numero: string): NextResponse {
  const numeroSeguro = numero.replace(/[^A-Za-z0-9-]/g, "-");
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="comprobante-${numeroSeguro}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
