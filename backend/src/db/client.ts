import postgres from "postgres";

let cachedSql: ReturnType<typeof postgres> | null = null;

export function getSql() {
  if (cachedSql) return cachedSql;

  const databaseUrl =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_PRISMA_URL;
  if (!databaseUrl) {
    throw new Error(
      "Missing database connection string (set DATABASE_URL or POSTGRES_URL)"
    );
  }

  cachedSql = postgres(databaseUrl, {
    max: 20,
    idle_timeout: 30,
    connect_timeout: 10,
    connection: {
      application_name: "phoenix-core",
    },
  });
  return cachedSql;
}
