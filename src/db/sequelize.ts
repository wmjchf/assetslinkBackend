import { Sequelize } from "sequelize";
import * as dotenv from "dotenv";

dotenv.config();

function buildSequelize() {
  const url = process.env.MYSQL_URL;
  if (url) {
    return new Sequelize(url, {
      dialect: "mysql",
      logging: false,
      pool: { max: 10, min: 0, idle: 10_000 },
    });
  }

  const host = process.env.MYSQL_HOST;
  const port = Number(process.env.MYSQL_PORT || "3306");
  const database = process.env.MYSQL_DATABASE;
  const username = process.env.MYSQL_USER;
  const password = process.env.MYSQL_PASSWORD;

  if (!host || !database || !username) {
    throw new Error("Missing MySQL env. Set MYSQL_URL or MYSQL_HOST/MYSQL_DATABASE/MYSQL_USER/MYSQL_PASSWORD.");
  }

  return new Sequelize(database, username, password || "", {
    host,
    port,
    dialect: "mysql",
    logging: false,
    pool: { max: 10, min: 0, idle: 10_000 },
  });
}

let sequelizeInstance: Sequelize | null = null;

export function getSequelize() {
  if (!sequelizeInstance) {
    sequelizeInstance = buildSequelize();
  }
  return sequelizeInstance;
}

