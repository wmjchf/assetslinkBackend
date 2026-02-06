import { DataTypes, Model } from "sequelize";
import { getSequelize } from "../sequelize.js";

export class TokenLaunchVestingVault extends Model {}

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

