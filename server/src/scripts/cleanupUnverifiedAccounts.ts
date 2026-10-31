import { AuthService } from '../modules/auth/auth.service.js';

async function main() {
  const args = process.argv.slice(2);
  const daysIdx = args.indexOf('--days');
  const days = daysIdx !== -1 && args[daysIdx + 1] ? Number(args[daysIdx + 1]) : 7;

  console.log(`🧹 Iniciando limpieza de cuentas no verificadas de más de ${days} días...`);
  const deleted = await AuthService.cleanupUnverifiedAccounts(days);
  console.log(`✅ Limpieza completada. Cuentas eliminadas: ${deleted}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Error ejecutando limpieza de cuentas:', err);
  process.exit(1);
});

