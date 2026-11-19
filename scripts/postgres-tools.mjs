export function getDatabaseTarget() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set in the local environment.");
  const url = new URL(process.env.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL must use the PostgreSQL protocol.");
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) throw new Error("DATABASE_URL must include a database name.");
  return { url, database };
}

export function getPostgresEnvironment(url, database) {
  const host = url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
  const env = {
    ...process.env,
    PGHOST: host,
    PGPORT: url.port || "5432",
    PGDATABASE: database,
  };
  if (url.username) env.PGUSER = decodeURIComponent(url.username);
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);

  const environmentOptions = {
    sslmode: "PGSSLMODE",
    sslcert: "PGSSLCERT",
    sslkey: "PGSSLKEY",
    sslrootcert: "PGSSLROOTCERT",
    sslpassword: "PGSSLPASSWORD",
    options: "PGOPTIONS",
    application_name: "PGAPPNAME",
    connect_timeout: "PGCONNECT_TIMEOUT",
    target_session_attrs: "PGTARGETSESSIONATTRS",
  };
  for (const [parameter, variable] of Object.entries(environmentOptions)) {
    const value = url.searchParams.get(parameter);
    if (value !== null) env[variable] = value;
  }
  return env;
}

export function requireLocalBooksDatabase({ url, database }) {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || database !== "books") {
    throw new Error("This operation is restricted to the local `books` database.");
  }
}
