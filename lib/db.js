import pg from "pg";
import { lookup } from "node:dns/promises";
import { attachDatabasePool } from "@vercel/functions";

const { Pool } = pg;
const globalForDb = globalThis;

function normalizeUrl(value) {
  if (!value) throw new Error("DATABASE_URL is not configured");
  return value.replace(/^postgresql\+psycopg2:/, "postgresql:").replace(/^postgres:/, "postgresql:");
}

async function connectionConfig() {
  const connectionString = normalizeUrl(process.env.DATABASE_URL);
  const url = new URL(connectionString);
  try {
    await lookup(url.hostname);
    return { connectionString };
  } catch (systemDnsError) {
    // Some local networks fail to resolve Neon CNAMEs through their configured DNS.
    // Resolve only Neon hosts over Google's HTTPS DNS endpoint, then pass the endpoint
    // ID to Neon so TLS can still use the original hostname and verify its certificate.
    if (!url.hostname.endsWith(".aws.neon.tech")) throw systemDnsError;
    const hostname = url.hostname;
    const dnsResponse = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`, { signal: AbortSignal.timeout(5000) });
    if (!dnsResponse.ok) throw new Error("Neon DNS lookup failed. Check network access and DATABASE_URL.");
    const dnsResult = await dnsResponse.json();
    const address = dnsResult.Answer?.find((answer) => answer.type === 1)?.data;
    if (!address || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) throw new Error("Neon DNS returned no usable database address.");

    url.hostname = address;
    url.searchParams.set("options", `endpoint=${hostname.split(".")[0]}`);
    url.searchParams.delete("sslmode");
    return { connectionString: url.toString(), ssl: { servername: hostname, rejectUnauthorized: true } };
  }
}

async function createPool() {
  const config = await connectionConfig();
  const pool = new Pool({
    ...config,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
    keepAlive: true,
  });
  pool.on("error", (error) => console.error("Postgres idle client error", error.message));
  attachDatabasePool(pool);
  globalForDb.prepmaxxingPool = pool;
  return pool;
}

export async function getPool() {
  if (!globalForDb.prepmaxxingPoolPromise) {
    globalForDb.prepmaxxingPoolPromise = createPool().catch((error) => {
      globalForDb.prepmaxxingPoolPromise = null;
      throw error;
    });
  }
  return globalForDb.prepmaxxingPoolPromise;
}

export async function query(text, values = []) {
  const pool = await getPool();
  return pool.query(text, values);
}
