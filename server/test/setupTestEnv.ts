// Configurar variables de entorno aisladas en memoria ANTES de cualquier import de src/config/env.ts.
// Al importarse primero vía ESM, este módulo se evalúa antes que env.ts.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test_jwt_secret_super_seguro_de_al_menos_32_caracteres_2026';
process.env.REFRESH_SECRET =
  process.env.REFRESH_SECRET || 'test_refresh_secret_super_seguro_min_32_caracteres_2026';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://offline:offline@localhost:5432/offline_test';
process.env.VERIFICATION_CODE_PEPPER =
  process.env.VERIFICATION_CODE_PEPPER || 'test_pepper_secret_super_seguro_min_16_caracteres';
