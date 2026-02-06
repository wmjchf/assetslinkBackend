import { getSequelize } from "./sequelize";
import { initTokenLaunchRecordModel } from "./models/TokenLaunchRecord";
import { initIndexerStateModel } from "./models/IndexerState";
import { initTokenLaunchVestingVaultModel } from "./models/TokenLaunchVestingVault";
import { initTokenLaunchConfigModel } from "./models/TokenLaunchConfig";
import { initTokenLaunchAllocationModel } from "./models/TokenLaunchAllocation";
import mysql from "mysql2/promise";

let initialized = false;

function getMysqlInfo() {
  const url = process.env.MYSQL_URL;
  if (url) {
    const u = new URL(url);
    const dbName = u.pathname.replace(/^\//, "");
    return {
      host: u.hostname,
      port: Number(u.port || "3306"),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: dbName,
    };
  }

  return {
    host: process.env.MYSQL_HOST || "",
    port: Number(process.env.MYSQL_PORT || "3306"),
    user: process.env.MYSQL_USER || "",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "",
  };
}

async function ensureDatabaseExists() {
  const info = getMysqlInfo();
  if (!info.host || !info.user || !info.database) {
    throw new Error(
      "Missing MySQL env. Set MYSQL_URL or MYSQL_HOST/MYSQL_DATABASE/MYSQL_USER/MYSQL_PASSWORD."
    );
  }
  const conn = await mysql.createConnection({
    host: info.host,
    port: info.port,
    user: info.user,
    password: info.password,
  });
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${info.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await conn.end();
}

async function dropLegacyVestingVaultsColumnIfExists() {
  const info = getMysqlInfo();
  if (!info.host || !info.user || !info.database) return;
  const conn = await mysql.createConnection({
    host: info.host,
    port: info.port,
    user: info.user,
    password: info.password,
    database: info.database,
  });
  try {
    const [rows] = await conn.query(
      `SELECT COUNT(*) as c
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = 'token_launch_records'
         AND COLUMN_NAME = 'vestingVaults'`,
      [info.database]
    );
    const c = Number((rows as any[])?.[0]?.c || 0);
    if (c > 0) {
      await conn.query(`ALTER TABLE token_launch_records DROP COLUMN vestingVaults`);
    }
  } finally {
    await conn.end();
  }
}

async function ensureVestingVaultColumns() {
  const info = getMysqlInfo();
  if (!info.host || !info.user || !info.database) return;
  const conn = await mysql.createConnection({
    host: info.host,
    port: info.port,
    user: info.user,
    password: info.password,
    database: info.database,
  });
  try {
    const cols = [
      { name: "label", ddl: "VARCHAR(64) NULL" },
      { name: "vestingStart", ddl: "VARCHAR(32) NULL" },
      { name: "vestingCliffSeconds", ddl: "VARCHAR(32) NULL" },
      { name: "vestingDurationSeconds", ddl: "VARCHAR(32) NULL" },
      { name: "vestingIndex", ddl: "INT UNSIGNED NULL" },
    ];

    for (const c of cols) {
      const [rows] = await conn.query(
        `SELECT COUNT(*) as c
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ?
           AND TABLE_NAME = 'token_launch_vesting_vaults'
           AND COLUMN_NAME = ?`,
        [info.database, c.name]
      );
      const count = Number((rows as any[])?.[0]?.c || 0);
      if (count === 0) {
        await conn.query(
          `ALTER TABLE token_launch_vesting_vaults ADD COLUMN ${c.name} ${c.ddl}`
        );
      }
    }
  } finally {
    await conn.end();
  }
}

async function ensureAllocationColumns() {
  const info = getMysqlInfo();
  if (!info.host || !info.user || !info.database) return;
  const conn = await mysql.createConnection({
    host: info.host,
    port: info.port,
    user: info.user,
    password: info.password,
    database: info.database,
  });
  try {
    const cols = [{ name: "label", ddl: "VARCHAR(64) NULL" }];
    for (const c of cols) {
      const [rows] = await conn.query(
        `SELECT COUNT(*) as c
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ?
           AND TABLE_NAME = 'token_launch_allocations'
           AND COLUMN_NAME = ?`,
        [info.database, c.name]
      );
      const count = Number((rows as any[])?.[0]?.c || 0);
      if (count === 0) {
        await conn.query(`ALTER TABLE token_launch_allocations ADD COLUMN ${c.name} ${c.ddl}`);
      }
    }
  } finally {
    await conn.end();
  }
}

export async function ensureDb() {
  if (initialized) return;
  initTokenLaunchRecordModel();
  initIndexerStateModel();
  initTokenLaunchVestingVaultModel();
  initTokenLaunchConfigModel();
  initTokenLaunchAllocationModel();
  const sequelize = getSequelize();
  try {
    await sequelize.authenticate();
  } catch (e: any) {
    const code = e?.original?.code || e?.parent?.code || e?.code;
    if (code === "ER_BAD_DB_ERROR") {
      await ensureDatabaseExists();
      await sequelize.authenticate();
    } else {
      throw e;
    }
  }
  // For now, auto-create tables. For production, you may want migrations instead.
  await sequelize.sync();
  // Clean up legacy column if it exists from older deployments.
  await dropLegacyVestingVaultsColumnIfExists();
  // Ensure new vesting columns exist for older deployments (sequelize.sync won't add columns by default).
  await ensureVestingVaultColumns();
  // Ensure label column exists for allocations table.
  await ensureAllocationColumns();
  initialized = true;
}

