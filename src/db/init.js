import { getSequelize } from "./sequelize.js";
import { initTokenLaunchRecordModel } from "./models/TokenLaunchRecord.js";
import { initIndexerStateModel } from "./models/IndexerState.js";
import { initTokenLaunchVestingVaultModel } from "./models/TokenLaunchVestingVault.js";
import { initTokenLaunchConfigModel } from "./models/TokenLaunchConfig.js";
import { initTokenLaunchAllocationModel } from "./models/TokenLaunchAllocation.js";
import { initLpLockRecordModel } from "./models/LpLockRecord.js";
import { initCommunityUserModel } from "./models/CommunityUser.js";
import { initBatchTransferRecordModel } from "./models/BatchTransferRecord.js";
import { initVestingLockRecordModel } from "./models/VestingLockRecord.js";
import { initAirdropRoundRecordModel } from "./models/AirdropRoundRecord.js";
import { initAirdropFundRecordModel } from "./models/AirdropFundRecord.js";
import { initAddLiquidityRecordModel } from "./models/AddLiquidityRecord.js";
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
    const c = Number(rows?.[0]?.c || 0);
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
      const count = Number(rows?.[0]?.c || 0);
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
      const count = Number(rows?.[0]?.c || 0);
      if (count === 0) {
        await conn.query(`ALTER TABLE token_launch_allocations ADD COLUMN ${c.name} ${c.ddl}`);
      }
    }
  } finally {
    await conn.end();
  }
}

async function ensureLpLockTokenColumns() {
  const info = getMysqlInfo();
  if (!info.host || !info.user || !info.database) return;
  const conn = await mysql.createConnection({
    host: info.host, port: info.port,
    user: info.user, password: info.password, database: info.database,
  });
  try {
    const cols = [
      { name: "tokenName",     ddl: "VARCHAR(64) NULL" },
      { name: "tokenSymbol",   ddl: "VARCHAR(32) NULL" },
      { name: "tokenDecimals", ddl: "TINYINT UNSIGNED NULL" },
    ];
    for (const c of cols) {
      const [rows] = await conn.query(
        `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'lp_lock_records' AND COLUMN_NAME = ?`,
        [info.database, c.name]
      );
      if (Number(rows?.[0]?.cnt || 0) === 0) {
        await conn.query(`ALTER TABLE lp_lock_records ADD COLUMN ${c.name} ${c.ddl}`);
      }
    }
  } finally {
    await conn.end();
  }
}

async function ensureAirdropRoundClaimsJsonColumn() {
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
      `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'airdrop_round_records' AND COLUMN_NAME = 'claimsJson'`,
      [info.database]
    );
    if (Number(rows?.[0]?.cnt || 0) === 0) {
      await conn.query(
        `ALTER TABLE airdrop_round_records ADD COLUMN claimsJson LONGTEXT NULL`
      );
    }
  } finally {
    await conn.end();
  }
}

async function ensureAddLiquidityLpLockedColumn() {
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
      `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'add_liquidity_records' AND COLUMN_NAME = 'lpLocked'`,
      [info.database]
    );
    if (Number(rows?.[0]?.cnt || 0) === 0) {
      await conn.query(
        `ALTER TABLE add_liquidity_records ADD COLUMN lpLocked TINYINT(1) NOT NULL DEFAULT 0`
      );
    }
  } finally {
    await conn.end();
  }
}

async function ensureAirdropRoundRoundNameColumn() {
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
      `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'airdrop_round_records' AND COLUMN_NAME = 'roundName'`,
      [info.database]
    );
    if (Number(rows?.[0]?.cnt || 0) === 0) {
      await conn.query(
        `ALTER TABLE airdrop_round_records ADD COLUMN roundName VARCHAR(200) NULL`
      );
    }
  } finally {
    await conn.end();
  }
}

async function ensureVestingLockOptionalColumns() {
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
    const cols = [{ name: "distributionLabel", ddl: "VARCHAR(128) NULL" }];
    for (const c of cols) {
      const [rows] = await conn.query(
        `SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'vesting_lock_records' AND COLUMN_NAME = ?`,
        [info.database, c.name]
      );
      if (Number(rows?.[0]?.cnt || 0) === 0) {
        await conn.query(`ALTER TABLE vesting_lock_records ADD COLUMN \`${c.name}\` ${c.ddl}`);
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
  initLpLockRecordModel();
  initCommunityUserModel();
  initBatchTransferRecordModel();
  initVestingLockRecordModel();
  initAirdropRoundRecordModel();
  initAirdropFundRecordModel();
  initAddLiquidityRecordModel();
  const sequelize = getSequelize();
  try {
    await sequelize.authenticate();
  } catch (e) {
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
  // Ensure token metadata columns exist for lp_lock_records.
  await ensureLpLockTokenColumns();
  // Ensure vesting_lock_records columns (sequelize.sync does not ALTER existing tables).
  await ensureVestingLockOptionalColumns();
  await ensureAirdropRoundClaimsJsonColumn();
  await ensureAirdropRoundRoundNameColumn();
  await ensureAddLiquidityLpLockedColumn();
  initialized = true;
}

