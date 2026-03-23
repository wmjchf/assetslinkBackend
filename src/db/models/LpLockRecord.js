import { DataTypes, Model } from "sequelize";
import { getSequelize } from "../sequelize.js";

export class LpLockRecord extends Model {}

export function initLpLockRecordModel() {
  const sequelize = getSequelize();

  LpLockRecord.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      chainId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      contractAddress: { type: DataTypes.STRING(42), allowNull: false },  // LPTimeLock contract
      lockId: { type: DataTypes.STRING(78), allowNull: false },            // on-chain lock ID (uint256 as string)
      ownerAddress: { type: DataTypes.STRING(42), allowNull: false },      // tx sender
      beneficiaryAddress: { type: DataTypes.STRING(42), allowNull: false },
      tokenAddress: { type: DataTypes.STRING(42), allowNull: false },      // LP token
      amount: { type: DataTypes.STRING(78), allowNull: false },            // uint256 as decimal string
      unlockTime: { type: DataTypes.STRING(20), allowNull: false },        // unix timestamp as string
      txHash: { type: DataTypes.STRING(66), allowNull: false },
      blockNumber: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      logIndex: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      // token metadata (fetched at index time, static)
      tokenName: { type: DataTypes.STRING(64), allowNull: true },
      tokenSymbol: { type: DataTypes.STRING(32), allowNull: true },
      tokenDecimals: { type: DataTypes.TINYINT.UNSIGNED, allowNull: true },
    },
    {
      sequelize,
      tableName: "lp_lock_records",
      indexes: [
        { unique: true, fields: ["chainId", "txHash", "lockId"] },
        { fields: ["chainId", "beneficiaryAddress"] },
        { fields: ["chainId", "ownerAddress"] },
        { fields: ["chainId", "tokenAddress"] },
      ],
    }
  );

  return LpLockRecord;
}
