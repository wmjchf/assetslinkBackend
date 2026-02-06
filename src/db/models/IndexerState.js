import { DataTypes, Model } from "sequelize";
import { getSequelize } from "../sequelize.js";

export class IndexerState extends Model {}

export function initIndexerStateModel() {
  const sequelize = getSequelize();

  IndexerState.init(
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
      key: { type: DataTypes.STRING(128), allowNull: false, unique: true },
      lastBlock: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    },
    {
      sequelize,
      tableName: "indexer_state",
      indexes: [{ unique: true, fields: ["key"] }],
    }
  );

  return IndexerState;
}

