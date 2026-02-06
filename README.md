# AssetsLink Backend API

基于 Express + JavaScript 的后端服务，提供 Token Launch 相关的 API 接口。

## 快速开始

### 1. 安装依赖

```bash
cd backend
pnpm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置 MySQL 连接信息：

```env
MYSQL_HOST=47.238.155.188
MYSQL_PORT=33016
MYSQL_DATABASE=assetslink
MYSQL_USER=root
MYSQL_PASSWORD=your_password

# 或使用 MYSQL_URL
# MYSQL_URL=mysql://user:password@host:port/database

# 服务器端口（可选，默认 3001）
PORT=3001
```

### 3. 启动服务

开发模式（使用 Node.js watch 模式，支持热重载）：

```bash
pnpm dev
```

生产模式：

```bash
pnpm start
```

服务将在 `http://localhost:3001` 启动。

### 4. 运行索引器（可选）

索引器用于监听链上事件并更新数据库。每条链有独立的启动命令，会自动加载对应的 `.env` 文件：

**Sepolia 测试网：**
```bash
pnpm indexer:sepolia
```
使用 `backend/.env.development` + `backend/.env.sepolia`

**Base Sepolia 测试网：**
```bash
pnpm indexer:base-sepolia
```
使用 `backend/.env.development` + `backend/.env.basesepolia`

**BSC 测试网：**
```bash
pnpm indexer:bsc-testnet
```
使用 `backend/.env.development` + `backend/.env.bsctest`

**以太坊主网：**
```bash
pnpm indexer:mainnet
```
使用 `backend/.env.production` + `backend/.env.mainnet`

**通用命令（使用当前环境变量）：**
```bash
pnpm indexer
```

索引器需要配置以下环境变量（在对应的 `.env` 文件中）：
- `INDEXER_RPC_URL` - RPC 节点 URL
- `INDEXER_CHAIN_ID` - 链 ID
- `INDEXER_TOKEN_FACTORY` - TokenFactory 合约地址
- `INDEXER_START_BLOCK` (可选) - 起始区块号
- `INDEXER_POLL_MS` (可选) - 轮询间隔（毫秒，默认 5000）
- `INDEXER_BATCH_BLOCKS` (可选) - 每批处理的区块数（默认 2000）

**注意：** 每条链的索引器需要独立运行，可以在不同的终端或使用进程管理器（如 PM2）同时运行多个索引器。

## API 接口

### GET /api/token-launch/my-token

获取用户创建的 token 列表。

**查询参数：**
- `address` (必需): 用户钱包地址，例如 `0x...`
- `chainId` (可选): 链 ID，例如 `11155111`。如果不提供，返回所有链的数据。

**响应示例：**

```json
{
  "error": null,
  "records": [
    {
      "id": "1",
      "chainId": 11155111,
      "txHash": "0x...",
      "tokenAddress": "0x...",
      "createdAt": 1234567890000,
      "config": {
        "name": "My Token",
        "symbol": "MTK"
      }
    }
  ]
}
```

### POST /api/token-launch/metadata

更新 allocations 和 vestings 的标签。

**请求体：**

```json
{
  "chainId": 11155111,
  "txHash": "0x...",
  "allocations": [
    { "allocIndex": 0, "label": "Team" }
  ],
  "vestings": [
    { "vestingIndex": 0, "label": "Advisor" }
  ]
}
```

### GET /api/token-launch/records

获取完整的 token launch 记录（包含配置、分配、vesting 详情）。

**查询参数：**
- `address` (可选): 创建者地址
- `tokenAddress` (可选): Token 地址
- `chainId` (可选): 链 ID

### GET /api/token-launch/release-curve

获取 token 的 vesting release curves。

**查询参数：**
- `tokenAddress` (必需): Token 地址
- `chainId` (必需): 链 ID

### GET /health

健康检查接口。

**响应：**

```json
{
  "status": "ok"
}
```

## 部署

### 使用 PM2（推荐）

PM2 可以同时管理 API 服务和多个链的索引器。

#### 1. 安装 PM2

```bash
npm install -g pm2
```

#### 2. 创建日志目录

```bash
mkdir -p logs
```

#### 3. 启动服务

**开发/测试环境：**

```bash
# 启动开发环境服务（API + 所有测试网索引器）
pnpm pm2:start:dev

# 或者使用 PM2 命令
pm2 start ecosystem.config.dev.cjs
```

这会同时启动：
- `assetslink-api-dev` - API 服务（开发环境）
- `assetslink-indexer-sepolia` - Sepolia 索引器
- `assetslink-indexer-base-sepolia` - Base Sepolia 索引器
- `assetslink-indexer-bsc-testnet` - BSC 测试网索引器

**生产环境：**

```bash
# 启动生产环境服务（API + 主网索引器）
pnpm pm2:start:prod

# 或者使用 PM2 命令
pm2 start ecosystem.config.prod.cjs
```

这会同时启动：
- `assetslink-api` - API 服务（生产环境）
- `assetslink-indexer-mainnet` - 主网索引器

#### 4. 常用 PM2 命令

```bash
# 查看状态
pnpm pm2:status
# 或
pm2 status

# 查看日志（所有应用）
pnpm pm2:logs
# 或
pm2 logs

# 查看特定应用的日志
pm2 logs assetslink-api
pm2 logs assetslink-indexer-sepolia

# 重启所有应用（生产环境）
pnpm pm2:restart:prod
# 或
pm2 restart ecosystem.config.prod.cjs

# 重启开发环境应用
pnpm pm2:restart:dev
# 或
pm2 restart ecosystem.config.dev.cjs

# 重启特定应用
pm2 restart assetslink-api
pm2 restart assetslink-indexer-sepolia

# 停止所有应用（生产环境）
pnpm pm2:stop:prod
# 或
pm2 stop ecosystem.config.prod.cjs

# 停止开发环境应用
pnpm pm2:stop:dev
# 或
pm2 stop ecosystem.config.dev.cjs

# 删除所有应用（生产环境）
pnpm pm2:delete:prod
# 或
pm2 delete ecosystem.config.prod.cjs

# 删除开发环境应用
pnpm pm2:delete:dev
# 或
pm2 delete ecosystem.config.dev.cjs

# 保存当前进程列表（用于开机自启）
pnpm pm2:save
# 或
pm2 save

# 设置开机自启（首次运行）
pnpm pm2:startup
# 或
pm2 startup
# 然后运行生成的命令
```

#### 5. 只启动部分服务

如果不需要所有索引器，可以编辑对应的配置文件（`ecosystem.config.dev.js` 或 `ecosystem.config.prod.js`），注释掉不需要的应用，或者使用 PM2 命令：

```bash
# 只启动 API 服务（生产环境）
pm2 start ecosystem.config.prod.cjs --only assetslink-api

# 只启动 API 和 Sepolia 索引器（开发环境）
pm2 start ecosystem.config.dev.cjs --only assetslink-api-dev,assetslink-indexer-sepolia
```

#### 6. 监控

```bash
# 实时监控
pm2 monit

# 查看详细信息
pm2 describe assetslink-api
```

### 使用 Docker

创建 `Dockerfile`：

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY . .

EXPOSE 3001

CMD ["node", "src/index.js"]
```

构建和运行：

```bash
docker build -t assetslink-backend .
docker run -p 3001:3001 --env-file .env assetslink-backend
```

## 前端配置

在 Next.js 项目的环境变量中配置后端 API 地址：

```env
# .env.local 或 Netlify 环境变量
NEXT_PUBLIC_API_BASE_URL=https://your-backend-domain.com
```

或者使用服务器端环境变量：

```env
API_BASE_URL=https://your-backend-domain.com
```

## 项目结构

```
backend/
├── src/
│   ├── db/
│   │   ├── init.js              # 数据库初始化
│   │   ├── sequelize.js         # Sequelize 配置
│   │   └── models/              # 数据库模型（JavaScript）
│   ├── routes/
│   │   └── tokenLaunch.js       # Token Launch API 路由
│   ├── tokenLaunch/
│   │   └── releaseCurve.js      # Release curve 工具函数
│   ├── indexer/
│   │   └── tokenLaunchIndexer.js # 索引器（独立运行）
│   └── index.js                 # Express 应用入口
├── package.json
└── README.md
```

## 技术栈

- **Express** - Web 框架
- **Sequelize** - ORM
- **MySQL2** - MySQL 驱动
- **Viem** - 以太坊工具库
- **JavaScript (ES Modules)** - 编程语言
