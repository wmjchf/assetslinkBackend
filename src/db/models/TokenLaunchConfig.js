import { DataTypes, Model } from "sequelize";
import { getSequelize } from "../sequelize.js";

export class TokenLaunchConfig extends Model {}

export function initTokenLaunchConfigModel() {
  const sequelize = getSequelize();

  TokenLaunchConfig.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      chainId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      txHash: { type: DataTypes.STRING(66), allowNull: false },
      tokenAddress: { type: DataTypes.STRING(42), allowNull: false },
      factoryAddress: { type: DataTypes.STRING(42), allowNull: false },
      creatorAddress: { type: DataTypes.STRING(42), allowNull: false },

      name: { type: DataTypes.STRING(64), allowNull: false },
      symbol: { type: DataTypes.STRING(32), allowNull: false },
      totalSupplyRaw: { type: DataTypes.STRING(78), allowNull: false },
      marketingWallet: { type: DataTypes.STRING(42), allowNull: false },

      buyMarketingBps: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      buyLiquidityBps: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      buyBurnBps: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      sellMarketingBps: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      sellLiquidityBps: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      sellBurnBps: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },

      maxGasPriceWei: { type: DataTypes.STRING(78), allowNull: false, defaultValue: "0" },
      deadBlocks: { type: DataTypes.STRING(78), allowNull: false, defaultValue: "0" },
      revertEarlyBuys: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      maxTxAmount: { type: DataTypes.STRING(78), allowNull: false, defaultValue: "0" },
      maxWalletAmount: { type: DataTypes.STRING(78), allowNull: false, defaultValue: "0" },
    },
    {
      sequelize,
      tableName: "token_launch_configs",
      indexes: [
        { unique: true, fields: ["chainId", "txHash"] },
        { fields: ["chainId", "tokenAddress"] },
        { fields: ["chainId", "creatorAddress"] },
      ],
    }
  );

  return TokenLaunchConfig;
}

