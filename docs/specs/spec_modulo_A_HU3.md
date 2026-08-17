# Especificación Técnica — Módulo A (Inventario y Depósito)

## ERP SWAT Indumentarias — Sprint 1

**Historia de Usuario:** HU-A3 - Transición a estado «En Prueba» (Cifrado AES-256)
**Metodología:** Specification-Driven Development (SDD)
**Stack:** Next.js 14+ (App Router) · Node.js · PostgreSQL 16 · Prisma ORM · Zod
**Referencias normativas:** `RULES.md` (Reglas N.° 1, 2 y 3) · `schema.prisma`

**IMPORTANTE PARA LA IA:** Antes de proponer o escribir cualquier código, lee y aplica rigurosamente las restricciones arquitectónicas definidas en el archivo `RULES.md` de la raíz del proyecto.

---

## 1. Visión General

Esta especificación aborda la HU-A3, responsable de registrar la transición de una unidad de stock al estado `EN_PRUEBA`, vinculándola a la identidad de un efectivo institucional receptor mediante la entidad `LegajoPrueba`.

Dado que el sistema maneja información de Fuerzas de Seguridad, este desarrollo está atravesado por la **Regla N.° 2 de RULES.md (Ley N.° 25.326)**: los datos identificatorios del efectivo deben cifrarse obligatoriamente en reposo mediante AES-256.

Bajo la arquitectura del proyecto, la operación se expone vía Server Actions/Route Handlers y delega la orquestación a la capa de servicios (`lib/services/inventario/legajo-prueba.service.ts`), apoyándose en un módulo criptográfico dedicado (`lib/crypto/aes.service.ts`) para aislar el manejo de llaves. Toda la operación de cambio de estado e inserción debe ser estrictamente atómica (`prisma.$transaction`).

---

## 2. Interfaces y Contratos (Route Handlers / Server Actions)

### 2.1. Iniciar Transición a "En Prueba"

**Ruta:** `POST /app/api/inventario/legajos-prueba/route.ts`
**Server Action equivalente:** `asignarStockEnPrueba()` en `app/(dashboard)/inventario/legajos-prueba/actions.ts`

```typescript
// lib/schemas/inventario.schema.ts
import { z } from "zod";

export const IniciarLegajoPruebaSchema = z.object({
  variante_sku_id: z.string().uuid(),
  deposito_origen_id: z.string().uuid(),
  cantidad: z.number().int().positive().default(1), // Generalmente 1 para pruebas de tallaje
  efectivo_placa: z.string().min(1, "La placa/credencial es obligatoria"),
  efectivo_organismo: z
    .string()
    .min(1, "El organismo de pertenencia es obligatorio"),
});

export type IniciarLegajoPruebaInput = z.infer<
  typeof IniciarLegajoPruebaSchema
>;
```
