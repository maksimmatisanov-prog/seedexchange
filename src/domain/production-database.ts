export type ProductionDatabaseIdentity = {
  databaseName: string;
  roleName: string;
  serverAddress: string;
  databaseOwner: string;
  roleCanLogin: boolean;
  roleElevated: boolean;
};

export function validateProductionDatabaseIdentity(identity: ProductionDatabaseIdentity): string[] {
  const errors: string[] = [];
  if (identity.databaseName !== 'seedexchange_production') errors.push('Connected database is not seedexchange_production.');
  if (identity.roleName !== 'seedexchange_production') errors.push('Connected role is not seedexchange_production.');
  if (identity.serverAddress !== '127.0.0.1') errors.push('Production database connection is not using the approved IPv4 loopback endpoint.');
  if (identity.databaseOwner !== 'seedexchange_production') errors.push('The production database is not owned by seedexchange_production.');
  if (!identity.roleCanLogin) errors.push('The production database role cannot log in.');
  if (identity.roleElevated) errors.push('The production database role has elevated cluster privileges.');
  return errors;
}
