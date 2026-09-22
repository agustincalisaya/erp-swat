-- HU-H2: widen `variacion_porcentual_maxima` from Decimal(5,2) (max 999.99)
-- to Decimal(14,2). The worst case allowed by `ListaPrecioItem.precio_unitario`
-- (Decimal(10,2)) is 0.01 -> 99,999,999.99 = +999,999,999,800%, i.e. 12
-- integer digits. Widening a numeric column is non-destructive: every
-- existing value fits unchanged.
ALTER TABLE "listas_precio_version" ALTER COLUMN "variacion_porcentual_maxima" SET DATA TYPE DECIMAL(14,2);
