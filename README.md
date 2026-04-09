# Agent Evaluate

智能体评估平台 — 具备独立身份体系的数字员工管理与对话系统。

## 功能特性

- **数字员工身份体系**：每个智能体拥有 `agent.md`（元指令）、`soul.md`（人格）、`memory.md`（长期记忆）
- **实时流式对话**：WebSocket 驱动的打字机效果，支持多轮工具调用可视化
- **文件工作空间**：每个智能体独立的文件系统，支持在线编辑和文件上传
- **Skills 扩展**：向 `skills/` 目录上传文件即可扩展智能体能力
- **多模型支持**：Anthropic Claude 和 OpenAI GPT 系列
- **用户权限管理**：管理员 / 普通用户两级角色

## 快速启动

### 方式一：Docker Compose（推荐）

```bash
# 1. 复制环境变量配置
cp backend/.env.example .env

# 2. 填写 API Key
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env

# 3. 启动
docker-compose up -d

# 访问: http://localhost
# 默认账号: admin / admin123
```

### 方式二：本地开发

**后端**

```bash
cd backend
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # 填写 API Key
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

**前端**

```bash
cd frontend
npm install
npm run dev
# 访问: http://localhost:5173
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `SECRET_KEY` | JWT 签名密钥（生产环境必须修改） | `change-me-...` |
| `ANTHROPIC_API_KEY` | Anthropic API Key | — |
| `OPENAI_API_KEY` | OpenAI API Key | — |
| `WORKSPACES_DIR` | 智能体工作空间存储路径 | `./workspaces` |
| `DATABASE_URL` | SQLite 数据库路径 | `sqlite+aiosqlite:///./agent_evaluate.db` |

## 目录结构

```
X_agent-evaluate/
├── backend/                # FastAPI 后端
│   ├── core/               # 配置、数据库、认证
│   ├── models/             # SQLAlchemy 数据模型
│   ├── routers/            # API 路由
│   ├── services/           # 业务逻辑（LLM、工作空间、对话）
│   └── main.py             # 应用入口
├── frontend/               # React + Vite 前端
│   └── src/
│       ├── pages/          # 页面组件
│       ├── components/     # 通用组件
│       ├── store/          # Zustand 状态管理
│       └── utils/          # 工具函数
├── workspaces/             # 智能体工作空间（运行时生成）
└── docker-compose.yml
```

## 默认账号

首次启动时自动创建管理员账号：
- 账号：`admin`
- 密码：`admin123`

**请在生产环境中立即修改默认密码。**
