import { DataTypes, Model } from "sequelize";
import { getSequelize } from "../sequelize.js";

export class BatchTransferRecord extends Model {}

export function initBatchTransferRecordModel() {
  const sequelize = getSequelize();

  BatchTransferRecord.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      chainId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      txHash: { type: DataTypes.STRING(66), allowNull: false },
      fromAddress: { type: DataTypes.STRING(42), allowNull: false },
      batchContract: { type: DataTypes.STRING(42), allowNull: false },
      tokenType: { type: DataTypes.STRING(16), allowNull: false },
      tokenAddress: { type: DataTypes.STRING(42), allowNull: true },
      decimals: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 18 },
      recipientCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      successCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      failedCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      failedBatchIndicesJson: { type: DataTypes.TEXT, allowNull: true },
      blockNumber: { type: DataTypes.STRING(32), allowNull: true },
      feeWei: { type: DataTypes.STRING(80), allowNull: false },
      transfersJson: { type: DataTypes.TEXT, allowNull: false },
    },
    {
      sequelize,
      tableName: "batch_transfer_records",
      indexes: [{ unique: true, fields: ["chainId", "txHash"] }, { fields: ["fromAddress"] }],
    }
  );

  return BatchTransferRecord;
}
