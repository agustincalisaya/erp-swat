import { NextResponse } from "next/server";
import { CalcularPromedioMovilSchema } from "@/lib/schemas/inventario.schema";
import { calcularPromedioMovilEgresos } from "@/lib/services/inventario/stock.service";

/**
 * `POST /api/inventario/stock/umbrales/sugerencia` (spec 5.2).
 * Solo lectura: no muta `StockDeposito`, devuelve una sugerencia de umbrales.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { data: null, error: { code: "VALIDATION_ERROR", message: "JSON inválido" } },
      { status: 400 },
    );
  }

  const parsed = CalcularPromedioMovilSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Datos inválidos",
        },
      },
      { status: 400 },
    );
  }

  const resultado = await calcularPromedioMovilEgresos(parsed.data);

  return NextResponse.json({ data: resultado, error: null }, { status: 200 });
}
