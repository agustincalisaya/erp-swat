# HU-G12 — evidencia local (18/10/2026)

## Alcance y entorno

- Implementación del CRUD en el servicio de Tesorería, rutas `/api/tesoreria/categorias-gasto`, Server Actions, pantalla y menú; eventos consumidos por D.3.
- Seed aditivo en commit `82679a6` (`seed: agregar permiso y categorias iniciales HU-G12`). Mapeo estable en [identificadores.md](./identificadores.md).
- PostgreSQL 16 en contenedor local descartable `hu_g12_disposable_pg`, puerto `127.0.0.1:55436`. Base `hu_g12` para seed/pruebas; base `hu_g12_migraciones` para aplicar las migraciones existentes. No se usó ninguna base compartida o productiva.
- En `hu_g12_migraciones`, `prisma migrate dev --skip-generate` aplicó `20261014052506_hu_g12_g13_gastos_operativos`. `_prisma_migrations.finished_at` está presente y existe el índice `categorias_gasto_nombre_normalizado_key`. No se generó migración nueva.

## Seed e identificadores

`prisma db seed` ejecutado dos veces contra `hu_g12`. Ambas consultas posteriores devolvieron exactamente cinco categorías iniciales, un permiso `tesoreria:gestionar_categorias_gasto` y una sola asignación al Administrador, con los mismos UUID. El seed deja intactas las ediciones posteriores de las categorías.

## Unitario y servicio/BD

- `node --conditions=react-server --import tsx --test src/lib/services/tesoreria/categoria-gasto.service.test.ts`: 4/4. Cubre normalización, motivo recortado, vaciado de descripción, body de edición y detección de `P2002`.
- `node --conditions=react-server --import tsx --test src/lib/services/tesoreria/categoria-gasto.integration.test.ts` con `DATABASE_URL` de `hu_g12`: 1/1. Cubre no-op sin asiento, edición con descripción vaciada, carrera de nombres equivalentes, rechazo de edición inactiva, baja con gasto activo asociado, reserva del nombre tras la baja y tres asientos (`CREATE`, `UPDATE`, `DELETE_LOGICO`).
- La consulta de `gastos_operativos` devolvió una fila asociada a la categoría de prueba ya inactiva; el gasto seguía activo y referenciaba el mismo `categoria_gasto_id`.
- Cada asiento de `categorias_gasto` consultado tenía `hash_anterior` y `hash_actual`. `verificarCadenaIntegridad()` devolvió `integra: true` en la prueba de integración. Se usó el servicio del proyecto para verificar la cadena.
- `npx tsc --noEmit --incremental`, ESLint acotado a los archivos de HU-G12 y `npm run build` finalizaron sin errores. La verificación de integridad se repitió después de las pruebas HTTP y del alta desde el formulario.

Muestra de [consultas.sql](./consultas.sql) para la categoría de integración `2d4aa909-ed65-46a6-bab8-69fadf87f76d` en la base descartable:

```text
categorias_gasto: is_active=false; deleted_at presente; deleted_by presente; deletion_reason="Motivo de prueba"
gastos_operativos: categoria_gasto_id=2d4aa909-ed65-46a6-bab8-69fadf87f76d; COUNT(*)=1
audit_logs: CREATE, UPDATE, DELETE_LOGICO; hash_anterior/hash_actual presentes en los tres
```

## HTTP y RBAC

`node "docs/testing/Modulo G/hu-g12/http-check.mjs"` pasó contra Next 16 en `localhost:3006` con la base `hu_g12`:

| Caso | Resultado |
|---|---|
| Sin sesión, GET | `401 UNAUTHORIZED` |
| `tesorero.seed`, gestión G12 | `403 FORBIDDEN` |
| `administrador.seed`, alta | `201`; nombre recortado |
| Duplicado por mayúsculas/espacios | `409 CATEGORIA_GASTO_DUPLICADA` |
| Edición idéntica / vaciar descripción | `200`; descripción persistida como `null` |
| Motivo de baja corto | `400 VALIDATION_ERROR` |
| Baja / segunda baja / edición de inactiva | `200` / `409` / `409` |
| Listado normal / con `incluir_inactivas=1` | Excluye / incluye la baja |
| Selector `?selector=1` del Tesorero | `200`; solo activas |

La redirección de la RSC para el Tesorero contiene `/no-autorizado` en el flujo de Next, sin serializar datos de categorías. En esta versión de Next la respuesta HTML inicial puede ser HTTP 200 por streaming aunque la navegación termine en `/no-autorizado`.

El seed actual no incluye el permiso G13 `tesoreria:gestionar_gastos`. Para comprobar su gate sin ampliar el seed de HU-G12, se insertó ese permiso y su relación con `TESORERO_CENTRAL` **únicamente en `hu_g12`**, como fixture local descartable. No se creó ningún usuario ni rol. La existencia del permiso G13 en un despliegue real corresponde a HU-G13.

## Capturas

- [Listado de activas](./listado-activas.png)
- [Filtro con inactivas](./listado-con-inactivas.png)
- [Formulario de alta](./formulario-alta.png)

Las capturas se produjeron con [capturas.mjs](./capturas.mjs) en Chrome local de pruebas, con sesión del Administrador seed.
El mismo script completó un alta real desde el formulario mediante su Server Action y esperó a que apareciera en el listado.

## Límite del bus

Los eventos se emiten después del COMMIT y D.3 agrega los asientos en una operación posterior del proceso. La escritura de la categoría y la del asiento no son atómicas. El listener registra en servidor un fallo de auditoría; el cliente no recibe una garantía de persistencia del asiento en la misma respuesta HTTP. La prueba de integración espera y constata los asientos y verifica la integridad SHA-256.
