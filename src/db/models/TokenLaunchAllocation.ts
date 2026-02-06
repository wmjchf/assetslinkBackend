import { DataTypes, Model } from "sequelize";
import { getSequelize } from "../sequelize";

export type TokenLaunchAllocationType = "immediate" | "creator_remaining";

export class TokenLaunchAllocation extends Model {
  declare id: number;
  declare chainId: number;
  declare txHash: string;
  declare tokenAddress: string;
  declare toAddress: string;
  declare amount: string; // uint256 decimal string
  declare label?: string;
  declare allocationType: TokenLaunchAllocationType;
  declare allocIndex: number; // stable order in calldata (or 999999 for remaining)
  declare createdAt: Date;
  declare updatedAt: Date;
}

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

