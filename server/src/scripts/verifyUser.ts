import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { computeCanonicalEmail } from '../modules/auth/auth.service.js';

async function main() {
  const args = process.argv.slice(2);
  const emailIdx = args.indexOf('--email');
  if (emailIdx === -1 || !args[emailIdx + 1]) {
    console.error('❌ Uso requerido: npm --prefix server run verify-user -- --email <correo@ejemplo.com>');
    process.exit(1);
  }

  const rawEmail = args[emailIdx + 1].trim().toLowerCase();
  const canonical = computeCanonicalEmail(rawEmail);

  console.log(`🔍 Buscando usuario: ${rawEmail} (canónico: ${canonical})...`);

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.canonicalEmail, canonical))
    .limit(1);

  if (!user) {
    console.error(`❌ No se encontró ningún usuario con el correo: ${rawEmail}`);
    process.exit(1);
  }

  if (user.emailVerifiedAt) {
    console.log(`ℹ️ El usuario ${user.email} ya estaba verificado el ${user.emailVerifiedAt.toISOString()}.`);
    process.exit(0);
  }

  await db
    .update(users)
    .set({
      emailVerifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  console.log(`✅ ¡Usuario ${user.email} (ID: ${user.id}) verificado exitosamente!`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Error ejecutando verify-user:', err);
  process.exit(1);
});

