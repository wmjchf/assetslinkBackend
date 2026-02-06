import { DataTypes, Model } from "sequelize";
import { getSequelize } from "../sequelize";

export class TokenLaunchRecord extends Model {
  declare id: number;
  declare chainId: number;
  declare factoryAddress: string;
  declare creatorAddress: string;
  declare txHash: string;
  declare tokenAddress: string;
  declare blockNumber: number;
  declare logIndex: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export function initTokenLaunchRecordModel() {
  const sequelize = getSequelize();

  TokenLaunchRecord.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      chainId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      factoryAddress: { type: DataTypes.STRING(42), allowNull: false },
      creatorAddress: { type: DataTypes.STRING(42), allowNull: false },
      txHash: { type: DataTypes.STRING(66), allowNull: false },
      tokenAddress: { type: DataTypes.STRING(42), allowNull: false },
      blockNumber: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      logIndex: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    },
    {
      sequelize,
      tableName: "token_launch_records",
      indexes: [
        { unique: true, fields: ["chainId", "txHash"] },
        { fields: ["chainId", "creatorAddress"] },
        { fields: ["chainId", "tokenAddress"] },
      ],
    }
  );

  return TokenLaunchRecord;
}

