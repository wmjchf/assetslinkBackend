import { DataTypes, Model } from "sequelize";
import { getSequelize } from "../sequelize.js";

export class AddLiquidityRecord extends Model {}

export function initAddLiquidityRecordModel() {
  const sequelize = getSequelize();

  AddLiquidityRecord.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      chainId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      txHash: { type: DataTypes.STRING(66), allowNull: false },
      wallet: { type: DataTypes.STRING(42), allowNull: false },
      tokenAddress: { type: DataTypes.STRING(42), allowNull: false },
      quoteAsset: { type: DataTypes.STRING(16), allowNull: false },
      counterpartyTokenAddress: { type: DataTypes.STRING(42), allowNull: true },
      pairAddress: { type: DataTypes.STRING(42), allowNull: false },
      lpTokenAddress: { type: DataTypes.STRING(42), allowNull: true },
      /** Set true when /api/lp-lock/index-tx indexes a lock whose token is this pair/LP. */
      lpLocked: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      sequelize,
      tableName: "add_liquidity_records",
      indexes: [
        { unique: true, fields: ["chainId", "txHash"] },
        { fields: ["chainId", "wallet"] },
        { fields: ["chainId", "tokenAddress"] },
        { fields: ["chainId", "pairAddress"] },
        { fields: ["chainId", "lpTokenAddress"] },
      ],
    }
  );

  return AddLiquidityRecord;
}
