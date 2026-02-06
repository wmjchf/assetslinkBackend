import { DataTypes, Model } from "sequelize";
import { getSequelize } from "../sequelize.js";

export class TokenLaunchAllocation extends Model {}

export function initTokenLaunchAllocationModel() {
  const sequelize = getSequelize();

  TokenLaunchAllocation.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      chainId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      txHash: { type: DataTypes.STRING(66), allowNull: false },
      tokenAddress: { type: DataTypes.STRING(42), allowNull: false },
      toAddress: { type: DataTypes.STRING(42), allowNull: false },
      amount: { type: DataTypes.STRING(78), allowNull: false },
      label: { type: DataTypes.STRING(64), allowNull: true },
      allocationType: { type: DataTypes.STRING(24), allowNull: false },
      allocIndex: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    },
    {
      sequelize,
      tableName: "token_launch_allocations",
      indexes: [
        { unique: true, fields: ["chainId", "txHash", "allocIndex"] },
        { fields: ["chainId", "tokenAddress"] },
        { fields: ["chainId", "toAddress"] },
      ],
    }
  );

  return TokenLaunchAllocation;
}

