# 专业灌溉前端需求文档

## 1. 项目定位

本项目目标是建设一个面向用户的专业灌溉前端系统。系统基于 ThingsBoard API 获取设备、遥测、属性、关系和控制能力，在前端组织成地图、地块、轮灌计划、自动策略、ET 蒸散决策和设备控制等业务模块。

当前阶段没有自建业务服务端，前端直接调用 ThingsBoard API。ThingsBoard 作为 IoT 数据与控制底座，前端负责业务视图、配置管理和用户操作体验。

## 2. 建设目标

### 2.1 业务目标

- 将设备控制台升级为专业灌溉业务系统。
- 支持按地块、分区、设备、计划和策略组织灌溉业务。
- 支持地图查看地块和设备空间分布。
- 支持轮灌计划配置和执行查看。
- 支持自动策略配置，包括墒情、雨天锁定和 ETc 触发。
- 支持 ET0、植物系数 Kc、ETc 展示与策略联动。
- 复用已有设备列表、设备详情和 RPC 控制能力。

### 2.2 技术目标

- 前端直接使用 ThingsBoard REST API、WebSocket API 和 RPC API。
- 用 ThingsBoard Asset 表示业务对象，如地块和分区。
- 用 ThingsBoard Relation 表示地块、分区和设备关系。
- 用 ThingsBoard Attributes 保存业务配置，如地块参数、轮灌计划和自动策略。
- 用 ThingsBoard Telemetry 保存实时数据和计算结果，如湿度、电量、ET0、Kc、ETc、灌溉建议。
- 用 ThingsBoard Rule Chain 承担后续自动执行能力。

## 3. 总体架构

### 3.1 系统组成

```text
BleGateway
  -> 接入 BLE 控制器与传感设备
  -> 上报遥测、属性
  -> 接收云端 RPC 控制

ThingsBoard
  -> 设备、资产、关系
  -> 遥测、属性、告警
  -> RPC 控制
  -> WebSocket 实时订阅
  -> Rule Chain 自动化

irrigation-web-spa
  -> 地图
  -> 地块
  -> 轮灌计划
  -> 自动策略
  -> ET 展示
  -> 设备中心
```

### 3.2 前端分层

```text
UI 页面层
  Dashboard / Map / Fields / Plans / Strategies / Devices

业务聚合层
  field-service / plan-service / strategy-service / et-service / map-service

ThingsBoard API 层
  auth / devices / assets / relations / attributes / telemetry / rpc / websocket

ThingsBoard 平台层
  Device / Asset / Relation / Attributes / Telemetry / Rule Chain / Alarm
```

## 4. 当前开发状态

当前 `irrigation-web-spa` 已完成第一阶段工作台骨架：

- 已新增工作台壳子和导航。
- 已新增总览、地图、地块、地块详情、轮灌计划、自动策略页面。
- 已将现有设备中心和设备详情接入新工作台。
- 已新增前端业务模型，将现有设备数据临时派生成地块、计划、策略和 ET 摘要。
- 已完成一版偏专业后台系统的 UI 风格调整。

当前尚未完成：

- 未接真实 ThingsBoard Asset/Relation/Attributes。
- 未接真实高德地图 SDK。
- 未实现地块、计划、策略的创建和保存。
- 未实现 ET0/Kc 外部 API 拉取和 Rule Chain 计算。
- 未实现轮灌计划自动执行。

## 5. 核心模块需求

## 5.1 总览模块

### 功能

- 展示当前灌溉系统整体状态。
- 展示关键指标。
- 展示重点地块。
- 展示今日计划和策略建议。

### 指标

- 地块数
- 在线设备数
- 灌溉中地块数
- 平均电量
- 平均 ET0
- 平均 ETc

### 后续增强

- 今日计划执行进度。
- 今日预计用水量。
- 今日实际用水量。
- 待处理告警。
- 近 24 小时灌溉次数。

## 5.2 地图模块

### 功能

- 使用高德地图作为国内地图底图。
- 展示地块中心点。
- 展示地块 polygon 边界。
- 展示设备点位。
- 展示地块状态。
- 支持点击地块进入详情。

### 地图图层

- 地块边界层
- 地块中心点层
- 分区层
- 控制器点位层
- 传感器点位层
- 水表点位层
- 告警层

### 状态颜色

- 正常待机：白色或浅绿色
- 灌溉中：绿色
- 需关注：橙色
- 告警：红色
- 离线：灰色

### 坐标系要求

国内地图优先使用高德地图。前端展示坐标建议统一为 GCJ-02。若设备 GPS 原始坐标为 WGS84，需要转换后再展示。

### 高德地图配置

后续需要增加环境变量：

```text
VITE_AMAP_KEY=
VITE_AMAP_SECURITY_CODE=
```

## 5.3 地块模块

### 功能

- 地块列表
- 地块详情
- 地块创建
- 地块编辑
- 地块位置维护
- 地块与分区维护
- 地块与设备绑定
- 作物信息维护
- ET 参数展示

### 地块字段

```ts
type Field = {
  id: string;
  name: string;
  code: string;
  cropType: string;
  growthStage: string;
  area: number;
  centerLat: number;
  centerLng: number;
  polygon?: Array<[number, number]>;
  soilType?: string;
  irrigationEfficiency?: number;
};
```

### ThingsBoard 映射

- ThingsBoard Asset 类型：`Field`
- 地块基础信息保存到 `SERVER_SCOPE` attributes
- 地块实时汇总保存到 telemetry

### 地块 Attributes

```json
{
  "code": "F-001",
  "cropType": "葡萄",
  "growthStage": "膨果期",
  "area": 36,
  "centerLat": 31.29834,
  "centerLng": 120.58319,
  "polygon": [[120.58, 31.29], [120.59, 31.29]],
  "soilType": "loam",
  "irrigationEfficiency": 0.85
}
```

## 5.4 分区模块

### 功能

- 在地块下维护多个灌溉分区。
- 每个分区绑定控制器设备和站点号。
- 支持分区面积、设计流量和优先级配置。
- 支持查看分区开阀状态和剩余时长。

### 分区字段

```ts
type Zone = {
  id: string;
  fieldId: string;
  name: string;
  deviceId: string;
  siteNumber: number;
  area?: number;
  designFlowRate?: number;
  priority?: number;
};
```

### ThingsBoard 映射

- ThingsBoard Asset 类型：`Zone`
- `Field -> Zone` 使用 Relation 关联
- `Zone -> Device` 使用 Relation 关联
- `siteNumber` 保存在 Zone attributes

## 5.5 设备模块

### 功能

- 设备列表
- 设备详情
- 设备在线状态
- 电量、电压
- 土壤湿度
- 雨感状态
- 阀门站点状态
- 手动连接设备
- 刷新设备状态
- 手动开阀
- 手动关阀

### 当前已支持

当前代码已经支持以下设备数据：

- `soilMoisture`
- `rainSensorWet`
- `batteryLevel`
- `batteryVoltage`
- `station1Open` 到 `station8Open`
- `station1RemainingSeconds` 到 `station8RemainingSeconds`
- `station1OpeningDurationSeconds` 到 `station8OpeningDurationSeconds`

当前代码已经支持以下控制：

- 连接设备
- 断开设备
- 刷新状态
- 指定站点开阀
- 指定站点关阀

## 5.6 轮灌计划模块

### 功能

- 计划列表
- 计划详情
- 新增计划
- 编辑计划
- 启用/停用计划
- 配置执行时段
- 配置分区执行顺序
- 配置每区灌溉时长
- 配置雨天跳过
- 手动启动计划
- 停止当前计划
- 查看执行记录

### 计划字段

```ts
type IrrigationPlan = {
  id: string;
  fieldId: string;
  name: string;
  enabled: boolean;
  scheduleType: "manual" | "daily" | "weekly";
  startTimes: string[];
  skipIfRain: boolean;
  stopIfOffline: boolean;
  zones: Array<{
    zoneId: string;
    deviceId: string;
    siteNumber: number;
    durationSeconds: number;
    order: number;
  }>;
};
```

### 存储方式

短期方案：

- 计划 JSON 存到 Field Asset 的 `SERVER_SCOPE` attributes。
- 前端读取后展示和编辑。
- 手动执行时由前端按顺序调用 RPC。

长期方案：

- 计划仍由前端配置。
- 自动执行由 ThingsBoard Rule Chain 或后续自建服务承担。
- 执行记录写入 telemetry 或独立业务记录实体。

## 5.7 自动策略模块

### 功能

- 策略列表
- 策略详情
- 新增策略
- 编辑策略
- 启用/停用策略
- 设置墒情阈值
- 设置恢复阈值
- 设置 ETc 触发阈值
- 设置雨天锁定
- 设置允许执行时段
- 设置执行模式

### 策略模式

- `advisory`：只给建议，不自动执行。
- `semi-auto`：生成建议，用户确认后执行。
- `auto`：满足条件后自动执行。

### 策略字段

```ts
type StrategyConfig = {
  id: string;
  fieldId: string;
  enabled: boolean;
  mode: "advisory" | "semi-auto" | "auto";
  moistureMin?: number;
  moistureRecover?: number;
  etcTriggerMm?: number;
  rainLockEnabled: boolean;
  allowedTimeWindows: Array<{ start: string; end: string }>;
  maxSingleDurationSeconds: number;
  action: "suggest" | "runPlan" | "openZone";
};
```

### 存储方式

- 策略配置存到 Field Asset 或 Zone Asset 的 `SERVER_SCOPE` attributes。
- 策略执行结果写 telemetry。
- 自动触发建议下沉到 ThingsBoard Rule Chain。

## 5.8 ET 模块

### 背景

ET 是专业灌溉决策的重要输入。当前需求中，标准 ET 和植物系数 Kc 都通过外部 API 获取。

### 术语

- `ET0`：标准参考蒸散量。
- `Kc`：植物系数。
- `ETc`：作物蒸散量。

计算公式：

```text
ETc = ET0 * Kc
```

### 功能

- 展示 ET0
- 展示 Kc
- 展示 ETc
- 展示更新时间
- 展示数据来源
- 按地块展示 ET 指标
- 将 ETc 作为自动策略输入
- 根据 ETc 估算建议灌溉量和灌溉时长

### 数据流

推荐方案：

```text
外部 ET API
  -> ThingsBoard REST API Call Rule Node
  -> Script Node 计算 ETc
  -> Save Timeseries
  -> 前端读取并展示
  -> 自动策略消费
```

### Telemetry 字段

```json
{
  "et0": 4.2,
  "kc": 0.82,
  "etc": 3.44,
  "dailyEtc": 3.44,
  "netIrrigationRequirement": 8.5,
  "grossIrrigationRequirement": 10.0,
  "irrigationSuggestedSeconds": 1200
}
```

## 5.9 告警模块

### 功能

- 设备离线告警
- 网关离线告警
- 低电量告警
- 湿度过低告警
- 湿度过高告警
- 开阀无流量告警
- 阀门控制失败告警
- 雨天禁灌提醒

### 后续页面

后续可新增 `/alarms` 页面，集中展示和筛选告警。

## 6. ThingsBoard API 使用规划

## 6.1 登录

```http
POST /api/auth/login
```

用途：

- 用户登录
- 获取 JWT token
- 后续 REST API 使用 token

## 6.2 设备查询

用途：

- 查询设备列表
- 查询设备详情
- 查询设备活动状态

常用接口：

```http
GET /api/tenant/devices
GET /api/customer/{customerId}/devices
GET /api/device/info/{deviceId}
```

## 6.3 资产查询

用途：

- 查询地块
- 查询分区
- 创建地块
- 创建分区

常用接口：

```http
GET /api/tenant/assets
POST /api/asset
GET /api/asset/{assetId}
```

## 6.4 关系查询

用途：

- 查询 Field 下的 Zone。
- 查询 Zone 绑定的 Device。
- 建立 Field、Zone、Device 的关系。

常用接口：

```http
POST /api/relations
GET /api/relations/info
GET /api/relations
DELETE /api/relation
```

## 6.5 Attributes

用途：

- 保存地块配置。
- 保存轮灌计划。
- 保存自动策略。
- 保存设备目标配置。

常用 scope：

- `SERVER_SCOPE`
- `SHARED_SCOPE`
- `CLIENT_SCOPE`

示例：

```http
GET /api/plugins/telemetry/{entityType}/{entityId}/values/attributes/SERVER_SCOPE
POST /api/plugins/telemetry/{entityType}/{entityId}/SERVER_SCOPE
```

## 6.6 Telemetry

用途：

- 获取最新遥测。
- 获取历史曲线。
- 保存 ET 计算结果。
- 展示地块状态。

常用接口：

```http
GET /api/plugins/telemetry/{entityType}/{entityId}/values/timeseries
POST /api/plugins/telemetry/{entityType}/{entityId}/timeseries
```

## 6.7 RPC 控制

用途：

- 开阀
- 关阀
- 连接设备
- 断开设备
- 刷新状态

常用接口：

```http
POST /api/plugins/rpc/oneway/{deviceId}
POST /api/plugins/rpc/twoway/{deviceId}
```

当前已有控制方法：

- `ble_connectDevice`
- `ble_requestDeviceState`
- `openValve`

## 6.8 WebSocket

用途：

- 实时订阅设备遥测和属性变化。
- 更新设备列表和设备详情。

## 7. 数据模型规划

### 7.1 Entity 类型

| 业务对象 | ThingsBoard 类型 | 说明 |
| --- | --- | --- |
| 农场 | Asset | 可选，后续多农场时使用 |
| 地块 | Asset | Field |
| 分区 | Asset | Zone |
| 网关 | Device | BLE 网关 |
| 控制器 | Device | 阀门控制器 |
| 土壤传感器 | Device | 墒情数据 |
| 水表 | Device | 流量和用水量 |
| 雨感 | Device | 雨天锁定 |

### 7.2 Relation 类型

| From | To | Relation Type |
| --- | --- | --- |
| Farm | Field | Contains |
| Field | Zone | Contains |
| Zone | Device | Contains |
| Gateway | Device | Manages |

## 8. 页面路由规划

当前路由：

```text
/dashboard
/map
/fields
/fields/:fieldId
/plans
/strategies
/devices
/devices/:deviceId
/login
```

后续可新增：

```text
/plans/:planId
/strategies/:strategyId
/alarms
/settings
```

## 9. UI 设计原则

### 9.1 风格定位

- 专业后台系统。
- 信息密度适中。
- 避免营销式大标题。
- 避免大段说明文案。
- 保持清晰、稳定、可维护。
- 重点突出设备状态、地块状态、计划状态和策略结果。

### 9.2 页面原则

- 顶部只显示当前模块和必要操作。
- 侧边栏只保留品牌和导航。
- 总览页优先展示指标和待处理对象。
- 地图页以地图为主，不堆叠无关说明。
- 地块页以卡片和状态为主。
- 设备详情页保留操作面板，但减少技术词。

### 9.3 用户可见文案原则

避免直接显示以下内部技术词：

- ThingsBoard
- WebSocket
- RPC
- Rule Chain
- Telemetry
- Attribute
- Asset
- Relation

除非是在调试页面或开发配置页面。

## 10. 开发阶段计划

### Phase 1：工作台骨架

状态：已完成基础版本。

- 新工作台壳子
- 总览
- 地图骨架
- 地块列表
- 地块详情
- 轮灌计划列表
- 自动策略列表
- 设备中心接入
- 设备详情接入

### Phase 2：真实地块模型

目标：

- 接入 ThingsBoard Asset API。
- 创建和编辑 Field。
- 创建和编辑 Zone。
- 建立 Field -> Zone -> Device 关系。
- 把当前前端派生数据替换为真实资产数据。

### Phase 3：真实高德地图

目标：

- 接入高德地图 JS API。
- 展示真实地块中心点。
- 展示地块 polygon。
- 展示设备点位。
- 支持点击地块进入详情。
- 支持地图筛选和状态着色。

### Phase 4：轮灌计划配置

目标：

- 新增计划表单。
- 保存计划到 Field attributes。
- 前端可手动启动轮灌计划。
- 记录计划执行状态。

### Phase 5：自动策略配置

目标：

- 新增策略表单。
- 保存策略到 Field attributes。
- 支持 advisory、semi-auto、auto 三种模式。
- 前端展示策略命中结果。

### Phase 6：ET 接入

目标：

- 接入外部 ET0 API。
- 接入植物系数 Kc API。
- 在 ThingsBoard 中计算 ETc。
- 前端展示 ET 指标和建议灌溉量。

### Phase 7：自动执行

目标：

- 使用 ThingsBoard Rule Chain 执行自动判断。
- 满足策略时触发计划或开阀。
- 支持告警和执行记录。

## 11. 当前优先级

最高优先级：

1. 接入真实 ThingsBoard Asset/Relation/Attributes。
2. 完成地块和分区的创建、编辑和设备绑定。
3. 接入高德地图。
4. 完成轮灌计划配置。
5. 完成自动策略配置。
6. 接入 ET0/Kc/ETc 数据链路。

## 12. 风险与限制

### 12.1 无自建服务端限制

当前没有自建服务端，因此：

- 前端直接持有用户 token。
- 复杂业务查询需要多次调用 ThingsBoard API。
- 计划自动执行不能依赖浏览器长期在线。
- 多租户复杂权限会受到 ThingsBoard 权限模型限制。

### 12.2 免费账户限制

如果使用 ThingsBoard Cloud 免费账户：

- 设备数量有限。
- Asset 数量有限。
- 数据点数量有限。
- API 调用可能受限。

因此免费账户适合验证和小规模测试，不适合大规模正式部署。

### 12.3 轮灌执行风险

如果轮灌计划只在前端执行：

- 浏览器关闭后计划会中断。
- 网络断开后无法继续执行。

长期应将自动执行下沉到 ThingsBoard Rule Chain 或后续自建服务。

## 13. 验收标准

### Phase 1 验收

- 用户登录后进入专业灌溉工作台。
- 能查看总览指标。
- 能进入地图、地块、计划、策略、设备页面。
- 设备列表和设备详情仍能正常使用。
- 页面不出现明显面向开发者的技术文案。
- 生产构建通过。

### Phase 2 验收

- 能创建地块。
- 能创建分区。
- 能将分区绑定到设备和站点号。
- 能从地块详情查看对应设备和分区状态。
- 刷新页面后配置仍存在。

### Phase 3 验收

- 地图能显示真实地块点位。
- 地图能显示地块边界。
- 点击地块可进入详情。
- 地块状态能在地图上体现。

### Phase 4 验收

- 能创建轮灌计划。
- 能编辑执行顺序和时长。
- 能保存计划。
- 能手动启动计划。
- 能停止计划。

### Phase 5 验收

- 能创建自动策略。
- 能配置墒情阈值、ETc 阈值、雨天锁定。
- 能保存策略。
- 能在地块详情中看到策略状态。

### Phase 6 验收

- 能展示 ET0。
- 能展示 Kc。
- 能展示 ETc。
- 能展示建议灌溉量或时长。
- ET 指标可参与策略判断。

