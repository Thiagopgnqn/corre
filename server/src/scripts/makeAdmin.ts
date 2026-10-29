import { eq } from 'drizzle-orm';
import { db, pool } from '../db/index.js';
import { users } from '../db/schema.js';

async function makeAdmin() {
  const args = process.argv.slice(2);
  let emailArg = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && args[i + 1]) {
      emailArg = args[i + 1].trim().toLowerCase();
      break;
    }
  }

  if (!emailArg) {
    console.error('❌ Uso incorrecto. Debe especificar el email del usuario:');
    console.error('   npm run make-admin -- --email usuario@ejemplo.com');
    process.exit(1);
  }

  console.log(`🔍 Buscando usuario con email: ${emailArg}...`);

  try {
    const [user] = await db
      .select({ id: users.id, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.email, emailArg))
      .limit(1);

    if (!user) {
      console.error(`❌ No se encontró ningún usuario con el email: ${emailArg}`);
      console.error('   Asegúrese de que el usuario se haya registrado primero en la aplicación.');
      process.exit(1);
    }

    if (user.role === 'admin') {
      console.log(`ℹ️ El usuario ${user.email} ya posee el rol de 'admin'.`);
      process.exit(0);
    }

    await db
      .update(users)
      .set({ role: 'admin', updatedAt: new Date() })
      .where(eq(users.id, user.id));

    console.log(`🎉 ¡Éxito! El usuario ${user.email} (ID: ${user.id}) ahora es 'admin'.`);
  } catch (error) {
    console.error('❌ Error al actualizar el rol del usuario:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

makeAdmin();

