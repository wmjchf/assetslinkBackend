import { DataTypes, Model } from "sequelize";
import { getSequelize } from "../sequelize.js";

export class AirdropFundRecord extends Model {}

export function initAirdropFundRecordModel() {
  const sequelize = getSequelize();

  AirdropFundRecord.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      chainId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      roundId: { type: DataTypes.STRING(78), allowNull: false },
      distributorAddress: { type: DataTypes.STRING(42), allowNull: false },
      tokenAddress: { type: DataTypes.STRING(42), allowNull: false },
      funderAddress: { type: DataTypes.STRING(42), allowNull: false },
      amount: { type: DataTypes.STRING(78), allowNull: false },
      txHash: { type: DataTypes.STRING(66), allowNull: false },
      blockNumber: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    },
    {
      sequelize,
      tableName: "airdrop_fund_records",
      indexes: [
        { unique: true, fields: ["chainId", "txHash", "roundId"] },
        { fields: ["chainId", "roundId"] },
        { fields: ["chainId", "funderAddress"] },
      ],
    }
  );

  return AirdropFundRecord;
}

