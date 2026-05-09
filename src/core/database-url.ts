export interface DatabaseUrlConfig {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
  ssl?: boolean;
}

export function parseDatabaseUrl(value: string): DatabaseUrlConfig {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL must be a valid MySQL URL');
  }

  if (url.protocol !== 'mysql:' && url.protocol !== 'mysql2:') {
    throw new Error('DATABASE_URL must start with mysql://');
  }

  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!name) {
    throw new Error('DATABASE_URL must include a database name, for example mysql://user:pass@host:3306/app_db');
  }

  return {
    host: url.hostname || 'localhost',
    port: url.port ? Number.parseInt(url.port, 10) : 3306,
    name,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: url.searchParams.get('ssl') === 'true' || url.searchParams.get('ssl-mode') === 'REQUIRED',
  };
}

export function maskDatabaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.password) {
      url.password = '********';
    }
    return url.toString();
  } catch {
    return '<invalid DATABASE_URL>';
  }
}
