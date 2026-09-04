import { pool } from '../src/db/pool.js';
import { validateProductionDatabaseIdentity, type ProductionDatabaseIdentity } from '../src/domain/production-database.js';

try {
  const result = await pool.query<{
    database_name: string;
    role_name: string;
    server_address: string;
    database_owner: string;
    role_can_login: boolean;
    role_elevated: boolean;
  }>(`SELECT
    current_database() AS database_name,
    current_user AS role_name,
    COALESCE(host(inet_server_addr()), '') AS server_address,
    pg_get_userbyid(database_row.datdba) AS database_owner,
    role_row.rolcanlogin AS role_can_login,
    (role_row.rolsuper OR role_row.rolcreaterole OR role_row.rolcreatedb OR role_row.rolreplication OR role_row.rolbypassrls) AS role_elevated
  FROM pg_roles role_row
  JOIN pg_database database_row ON database_row.datname = current_database()
  WHERE role_row.rolname = current_user`);
  const row = result.rows[0];
  if (!row) throw new Error('Database identity query returned no row.');
  const identity: ProductionDatabaseIdentity = {
    databaseName: row.database_name,
    roleName: row.role_name,
    serverAddress: row.server_address,
    databaseOwner: row.database_owner,
    roleCanLogin: row.role_can_login,
    roleElevated: row.role_elevated,
  };
  const errors = validateProductionDatabaseIdentity(identity);
  console.log(JSON.stringify({ ready: errors.length === 0, ...identity, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
} catch {
  console.log(JSON.stringify({ ready: false, errors: ['Production database connection and identity verification failed.'] }, null, 2));
  process.exitCode = 1;
} finally {
  await pool.end();
}
