# 票据收款认领与异常挂账服务

## 一、项目用途

本服务面向企业财务部门，实现**银行回单 → 收款认领 → 应收核销**的全流程管理，解决以下业务痛点：

1. **回单批量导入**：财务人员导入银行回单文件，系统自动生成批次管理
2. **智能自动匹配**：系统按「客户+订单号+金额」多维度策略自动匹配应收单
3. **人工/拆分认领**：业务人员可人工认领，支持一张回单拆分对应多笔应收
4. **异常挂账处理**：匹配失败或有争议的回单进入挂账流程，专人处理
5. **严格校验机制**：杜绝重复认领、超额认领、客户错配、已结清再认领等违规
6. **到账状态追踪**：实时反映应收单（未付/部分/已付）和回单（待认领/部分/已认领/挂账/关闭）状态
7. **对账数据导出**：完整记录批次、认领人、差异原因、处理结果，满足审计要求
8. **数据持久一致**：所有数据JSON文件存储，服务重启后状态完全一致

---

## 二、技术栈

| 层次 | 选型 | 说明 |
|------|------|------|
| 运行时 | Node.js 18+ | JavaScript 服务端运行环境 |
| 框架 | Express 4 | 轻量级 HTTP API 框架 |
| 数据存储 | JSON 文件 | `data/` 目录下各实体独立文件，无需数据库 |
| 工具库 | dayjs、uuid | 日期格式化、ID 生成 |
| 测试 | 原生 Node 脚本 | 零依赖验收测试套件 |

---

## 三、启动方式

### 3.1 环境准备
确保机器已安装 Node.js 18 或更高版本：
```bash
node -v
```

### 3.2 安装依赖
```bash
cd /path/to/project
npm install
```

### 3.3 启动服务
```bash
npm start
```

启动成功后控制台输出：
```
================================================
  票据收款认领与异常挂账服务
  服务地址: http://localhost:3000
  健康检查: http://localhost:3000/api/health
  数据目录: /path/to/project/data
================================================
```

### 3.4 运行验收测试
（首次验证或版本迭代时执行，会清空 `data/` 目录）
```bash
npm test
```

测试通过后可看到：`🎉 全部验收测试通过！`

---

## 四、目录结构

```
lym-0638/
├── package.json              # 项目依赖和启动脚本
├── src/
│   ├── app.js                # Express 应用入口
│   ├── routes/
│   │   └── api.js            # REST API 路由定义
│   ├── services/
│   │   └── receipt-service.js # 核心业务逻辑层
│   ├── store/
│   │   └── json-store.js     # JSON 文件持久化层
│   └── utils/
│       └── constants.js      # 常量、枚举、校验函数
├── tests/
│   └── acceptance.js         # 验收测试脚本
└── data/                     # 运行时生成的 JSON 数据
    ├── batches.json          # 回单批次
    ├── receipts.json         # 银行回单
    ├── receivables.json      # 应收单
    ├── claims.json           # 认领记录
    ├── hangings.json         # 异常挂账
    ├── exports.json          # 导出记录
    └── seq.json              # ID 序列号
```

---

## 五、验收路径

执行 `npm test` 即可触发完整验收流，覆盖 **10 大场景 40+ 断言**：

### 场景一：基础数据准备
- 创建 4 张应收单（华为×2、阿里巴巴、腾讯），模拟销售端挂账

### 场景二：回单导入与批次管理
- 创建批次 → 导入 5 张回单（共 ¥295,000）
- **断言**：批次数量=5，总金额正确

### 场景三：自动匹配
- 调用自动匹配引擎
- **断言**：3 张匹配成功（华为订单1精确匹配、阿里巴巴金额匹配、腾讯精确匹配），2 张转挂账（字节跳动无对应应收、华为合并付款金额不匹配）

### 场景四：部分认领 + 撤销后余额恢复（⭐核心验收）
- 华为合并付款回单（¥60,000）拆分认领：AR2025001 ¥30,000 + AR2025002 ¥30,000
- **断言**：AR2025001 状态=partial、已认领=130,000、剩余=70,000；AR2025002 已认领=30,000
- **撤销**其中 AR2025002 的认领
- **断言**：AR2025002 已认领恢复=0、剩余恢复=50,000；回单剩余恢复=30,000

### 场景五：异常挂账处理
- 挂账 1（华为合并）：keep 保留（已通过拆分解决）
- 挂账 2（字节跳动）：reject 拒绝（无对应应收）
- **断言**：挂账状态均转为 processed

### 场景六：认领校验规则 - 拒绝场景（⭐核心验收）
- ✅ 同一回单重复认领同一应收 → 拒绝
- ✅ 认领金额超过回单剩余 → 拒绝
- ✅ 客户不匹配（华为回单领阿里巴巴应收）→ 拒绝
- ✅ 已结清应收再次认领 → 拒绝

### 场景七：未处理挂账拒绝结账
- 若存在 pending 挂账，关闭批次触发拒绝
- 处理完成后允许关闭

### 场景八：批次结清
- 关闭批次，状态=closed

### 场景九：对账导出
- 导出包含认领+挂账共 N 条记录
- **断言**：包含回单批次、认领人、差异原因、处理结果等关键字段

### 场景十：数据持久化验证（⭐核心验收）
- 重新实例化服务（模拟重启）
- **断言**：批次状态、认领记录、挂账记录、导出记录与重启前完全一致

---

## 六、关键数据流转图

```
                        ┌──────────────────┐
                        │  应收单(receivable)  │
                        │  来源: 销售/财务录入  │
                        │  状态: unpaid→partial→paid
                        └────────┬─────────┘
                                 │
                                 │  匹配
                                 ▼
  ┌──────────┐  导入    ┌──────────────────┐  认领    ┌──────────────────┐
  │ 银行回单  │────────▶│   批次(batch)    │────────▶│  认领记录(claim)   │
  │  (Excel)  │         │  → 回单(receipt)  │         │  active/revoked   │
  └──────────┘         └────────┬─────────┘         └──────────────────┘
                                │
                                │  匹配失败
                                ▼
                        ┌──────────────────┐
                        │  异常挂账(hanging) │
                        │ pending→processed │
                        └──────────────────┘
                                │
                                │  处理: claim/reject/keep
                                ▼
                    ┌────────────────────────────┐
                    │  对账导出(export)           │
                    │  批次/认领人/差异/处理结果  │
                    └────────────────────────────┘
```

### 6.1 正常到账流转

| 步骤 | 操作 | 回单状态 | 应收状态 |
|------|------|----------|----------|
| 1 | 导入回单 | `pending` | `unpaid` |
| 2 | 自动/人工认领 | `partial` | `partial` |
| 3 | 认领完成 | `claimed` | `paid` |
| 4 | 批次结账 | `closed` | - |

### 6.2 异常挂账流转

| 步骤 | 操作 | 回单状态 | 挂账状态 |
|------|------|----------|----------|
| 1 | 自动匹配失败 | `hanging` | `pending` |
| 2a | 认领处理挂账 → `claimed` | ← 认领成功 | `processed` |
| 2b | reject | 保持 `hanging` | `processed` |
| 2c | keep 暂存 | 保持 `hanging` | `processed` |

### 6.3 撤销认领回滚

```
认领(active)  ──revoke──▶  撤销(revoked)
   ▲                          │
   │  回滚金额                  │ 释放金额
回单/应收 -N               回单/应收 +N
```

---

## 七、核心实体说明

### 7.1 批次 (batches.json)
回单导入的批次单元，一个批次包含多张回单。
- `batchNo` 批次号 / `operator` 导入人 / `receiptCount` 回单数
- `totalAmount` 批次总金额 / `status` (imported→auto_matched→closed)

### 7.2 回单 (receipts.json)
银行回单明细，认领的「资金来源端」。
- `receiptNo` 回单编号 = 批次号+序号
- `customerId/Name` 付款客户 / `amount` 到账金额 / `orderNo` 附言订单号
- `status` 状态机: **pending → partial → claimed → closed**
  - 若自动匹配失败则变为 **hanging**

### 7.3 应收单 (receivables.json)
企业待收的应收账款，认领的「资金去向端」。
- `receivableNo` 应收单号 / `orderNo` 关联订单
- `status`: **unpaid → partial → paid**

### 7.4 认领记录 (claims.json)
回单→应收单的关联记录（多对多桥接表）。
- `receiptId + receivableId + amount` 三元组唯一
- `claimType`: auto(自动)/manual(人工)/split(拆分)/hanging_resolve(挂账解挂)
- `status`: **active**(生效) / **revoked**(已撤销，含撤销人、原因、时间)

### 7.5 异常挂账 (hangings.json)
- `reason` 挂账原因（自动生成或人工录入）
- `status`: **pending → processed**
- `processResult`: claim 认领成功 / reject 退回 / keep 暂存

### 7.6 导出记录 (exports.json)
记录每次对账导出的元数据和快照，满足审计追溯。

---

## 八、认领校验规则（拒绝逻辑）

所有认领操作（auto/manual/split/hanging_resolve）必经以下校验，**任一不满足即拒绝**：

| 序号 | 规则 | 错误信息 |
|------|------|----------|
| 1 | 回单状态=closed | 回单已关闭，不能认领 |
| 2 | 应收状态=paid | 应收单已结清，不能再次认领 |
| 3 | 回单.customer ≠ 应收.customer（均非空时） | 客户不匹配 |
| 4 | 同一回单+同一应收已有 active 认领 | 同一回单不能重复认领同一应收单 |
| 5 | 认领金额 > 回单剩余金额 | 认领金额超过回单剩余可认领金额 |
| 6 | 认领金额 > 应收剩余金额 | 认领金额超过应收单剩余金额 |

批次关闭额外校验：**批次下任意回单存在 pending 挂账 → 拒绝关闭**。

---

## 九、API 接口一览

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/batches` | 创建导入批次 |
| GET | `/api/batches` | 查询批次列表 |
| POST | `/api/batches/:batchNo/import` | 批量导入回单 |
| GET | `/api/batches/:batchNo/receipts` | 查批次下回单（含已认领/剩余） |
| POST | `/api/batches/:batchNo/auto-match` | 执行自动匹配 |
| POST | `/api/batches/:batchNo/close` | 关闭批次 |
| POST | `/api/receivables` | 创建应收单 |
| GET | `/api/receivables` | 查应收状态（已认领/剩余） |
| POST | `/api/claims/manual` | 人工认领 |
| POST | `/api/claims/split` | 拆分认领 |
| POST | `/api/claims/:claimId/revoke` | 撤销认领 |
| GET | `/api/claims` | 到账明细查询 |
| GET | `/api/hangings` | 挂账列表 |
| POST | `/api/hangings/:hangingId/process` | 处理挂账 |
| POST | `/api/receipts/:receiptId/close` | 关闭单张回单 |
| POST | `/api/exports/reconciliation` | 对账导出 |
| GET | `/api/exports` | 导出历史 |
| GET | `/api/health` | 健康检查 |

所有接口统一返回格式：
```json
{ "code": 0, "message": "success", "data": {...} }
```
异常时 `code=1`，`message` 为中文错误说明。

---

## 十、数据一致性保障

### 10.1 幂等更新
- `JsonStore` 所有写操作是**原子覆盖**（整文件重写），避免部分写入
- ID 自增使用独立 `seq.json`，避免重复

### 10.2 状态重算（写入后）
任何认领/撤销/挂账处理操作后，系统自动触发三项刷新：
1. **回单状态重算** → 基于该回单所有 active 认领求和
2. **应收状态重算** → 基于该应收所有 active 认领求和
3. **批次进度重算** → 统计批次下已认领回单数

保证：**冗余状态字段与明细记录永远强一致**。

### 10.3 重启一致性
- 服务启动时只读 JSON 文件，无内存初始化逻辑
- 验收场景十直接模拟：`new ReceiptService()` 读取后状态校验通过
- 如需备份，直接拷贝 `data/` 整目录即可

---

## 十一、典型业务操作示例（curl）

```bash
# 1. 健康检查
curl http://localhost:3000/api/health

# 2. 创建批次
curl -X POST http://localhost:3000/api/batches \
  -H 'Content-Type: application/json' \
  -d '{"operator":"finance_01","fileName":"bank_0620.xlsx"}'

# 3. 导入回单（假设返回的 batchNo=BXXX）
curl -X POST http://localhost:3000/api/batches/BXXX/import \
  -H 'Content-Type: application/json' \
  -d '{
    "operator":"finance_01",
    "receipts":[
      {"customerId":"C001","customerName":"华为","amount":50000,"orderNo":"ORD-001"}
    ]
  }'

# 4. 自动匹配
curl -X POST http://localhost:3000/api/batches/BXXX/auto-match \
  -H 'Content-Type: application/json' \
  -d '{"operator":"system"}'

# 5. 对账导出
curl -X POST http://localhost:3000/api/exports/reconciliation \
  -H 'Content-Type: application/json' \
  -d '{"operator":"finance_01","startDate":"2025-06-01","endDate":"2025-06-30"}'
```

---

*文档版本: v1.0 | 生成日期: 2026-06-22*
