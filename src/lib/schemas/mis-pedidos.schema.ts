import { z } from "zod";

const enteroQuery = (max?: number) =>
  z.preprocess(
    (value) => {
      if (typeof value === "number") return value;
      if (typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)) return Number(value);
      return value;
    },
    z.number().int().safe().min(1).pipe(max === undefined ? z.number() : z.number().max(max)),
  );

export const MisPedidosQuerySchema = z
  .object({
    page: enteroQuery().default(1),
    page_size: enteroQuery(50).default(20),
  })
  .strict();
export type MisPedidosQuery = z.infer<typeof MisPedidosQuerySchema>;

export const PedidoWebIdSchema = z.string().uuid("El identificador del pedido debe ser un UUID válido");
