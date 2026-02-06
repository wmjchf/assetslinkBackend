import { DataTypes, Model } from "sequelize";
import { getSequelize } from "../sequelize";

export class IndexerState extends Model {
  declare id: number;
  declare key: string;
  declare lastBlock: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

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

