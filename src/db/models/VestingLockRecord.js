import { DataTypes, Model } from "sequelize";
import { getSequelize } from "../sequelize.js";

export class VestingLockRecord extends Model {}

export function initVestingLockRecordModel() {
  const sequelize = getSequelize();

  VestingLockRecord.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      chainId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      timelockAddress: { type: DataTypes.STRING(42), allowNull: false },
      vestingId: { type: DataTypes.STRING(78), allowNull: false },
      ownerAddress: { type: DataTypes.STRING(42), allowNull: false },
      beneficiaryAddress: { type: DataTypes.STRING(42), allowNull: false },
      tokenAddress: { type: DataTypes.STRING(42), allowNull: false },
      requestedAmount: { type: DataTypes.STRING(78), allowNull: false },
      receivedAmount: { type: DataTypes.STRING(78), allowNull: false },
      startUnix: { type: DataTypes.STRING(20), allowNull: false },
      cliffSeconds: { type: DataTypes.STRING(20), allowNull: false },
      durationSeconds: { type: DataTypes.STRING(20), allowNull: false },
      txHash: { type: DataTypes.STRING(66), allowNull: false },
      blockNumber: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      logIndex: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      tokenName: { type: DataTypes.STRING(64), allowNull: true },
      tokenSymbol: { type: DataTypes.STRING(32), allowNull: true },
      tokenDecimals: { type: DataTypes.TINYINT.UNSIGNED, allowNull: true },
      /** Optional: token launch distribution label (from create flow, matched by beneficiary+amount). */
      distributionLabel: { type: DataTypes.STRING(128), allowNull: true },
    },
    {
      sequelize,
      tableName: "vesting_lock_records",
      indexes: [
        { unique: true, fields: ["chainId", "timelockAddress", "vestingId"] },
        { fields: ["chainId", "beneficiaryAddress"] },
        { fields: ["chainId", "ownerAddress"] },
        { fields: ["chainId", "tokenAddress"] },
        { fields: ["chainId", "txHash"] },
      ],
    }
  );

  return VestingLockRecord;
}
