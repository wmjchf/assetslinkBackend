import { DataTypes, Model } from "sequelize";
import { getSequelize } from "../sequelize";

export class TokenLaunchVestingVault extends Model {
  declare id: number;
  declare chainId: number;
  declare txHash: string;
  declare tokenAddress: string;
  declare vaultAddress: string;
  declare beneficiary: string;
  declare amount: string;
  declare label?: string;
  declare vestingStart?: string; // uint64 as decimal string
  declare vestingCliffSeconds?: string; // uint64 as decimal string
  declare vestingDurationSeconds?: string; // uint64 as decimal string
  declare vestingIndex?: number;
  declare blockNumber: number;
  declare logIndex: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export function initTokenLaunchVestingVaultModel() {
  const sequelize = getSequelize();

  TokenLaunchVestingVault.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      chainId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      txHash: { type: DataTypes.STRING(66), allowNull: false },
      tokenAddress: { type: DataTypes.STRING(42), allowNull: false },
      vaultAddress: { type: DataTypes.STRING(42), allowNull: false },
      beneficiary: { type: DataTypes.STRING(42), allowNull: false },
      amount: { type: DataTypes.STRING(78), allowNull: false }, // store uint256 as decimal string
      label: { type: DataTypes.STRING(64), allowNull: true },
      vestingStart: { type: DataTypes.STRING(32), allowNull: true },
      vestingCliffSeconds: { type: DataTypes.STRING(32), allowNull: true },
      vestingDurationSeconds: { type: DataTypes.STRING(32), allowNull: true },
      vestingIndex: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      blockNumber: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      logIndex: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    },
    {
      sequelize,
      tableName: "token_launch_vesting_vaults",
      indexes: [
        { unique: true, fields: ["chainId", "txHash", "vaultAddress"] },
        { fields: ["chainId", "tokenAddress"] },
        { fields: ["chainId", "beneficiary"] },
      ],
    }
  );

  return TokenLaunchVestingVault;
}

