import { DataTypes, Model } from "sequelize";
import { getSequelize } from "../sequelize.js";

export class AirdropRoundRecord extends Model {}

export function initAirdropRoundRecordModel() {
  const sequelize = getSequelize();

  AirdropRoundRecord.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      chainId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      roundId: { type: DataTypes.STRING(78), allowNull: false },
      distributorAddress: { type: DataTypes.STRING(42), allowNull: false },
      ownerAddress: { type: DataTypes.STRING(42), allowNull: false },
      tokenAddress: { type: DataTypes.STRING(42), allowNull: false },
      merkleRoot: { type: DataTypes.STRING(66), allowNull: false },
      startAt: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      endAt: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      totalAmount: { type: DataTypes.STRING(78), allowNull: false },
      createTxHash: { type: DataTypes.STRING(66), allowNull: false },
      blockNumber: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "created" },
      /** Off-chain display name only (not on-chain) */
      roundName: { type: DataTypes.STRING(200), allowNull: true },
      /** Full Merkle claims payload (same shape as airdrop-claims.json); optional */
      claimsJson: { type: DataTypes.TEXT("long"), allowNull: true },
    },
    {
      sequelize,
      tableName: "airdrop_round_records",
      indexes: [
        { unique: true, fields: ["chainId", "distributorAddress", "roundId"] },
        { fields: ["chainId", "ownerAddress"] },
        { fields: ["chainId", "tokenAddress"] },
        { fields: ["chainId", "createTxHash"] },
      ],
    }
  );

  return AirdropRoundRecord;
}

