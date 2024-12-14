import { clientDB } from './db';
import migrations from './migrations.json';

//prevent multiple schema migrations to be run
let isLocalDBSchemaSynced = false;

export const migrate = async (skipMultiRun = false) => {
  if (isLocalDBSchemaSynced && skipMultiRun) return;

  const start = Date.now();
  try {
    // refs: https://github.com/drizzle-team/drizzle-orm/discussions/2532
    // @ts-ignore
    await clientDB.dialect.migrate(migrations, clientDB.session, {});
    isLocalDBSchemaSynced = true;

    console.info(`✅ Local database ready in ${Date.now() - start}ms`);
  } catch (cause) {
    console.error('❌ Local database schema migration failed', cause);
    throw cause;
  }

  return clientDB;
};
