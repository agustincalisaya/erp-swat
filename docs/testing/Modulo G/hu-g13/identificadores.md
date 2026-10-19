# Identificador fijo HU-G13

El permiso `tesoreria:gestionar_gastos` usa el UUID `b187ec7f-0b6c-48e8-954d-9f5411d9d648`, generado una sola vez el 18/10/2026 con `crypto.randomUUID()`. No apareció entre los IDs del checkout antes de agregarlo. `prisma/seed.ts` lo conserva como constante y lo asigna al rol existente `TESORERO_CENTRAL`; el usuario `tesorero.seed` ya pertenece a ese rol.

En la base local descartable `hu_g13` (PostgreSQL 16, `127.0.0.1:55437`), dos ejecuciones completas del seed conservaron el mismo UUID, un permiso con ese código, una relación de rol, las cinco categorías de HU-G12 y un usuario `tesorero.seed`.
