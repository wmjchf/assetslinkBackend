# AssetsLink Backend API

基于 Koa 的后端服务，提供 Token Launch 相关的 API 接口。

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

开发模式（使用 tsx，支持热重载）：

```bash
pnpm dev
```

生产模式：

```bash
# 构建
pnpm build

# 启动
pnpm start
```

服务将在 `http://localhost:3001` 启动。

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

**错误响应：**

```json
{
  "error": "Missing address. Please provide ?address=0x... in the URL.",
  "records": []
}
```

### GET /health

健康检查接口。

**响应：**

```json
{
  "status": "ok"
}
```

## 部署

### 使用 PM2

```bash
# 安装 PM2
npm install -g pm2

# 构建项目
pnpm build

# 启动服务
pm2 start dist/index.js --name assetslink-backend

# 查看日志
pm2 logs assetslink-backend

# 停止服务
pm2 stop assetslink-backend
```

### 使用 Docker

创建 `Dockerfile`：

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

EXPOSE 3001

CMD ["node", "dist/index.js"]
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
│   │   ├── init.ts              # 数据库初始化
│   │   ├── sequelize.ts         # Sequelize 配置
│   │   └── models/              # 数据库模型
│   ├── routes/
│   │   └── tokenLaunch.ts       # Token Launch API 路由
│   └── index.ts                 # Koa 应用入口
├── package.json
├── tsconfig.json
└── README.md
```

