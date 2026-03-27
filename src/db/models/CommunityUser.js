import { DataTypes, Model } from "sequelize";
import { getSequelize } from "../sequelize.js";

/**
 * Wallet-bound community user (SIWE). No password/email; address is identity.
 * Upsert on login: `CommunityUser.upsert({ address: lower, lastLoginAt: new Date() })`.
 */
export class CommunityUser extends Model {}

export function initCommunityUserModel() {
  const sequelize = getSequelize();

  CommunityUser.init(
    {
      id: {
        type: DataTypes.BIGINT.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      address: {
        type: DataTypes.STRING(42),
        allowNull: false,
        unique: true,
        comment: "Wallet address, lowercase 0x...",
      },
      lastLoginAt: { type: DataTypes.DATE, allowNull: true, field: "last_login_at" },
      /** Optional profile fields for later (community PRD P3) */
      displayName: { type: DataTypes.STRING(64), allowNull: true, field: "display_name" },
    },
    {
      sequelize,
      tableName: "community_users",
      underscored: true,
      timestamps: true,
      updatedAt: "updated_at",
      createdAt: "created_at",
    }
  );

  return CommunityUser;
}
