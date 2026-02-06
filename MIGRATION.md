# 后端迁移完成总结

## ✅ 已完成的工作

### 1. 后端项目结构 (`backend/`)
- ✅ Koa 应用 (`src/index.ts`)
- ✅ 数据库配置和模型 (`src/db/`)
- ✅ 索引器 (`src/indexer/tokenLaunchIndexer.ts`)
- ✅ Token Launch 工具函数 (`src/tokenLaunch/releaseCurve.ts`)
- ✅ API 路由 (`src/routes/tokenLaunch.ts`)

### 2. 后端 API 接口

#### ✅ `/api/token-launch/my-token` (GET)
- 获取用户创建的 token 列表

#### ✅ `/api/token-launch/metadata` (POST)
- 更新 allocations 和 vestings 的标签

#### ✅ `/api/token-launch/records` (GET)
- 获取完整的 token launch 记录（包含配置、分配、vesting 详情）

#### ✅ `/api/token-launch/release-curve` (GET)
- 获取 token 的 vesting release curve

### 3. Next.js API Routes 改为转发

所有 Next.js API routes 现在都转发到后端：
- ✅ `/api/token-launch/metadata` → 转发到后端
- ✅ `/api/token-launch/records` → 转发到后端
- ✅ `/api/token-launch/release-curve` → 转发到后端
- ✅ `/api/check-approve` → 保留在 Next.js（只调用外部 API，不涉及数据库）

### 4. Next.js 页面更新

- ✅ `src/app/token-launch/my-token/page.tsx` - 改为调用后端 API

## 📦 安装依赖

### 后端依赖

```bash
cd backend
pnpm install
```

### 前端依赖

Next.js 项目不再需要 `mysql2` 和 `sequelize`（如果不再使用），但为了兼容性可以保留。

## 🔧 配置

### 后端环境变量 (`backend/.env`)

```env
MYSQL_HOST=47.238.155.188
MYSQL_PORT=33016
MYSQL_DATABASE=assetslink
MYSQL_USER=root
MYSQL_PASSWORD=your_password

# 或使用 MYSQL_URL
# MYSQL_URL=mysql://user:password@host:port/database

PORT=3001
```

### 前端环境变量 (Netlify 或 `.env.local`)

```env
NEXT_PUBLIC_API_BASE_URL=https://your-backend-domain.com
# 或服务器端变量
API_BASE_URL=https://your-backend-domain.com
```

## 🚀 启动

### 后端

```bash
cd backend
pnpm dev  # 开发模式
# 或
pnpm build && pnpm start  # 生产模式
```

### 前端

```bash
pnpm dev  # 开发模式
```

## 📝 注意事项

1. **索引器** (`backend/src/indexer/tokenLaunchIndexer.ts`) 需要单独运行，不在 API 服务中
2. **数据库连接** 现在完全在后端，Next.js 不再直接连接数据库
3. **API 转发** Next.js API routes 只是转发请求，不处理业务逻辑
4. **类型错误** 如果看到 TypeScript 类型错误，先运行 `pnpm install` 安装依赖

## 🔄 迁移的文件

### 从 `src/server/` 迁移到 `backend/src/`:

- `src/server/db/**` → `backend/src/db/**`
- `src/server/indexer/tokenLaunchIndexer.ts` → `backend/src/indexer/tokenLaunchIndexer.ts`
- `src/server/tokenLaunch/releaseCurve.ts` → `backend/src/tokenLaunch/releaseCurve.ts`

### Next.js API Routes 改为转发:

- `src/app/api/token-launch/metadata/route.ts` - 转发到后端
- `src/app/api/token-launch/records/route.ts` - 转发到后端
- `src/app/api/token-launch/release-curve/route.ts` - 转发到后端

## ✅ 验证

1. 启动后端服务：`cd backend && pnpm dev`
2. 启动前端服务：`pnpm dev`
3. 访问 `http://localhost:3000/token-launch/my-token?address=0x...`
4. 检查后端日志确认 API 调用成功

