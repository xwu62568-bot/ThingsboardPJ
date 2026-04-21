#!/usr/bin/env node

/**
 * Create or update a ThingsBoard rule chain for professional irrigation.
 *
 * Required env:
 *   TB_USERNAME=tenant@thingsboard.org
 *   TB_PASSWORD=...
 *
 * Optional env:
 *   TB_BASE_URL=https://thingsboard.cloud
 *   TB_RULE_CHAIN_NAME=专业灌溉执行链
 *   TB_RULE_CHAIN_METADATA=./rule-chain-metadata.json
 *   TB_TRIGGER_MODE=scheduler|generator
 *   TB_ENABLE_FIELD_TICK_GENERATORS=1
 *   TB_FIELD_ASSET_IDS=assetId1,assetId2
 *   TB_TICK_PERIOD_SECONDS=60
 *   TB_SCHEDULER_EVENT_TYPE=IRRIGATION_PLAN_TICK
 *   TB_SCHEDULER_EVENT_PREFIX=专业灌溉巡检：
 *   TB_SCHEDULER_TIMEZONE=Asia/Shanghai
 *   TB_RULE_CHAIN_DRY_RUN=1
 *
 * Notes:
 * - Run this from a trusted local/CI environment, not from the browser.
 * - The default mode creates one inspection Scheduler Event for each Field asset.
 *   Plan Scheduler Events are created by the frontend when auto plans are saved.
 *   Scheduler messages enter the Root Rule Chain, so you must route messages with
 *   metadata.irrigation = fieldInspect, planSchedule or zoneAdvance to this rule chain.
 * - Use TB_TRIGGER_MODE=generator only for CE/local fallback. Generator nodes
 *   live inside this rule chain and do not require Root Rule Chain forwarding.
 * - If the ThingsBoard node schemas in your Cloud version differ, export a
 *   verified metadata JSON from ThingsBoard and pass TB_RULE_CHAIN_METADATA.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

await loadDotEnv(path.resolve(process.cwd(), ".env"));

const BASE_URL = normalizeBaseUrl(process.env.TB_BASE_URL || process.env.VITE_TB_BASE_URL || "https://thingsboard.cloud");
const USERNAME = process.env.TB_USERNAME || "";
const PASSWORD = process.env.TB_PASSWORD || "";
const RULE_CHAIN_NAME = process.env.TB_RULE_CHAIN_NAME || "专业灌溉执行链";
const METADATA_PATH = process.env.TB_RULE_CHAIN_METADATA || "";
const DRY_RUN = process.env.TB_RULE_CHAIN_DRY_RUN === "1";
const TRIGGER_MODE = normalizeTriggerMode(process.env.TB_TRIGGER_MODE || "");
const ENABLE_FIELD_TICK_GENERATORS = TRIGGER_MODE === "generator";
const FIELD_ASSET_IDS = parseCsv(process.env.TB_FIELD_ASSET_IDS || "");
const FIELD_ASSET_TYPE = process.env.TB_FIELD_ASSET_TYPE || "Field";
const TICK_PERIOD_SECONDS = Math.max(60, Number(process.env.TB_TICK_PERIOD_SECONDS || 60) || 60);
const SCHEDULER_EVENT_TYPE = process.env.TB_SCHEDULER_EVENT_TYPE || "IRRIGATION_PLAN_TICK";
const SCHEDULER_EVENT_PREFIX = process.env.TB_SCHEDULER_EVENT_PREFIX || "专业灌溉巡检：";
const SCHEDULER_TIMEZONE = process.env.TB_SCHEDULER_TIMEZONE || "Asia/Shanghai";
const UPDATE_ROOT_RULE_CHAIN = process.env.TB_UPDATE_ROOT_RULE_CHAIN !== "0";
const DEBUG_NODE_NAMES = parseCsv(
  process.env.TB_DEBUG_NODE_NAMES ||
    "需要更新今日 ET0,准备 ET0 请求,记录 ET0 请求尝试,保存 ET0 请求尝试,获取 Open-Meteo ET0,计算 ETc,写入 ET telemetry,保存 ET0 更新日期,生成基础轮灌命令,存在待执行命令,准备 REST 响应,写入执行状态,准备设备 RPC,切换到目标设备,下发开阀命令,记录执行命令,未执行原因",
);
const DEBUG_ALL_NODES = process.env.TB_DEBUG_ALL_NODES === "1";
const DEBUG_UNTIL_MS = Date.now() + Math.max(1, Number(process.env.TB_DEBUG_HOURS || 72) || 72) * 60 * 60 * 1000;

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function main() {
  if (!USERNAME || !PASSWORD) {
    throw new Error("缺少 TB_USERNAME 或 TB_PASSWORD 环境变量");
  }

  const token = await login();
  const existing = await findRuleChain(token, RULE_CHAIN_NAME);
  const ruleChain = existing ?? (await createRuleChain(token, RULE_CHAIN_NAME));
  const ruleChainId = extractId(ruleChain.id);

  if (!ruleChainId) {
    throw new Error("ThingsBoard 未返回规则链 ID");
  }

  const nodeTypes = await resolveRuleNodeTypes(token);
  const fieldAssets = !METADATA_PATH
    ? await fetchFieldAssets(token, FIELD_ASSET_IDS)
    : [];
  const metadata = METADATA_PATH
    ? await loadMetadataFile(METADATA_PATH, ruleChainId)
    : buildDefaultMetadata(ruleChainId, nodeTypes, fieldAssets, {
        includeGenerators: ENABLE_FIELD_TICK_GENERATORS,
      });

  if (DRY_RUN) {
    const schedulerEvents = TRIGGER_MODE === "scheduler"
      ? fieldAssets.map((field, index) => buildSchedulerEventPayload(field, index))
      : [];
    console.log(JSON.stringify({ ruleChain, fieldAssets, metadata, schedulerEvents }, null, 2));
    return;
  }

  const expectedNodeCount = Array.isArray(metadata.nodes) ? metadata.nodes.length : 0;
  const saveResult = await saveRuleChainMetadata(token, metadata);
  const savedMetadata = await getRuleChainMetadata(token, ruleChainId);
  const savedNodeCount = Array.isArray(savedMetadata?.nodes) ? savedMetadata.nodes.length : 0;

  if (expectedNodeCount > 0 && savedNodeCount === 0) {
    throw new Error(
      [
        "规则链已创建，但节点 metadata 没有保存成功。",
        `保存接口返回节点数：${Array.isArray(saveResult?.nodes) ? saveResult.nodes.length : 0}`,
        "请确认当前 ThingsBoard 账号是 TENANT_ADMIN，并且当前版本支持 /api/ruleChain/metadata 写入。",
        "也可以在 ThingsBoard 中手动导出一个规则链 JSON，再通过 TB_RULE_CHAIN_METADATA 指定导出的 metadata 文件重新执行。",
      ].join("\n"),
    );
  }

  const rootUpdateResult = UPDATE_ROOT_RULE_CHAIN
    ? await updateRootRuleChainForwarding(token, ruleChainId, nodeTypes)
    : { updated: false, reason: "disabled" };

  let schedulerEvents = [];
  if (TRIGGER_MODE === "scheduler" && fieldAssets.length > 0) {
    schedulerEvents = await upsertFieldSchedulerEvents(token, fieldAssets);
  }

  console.log(`规则链已配置：${RULE_CHAIN_NAME}`);
  console.log(`Rule Chain ID：${ruleChainId}`);
  console.log(`节点数量：${savedNodeCount}`);
  if (UPDATE_ROOT_RULE_CHAIN) {
    console.log(`Root 转发：${rootUpdateResult.updated ? "已配置" : `未修改（${rootUpdateResult.reason}）`}`);
  }
  if (TRIGGER_MODE === "scheduler") {
    console.log(`地块调度器：${schedulerEvents.length} 个，每 ${TICK_PERIOD_SECONDS} 秒触发一次`);
    console.log(`Scheduler 类型：${SCHEDULER_EVENT_TYPE}`);
    console.log("注意：Scheduler 事件会先进入 Root Rule Chain，需要在 Root Rule Chain 转发 metadata.irrigation=fieldInspect、planSchedule 或 zoneAdvance 到本规则链。");
    console.log("ET 更新：fieldInspect 会每 6 小时每地块调用一次 Open-Meteo，计算 ETc 并写入 Field telemetry。");
    console.log(`预估 Root 消息：约 ${estimateMonthlyTicks(fieldAssets.length)} 条/月`);
  } else if (ENABLE_FIELD_TICK_GENERATORS) {
    console.log(`地块定时器：${fieldAssets.length} 个，每 ${TICK_PERIOD_SECONDS} 秒触发一次`);
    console.log(`预估规则节点执行：约 ${estimateMonthlyExecutions(fieldAssets.length, savedNodeCount)} 次/月`);
  }
}

async function login() {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });

  if (!response.ok) {
    throw new Error(`ThingsBoard 登录失败：${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  if (!data.token) {
    throw new Error("ThingsBoard 登录响应中没有 token");
  }
  return data.token;
}

async function findRuleChain(token, name) {
  const data = await tbRequest(token, `/api/ruleChains?pageSize=100&page=0&textSearch=${encodeURIComponent(name)}`);
  const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return rows.find((item) => item?.name === name) ?? null;
}

async function findRootRuleChain(token) {
  const data = await tbRequest(token, "/api/ruleChains?pageSize=100&page=0&textSearch=Root%20Rule%20Chain");
  const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return rows.find((item) => item?.root === true) ??
    rows.find((item) => item?.name === "Root Rule Chain") ??
    null;
}

async function createRuleChain(token, name) {
  return tbRequest(token, "/api/ruleChain", {
    method: "POST",
    body: JSON.stringify({
      name,
      type: "CORE",
      root: false,
      debugMode: false,
      additionalInfo: {
        description: "专业灌溉计划执行链。计划配置由前端写入 Field 资产的 rotationPlans 属性。",
      },
    }),
  });
}

async function saveRuleChainMetadata(token, metadata) {
  return tbRequest(token, "/api/ruleChain/metadata?updateRelated=false", {
    method: "POST",
    body: JSON.stringify(metadata),
  });
}

async function getRuleChainMetadata(token, ruleChainId) {
  return tbRequest(token, `/api/ruleChain/${ruleChainId}/metadata`);
}

async function updateRootRuleChainForwarding(token, targetRuleChainId, nodeTypes) {
  const rootRuleChain = await findRootRuleChain(token);
  const rootRuleChainId = extractId(rootRuleChain?.id);
  if (!rootRuleChainId) {
    return { updated: false, reason: "root rule chain not found" };
  }

  const metadata = normalizeImportedMetadata(await getRuleChainMetadata(token, rootRuleChainId));
  const nodes = Array.isArray(metadata.nodes) ? metadata.nodes : [];
  const connections = Array.isArray(metadata.connections) ? metadata.connections : [];
  if (nodes.length === 0) {
    return { updated: false, reason: "root metadata has no nodes" };
  }

  let existingTargetIndex = nodes.findIndex((node) =>
    node?.type === nodeTypes.ruleChain &&
    extractId(node?.configuration?.ruleChainId) === targetRuleChainId,
  );
  let existingFilterIndex = nodes.findIndex((node) => node?.name === "专业灌溉消息");
  let existingReplyTransformIndex = nodes.findIndex((node) => node?.name === "专业灌溉 REST 响应");
  let existingReplyIndex = nodes.findIndex((node) => node?.name === "返回专业灌溉触发结果");

  const switchIndex = nodes.findIndex((node) => node?.type === nodeTypes.messageTypeSwitch || node?.name === "Message Type Switch");
  if (switchIndex < 0) {
    return { updated: false, reason: "message type switch not found" };
  }

  const otherConnectionIndex = connections.findIndex((connection) => connection.fromIndex === switchIndex && connection.type === "Other");
  let originalOtherTarget = otherConnectionIndex >= 0 ? connections[otherConnectionIndex].toIndex : -1;
  if (existingFilterIndex >= 0 && originalOtherTarget === existingFilterIndex) {
    const existingFalseConnection = connections.find((connection) =>
      connection.fromIndex === existingFilterIndex &&
      connection.type === "False" &&
      connection.toIndex !== existingFilterIndex &&
      connection.toIndex !== switchIndex,
    );
    originalOtherTarget = existingFalseConnection?.toIndex ?? nodes.findIndex((node) => node?.name === "Log Other");
  }

  const incomingToSwitch = connections
    .map((connection, index) => ({ ...connection, index }))
    .filter((connection) =>
      connection.toIndex === switchIndex &&
      connection.fromIndex !== existingFilterIndex,
    );

  if (incomingToSwitch.length === 0 && otherConnectionIndex < 0) {
    return { updated: false, reason: "message type switch incoming branch not found" };
  }
  if (existingFilterIndex < 0) {
    existingFilterIndex = nodes.length;
    nodes.push(createRuleNode({
      type: nodeTypes.filter,
      name: "专业灌溉消息",
      x: 760,
      y: 700,
      configuration: {
        jsScript: buildRootIrrigationFilterScript(),
      },
      description: "识别专业灌溉 fieldInspect、planSchedule、zoneAdvance 和手动执行消息。",
    }));
  } else {
    nodes[existingFilterIndex].configuration = withScriptDefaults({
      jsScript: buildRootIrrigationFilterScript(),
    });
  }
  enableNodeDebug(nodes[existingFilterIndex]);
  if (existingTargetIndex < 0) {
    existingTargetIndex = nodes.length;
    nodes.push(createRuleNode({
      type: nodeTypes.ruleChain,
      name: `转发到${RULE_CHAIN_NAME}`,
      x: 1010,
      y: 700,
      configuration: {
        ruleChainId: targetRuleChainId,
        forwardMsgToDefaultRuleChain: false,
      },
      description: "将专业灌溉消息转发到专业灌溉执行链。",
    }));
  } else {
    nodes[existingTargetIndex].configuration = {
      ruleChainId: targetRuleChainId,
      forwardMsgToDefaultRuleChain: false,
    };
  }
  enableNodeDebug(nodes[existingTargetIndex]);
  if (existingReplyTransformIndex < 0) {
    existingReplyTransformIndex = nodes.length;
    nodes.push(createRuleNode({
      type: nodeTypes.transform,
      name: "专业灌溉 REST 响应",
      x: 1010,
      y: 820,
      configuration: {
        jsScript: buildRootRestReplyPayloadScript(),
      },
      description: "立即回复前端 Rule Engine REST 触发请求，避免 408。",
    }));
  }
  enableNodeDebug(nodes[existingReplyTransformIndex]);
  if (existingReplyIndex < 0) {
    existingReplyIndex = nodes.length;
    nodes.push(createRuleNode({
      type: nodeTypes.restApiReply,
      name: "返回专业灌溉触发结果",
      x: 1260,
      y: 820,
      configuration: {
        serviceIdMetaDataAttribute: "serviceId",
        requestIdMetaDataAttribute: "requestUUID",
      },
      description: "向前端返回专业灌溉消息已接收。",
    }));
  }
  enableNodeDebug(nodes[existingReplyIndex]);

  if (otherConnectionIndex >= 0 && connections[otherConnectionIndex].toIndex === existingFilterIndex) {
    connections[otherConnectionIndex] = {
      fromIndex: switchIndex,
      toIndex: originalOtherTarget >= 0 && originalOtherTarget !== existingFilterIndex ? originalOtherTarget : switchIndex,
      type: "Other",
    };
  }
  for (const connection of incomingToSwitch) {
    connections[connection.index] = {
      fromIndex: connection.fromIndex,
      toIndex: existingFilterIndex,
      type: connection.type,
    };
  }
  upsertConnection(connections, existingFilterIndex, existingTargetIndex, "True");
  upsertConnection(connections, existingFilterIndex, existingReplyTransformIndex, "True");
  upsertConnection(connections, existingFilterIndex, switchIndex, "False");
  upsertConnection(connections, existingReplyTransformIndex, existingReplyIndex, "Success");
  const safeConnections = connections.filter((connection) =>
    connection.fromIndex !== connection.toIndex &&
    connection.toIndex >= 0 &&
    !(connection.fromIndex === existingFilterIndex && connection.type === "False" && connection.toIndex !== switchIndex),
  );

  await saveRuleChainMetadata(token, {
    ...metadata,
    ruleChainId: {
      entityType: "RULE_CHAIN",
      id: rootRuleChainId,
    },
    nodes,
    connections: safeConnections,
    ruleChainConnections: metadata.ruleChainConnections || [],
  });

  return { updated: true, reason: "configured" };
}

async function fetchSchedulerEvents(token) {
  const rows = await tbRequest(token, `/api/schedulerEvents?type=${encodeURIComponent(SCHEDULER_EVENT_TYPE)}`);
  return Array.isArray(rows) ? rows : [];
}

async function upsertFieldSchedulerEvents(token, fieldAssets) {
  const existingEvents = await fetchSchedulerEvents(token);
  const savedEvents = [];

  for (let index = 0; index < fieldAssets.length; index += 1) {
    const field = fieldAssets[index];
    const expectedName = getSchedulerEventName(field);
    const matchingEvents = existingEvents.filter((event) => {
      const fieldId = event?.configuration?.metadata?.fieldId || event?.additionalInfo?.fieldId;
      const triggerMode = event?.additionalInfo?.triggerMode || event?.configuration?.metadata?.irrigation;
      return (event?.name === expectedName || fieldId === field.id) && triggerMode !== "planSchedule";
    });
    const existing = matchingEvents
      .slice()
      .sort((left, right) => Number(right?.createdTime || 0) - Number(left?.createdTime || 0))[0];
    const duplicateEvents = matchingEvents.filter((event) => extractId(event?.id) !== extractId(existing?.id));
    for (const duplicate of duplicateEvents) {
      await deleteSchedulerEvent(token, duplicate);
    }
    const payload = buildSchedulerEventPayload(field, index, existing);
    savedEvents.push(await saveSchedulerEvent(token, payload));
  }

  return savedEvents;
}

async function deleteSchedulerEvent(token, event) {
  const id = extractId(event?.id);
  if (!id) {
    return;
  }
  await tbRequest(token, `/api/schedulerEvent/${id}`, {
    method: "DELETE",
  });
}

async function saveSchedulerEvent(token, event) {
  return tbRequest(token, "/api/schedulerEvent", {
    method: "POST",
    body: JSON.stringify(event),
  });
}

async function loadMetadataFile(filePath, ruleChainId) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const raw = await readFile(absolutePath, "utf8");
  const metadata = normalizeImportedMetadata(JSON.parse(raw));
  return {
    ...metadata,
    ruleChainId: {
      entityType: "RULE_CHAIN",
      id: ruleChainId,
    },
  };
}

function normalizeImportedMetadata(payload) {
  if (payload?.metadata && typeof payload.metadata === "object") {
    return payload.metadata;
  }
  return payload;
}

async function resolveRuleNodeTypes(token) {
  return {
    generator: "org.thingsboard.rule.engine.action.TbMsgGeneratorNode",
    originatorAttributes: "org.thingsboard.rule.engine.metadata.TbGetAttributesNode",
    transform: "org.thingsboard.rule.engine.transform.TbTransformMsgNode",
    filter: "org.thingsboard.rule.engine.filter.TbJsFilterNode",
    restApiCall: "org.thingsboard.rule.engine.rest.TbRestApiCallNode",
    restApiReply: "org.thingsboard.rule.engine.rest.TbSendRestApiCallReplyNode",
    ruleChain: "org.thingsboard.rule.engine.flow.TbRuleChainInputNode",
    messageTypeSwitch: "org.thingsboard.rule.engine.filter.TbMsgTypeSwitchNode",
    saveTimeseries: "org.thingsboard.rule.engine.telemetry.TbMsgTimeseriesNode",
    saveAttributes: "org.thingsboard.rule.engine.telemetry.TbMsgAttributesNode",
    changeOriginator: "org.thingsboard.rule.engine.transform.TbChangeOriginatorNode",
    rpcRequest: "org.thingsboard.rule.engine.rpc.TbSendRPCRequestNode",
    log: "org.thingsboard.rule.engine.action.TbLogNode",
  };
}

async function fetchRuleNodeComponents(token) {
  const data = await tbRequest(token, "/api/components?componentTypes=ACTION,FILTER,ENRICHMENT,TRANSFORMATION&ruleChainType=CORE");
  if (Array.isArray(data)) {
    return data;
  }
  return Array.isArray(data?.data) ? data.data : [];
}

function findComponentClazz(components, name) {
  const normalizedName = name.toLowerCase();
  const item = components.find((component) => {
    const names = [
      component?.name,
      component?.configurationDescriptor?.nodeDefinition?.name,
      component?.configurationDescriptor?.nodeDefinition?.details,
    ]
      .map((value) => String(value || "").toLowerCase())
      .filter(Boolean);
    return names.some((value) => value === normalizedName || value.includes(normalizedName));
  });
  return typeof item?.clazz === "string"
    ? item.clazz
    : typeof item?.componentDescriptorClazz === "string"
      ? item.componentDescriptorClazz
      : "";
}

async function fetchFieldAssets(token, allowedIds) {
  const rows = await fetchRowsWithFallback(token, [
    `/api/tenant/assets?pageSize=100&page=0&type=${encodeURIComponent(FIELD_ASSET_TYPE)}`,
    `/api/tenant/assets?pageSize=100&page=0&assetType=${encodeURIComponent(FIELD_ASSET_TYPE)}`,
  ]);
  return rows
    .map((item) => ({
      id: extractId(item?.id),
      name: typeof item?.name === "string" ? item.name : "未命名地块",
    }))
    .filter((item) => item.id)
    .filter((item) => allowedIds.length === 0 || allowedIds.includes(item.id));
}

async function fetchRowsWithFallback(token, paths) {
  let lastError = null;
  for (const pathName of paths) {
    try {
      const data = await tbRequest(token, pathName);
      if (Array.isArray(data)) {
        return data;
      }
      if (Array.isArray(data?.data)) {
        return data.data;
      }
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) {
    throw lastError;
  }
  return [];
}

function buildDefaultMetadata(ruleChainId, nodeTypes, fieldAssets, options = {}) {
  const includeGenerators = options.includeGenerators === true;
  const generatorNodes = includeGenerators ? fieldAssets.map((field, index) =>
    createRuleNode({
      type: nodeTypes.generator,
      name: `定时触发：${field.name}`,
      x: 80,
      y: 80 + index * 80,
      configuration: {
        msgCount: 0,
        periodInSeconds: TICK_PERIOD_SECONDS,
        originatorType: "ASSET",
        originatorId: field.id,
        jsScript: buildGeneratorScript(field),
      },
      description: `每 ${TICK_PERIOD_SECONDS} 秒为地块 ${field.name} 生成一次计划检查消息。`,
    }),
  ) : [];

  const baseStartIndex = generatorNodes.length;
  const baseNodes = [
    createRuleNode({
      type: nodeTypes.originatorAttributes,
      name: "读取地块配置",
      x: 80,
      y: 260,
      configuration: {
        fetchTo: "DATA",
        clientAttributeNames: [],
        sharedAttributeNames: [],
        serverAttributeNames: [
          "rotationPlans",
          "automationStrategies",
          "manualExecutionRequest",
          "manualExecutionRequestConsumedId",
          "irrigationExecutionState",
          "automationExecutionState",
          "deviceMarkers",
          "zones",
          "areaMu",
          "centerLat",
          "centerLng",
          "kc",
          "irrigationEfficiency",
          "lastEt0FetchSlot",
          "lastEt0FetchAttemptSlot",
          "lastEt0FetchAttemptAt",
          "lastEt0FetchAttemptCount",
        ],
        latestTsKeyNames: ["soilMoisture", "rainSensorWet", "et0", "etc", "rainfallForecastMm"],
        tellFailureIfAbsent: false,
        getLatestValueWithTs: false,
      },
      description: "读取 Field 资产属性中的计划、策略、设备标记和执行状态。",
    }),
    createRuleNode({
      type: nodeTypes.filter,
      name: "需要更新今日 ET0",
      x: 330,
      y: 60,
      configuration: {
        jsScript: buildEt0UpdateNeededScript(),
      },
      description: "巡检触发时，每个地块每 6 小时最多请求一次 Open-Meteo ET0。",
    }),
    createRuleNode({
      type: nodeTypes.transform,
      name: "准备 ET0 请求",
      x: 580,
      y: 60,
      configuration: {
        jsScript: buildEt0RequestScript(),
      },
      description: "生成 Open-Meteo 请求 URL，并保留地块 Kc、坐标和当天日期。",
    }),
    createRuleNode({
      type: nodeTypes.restApiCall,
      name: "获取 Open-Meteo ET0",
      x: 1080,
      y: 60,
      configuration: buildRestApiCallConfiguration("${openMeteoUrl}"),
      description: "调用 Open-Meteo 获取 FAO ET0。",
    }),
    createRuleNode({
      type: nodeTypes.transform,
      name: "记录 ET0 请求尝试",
      x: 830,
      y: 60,
      configuration: {
        jsScript: buildEt0AttemptAttributesScript(),
      },
      description: "请求 Open-Meteo 前先记录本 6 小时时间槽，避免失败后每分钟重试导致限流。",
    }),
    createRuleNode({
      type: nodeTypes.transform,
      name: "计算 ETc",
      x: 1330,
      y: 60,
      configuration: {
        jsScript: buildEtcTelemetryScript(),
      },
      description: "从 Open-Meteo 响应中提取今日 ET0，按 Kc 计算 ETc。",
    }),
    createRuleNode({
      type: nodeTypes.saveTimeseries,
      name: "写入 ET telemetry",
      x: 1580,
      y: 60,
      configuration: buildSaveTimeseriesConfiguration(),
      description: "写入 et0、kc、etc、et0UpdatedAt 到 Field telemetry。",
    }),
    createRuleNode({
      type: nodeTypes.transform,
      name: "记录 ET0 日期",
      x: 1830,
      y: 60,
      configuration: {
        jsScript: buildEt0DateAttributesScript(),
      },
      description: "把 lastEt0FetchSlot 写入 Field SERVER_SCOPE，防止 6 小时内重复请求。",
    }),
    createRuleNode({
      type: nodeTypes.saveAttributes,
      name: "保存 ET0 更新日期",
      x: 2080,
      y: 60,
      configuration: {
        scope: "SERVER_SCOPE",
        notifyDevice: false,
        sendAttributesUpdatedNotification: true,
        updateAttributesOnlyOnValueChange: true,
        processingSettings: {
          type: "ON_EVERY_MESSAGE",
        },
      },
      description: "保存 lastEt0FetchSlot。",
    }),
    createRuleNode({
      type: nodeTypes.saveAttributes,
      name: "保存 ET0 请求尝试",
      x: 1080,
      y: 150,
      configuration: {
        scope: "SERVER_SCOPE",
        notifyDevice: false,
        sendAttributesUpdatedNotification: true,
        updateAttributesOnlyOnValueChange: true,
        processingSettings: {
          type: "ON_EVERY_MESSAGE",
        },
      },
      description: "保存 lastEt0FetchAttemptSlot。",
    }),
    createRuleNode({
      type: nodeTypes.transform,
      name: "生成基础轮灌命令",
      x: 330,
      y: 260,
      configuration: {
        jsScript: buildPlanCommandScript(),
      },
      description: "计划到点或自动策略命中后，按分区顺序生成下一条 openValve 命令。",
    }),
    createRuleNode({
      type: nodeTypes.filter,
      name: "存在待执行命令",
      x: 580,
      y: 260,
      configuration: {
        jsScript: "return !!(msg && msg.nextCommand && msg.nextCommand.deviceName);",
      },
      description: "没有到点计划、策略不允许、未绑定设备名或计划完成时不继续执行。",
    }),
    createRuleNode({
      type: nodeTypes.transform,
      name: "准备 REST 响应",
      x: 830,
      y: 610,
      configuration: {
        jsScript: buildRestReplyPayloadScript(),
      },
      description: "为 /api/rule-engine 触发请求返回同步响应，避免前端 408。",
    }),
    createRuleNode({
      type: nodeTypes.restApiReply,
      name: "返回前端触发结果",
      x: 1080,
      y: 610,
      configuration: {
        serviceIdMetaDataAttribute: "serviceId",
        requestIdMetaDataAttribute: "requestUUID",
      },
      description: "向 Rule Engine REST API 调用方返回已接收结果。",
    }),
    createRuleNode({
      type: nodeTypes.transform,
      name: "写入执行状态",
      x: 830,
      y: 190,
      configuration: {
        jsScript: buildExecutionStateAttributesScript(),
      },
      description: "转换为 Field 资产 SERVER_SCOPE 属性写入消息。",
    }),
    createRuleNode({
      type: nodeTypes.saveAttributes,
      name: "保存地块执行状态",
      x: 1080,
      y: 190,
      configuration: {
        scope: "SERVER_SCOPE",
        notifyDevice: false,
        sendAttributesUpdatedNotification: true,
        updateAttributesOnlyOnValueChange: false,
        processingSettings: {
          type: "ON_EVERY_MESSAGE",
        },
      },
      description: "保存 irrigationExecutionState 和 lastIrrigationCommand。",
    }),
    createRuleNode({
      type: nodeTypes.transform,
      name: "准备设备 RPC",
      x: 830,
      y: 330,
      configuration: {
        jsScript: buildRpcPayloadScript(),
      },
      description: "转换为 RPC 请求格式，并设置 metadata.targetDeviceName。",
    }),
    createRuleNode({
      type: nodeTypes.changeOriginator,
      name: "切换到目标设备",
      x: 1080,
      y: 330,
      configuration: {
        originatorSource: "ENTITY",
        entityType: "DEVICE",
        entityNamePattern: "${targetDeviceName}",
      },
      description: "RPC 节点要求 originator 是 DEVICE，因此按设备名切换 originator。",
    }),
    createRuleNode({
      type: nodeTypes.rpcRequest,
      name: "下发开阀命令",
      x: 1330,
      y: 330,
      configuration: {
        timeoutInSeconds: 30,
      },
      description: "向目标设备发送 openValve RPC。",
    }),
    createRuleNode({
      type: nodeTypes.log,
      name: "记录执行命令",
      x: 1580,
      y: 330,
      configuration: {
        jsScript:
          "return 'Irrigation command: ' + JSON.stringify(msg) + ', target=' + metadata.targetDeviceName;",
      },
      description: "记录已下发命令。",
    }),
    createRuleNode({
      type: nodeTypes.log,
      name: "未执行原因",
      x: 830,
      y: 470,
      configuration: {
        jsScript: "return 'Irrigation skipped: ' + (msg && msg.skipReason ? msg.skipReason : 'no command');",
      },
      description: "记录未生成执行命令的原因。",
    }),
  ];

  const nodes = [...generatorNodes, ...baseNodes];
  const readFieldIndex = baseStartIndex;
  const etNeededIndex = baseStartIndex + 1;
  const etRequestIndex = baseStartIndex + 2;
  const etRestIndex = baseStartIndex + 3;
  const etAttemptAttributesIndex = baseStartIndex + 4;
  const etcTelemetryIndex = baseStartIndex + 5;
  const saveEtTelemetryIndex = baseStartIndex + 6;
  const etDateAttributesIndex = baseStartIndex + 7;
  const saveEtDateIndex = baseStartIndex + 8;
  const saveEtAttemptIndex = baseStartIndex + 9;
  const planIndex = baseStartIndex + 10;
  const hasCommandIndex = baseStartIndex + 11;
  const restReplyTransformIndex = baseStartIndex + 12;
  const restReplyIndex = baseStartIndex + 13;
  const stateTransformIndex = baseStartIndex + 14;
  const saveStateIndex = baseStartIndex + 15;
  const rpcTransformIndex = baseStartIndex + 16;
  const changeOriginatorIndex = baseStartIndex + 17;
  const rpcIndex = baseStartIndex + 18;
  const commandLogIndex = baseStartIndex + 19;
  const skipLogIndex = baseStartIndex + 20;

  return {
    ruleChainId: {
      entityType: "RULE_CHAIN",
      id: ruleChainId,
    },
    firstNodeIndex: generatorNodes.length > 0 ? 0 : readFieldIndex,
    nodes,
    connections: [
      ...generatorNodes.map((_, index) => ({
        fromIndex: index,
        toIndex: readFieldIndex,
        type: "Success",
      })),
      {
        fromIndex: readFieldIndex,
        toIndex: planIndex,
        type: "Success",
      },
      {
        fromIndex: readFieldIndex,
        toIndex: etNeededIndex,
        type: "Success",
      },
      {
        fromIndex: etNeededIndex,
        toIndex: etRequestIndex,
        type: "True",
      },
      {
        fromIndex: etRequestIndex,
        toIndex: etAttemptAttributesIndex,
        type: "Success",
      },
      {
        fromIndex: etAttemptAttributesIndex,
        toIndex: saveEtAttemptIndex,
        type: "Success",
      },
      {
        fromIndex: saveEtAttemptIndex,
        toIndex: etRestIndex,
        type: "Success",
      },
      {
        fromIndex: etRestIndex,
        toIndex: etcTelemetryIndex,
        type: "Success",
      },
      {
        fromIndex: etcTelemetryIndex,
        toIndex: saveEtTelemetryIndex,
        type: "Success",
      },
      {
        fromIndex: saveEtTelemetryIndex,
        toIndex: etDateAttributesIndex,
        type: "Success",
      },
      {
        fromIndex: etDateAttributesIndex,
        toIndex: saveEtDateIndex,
        type: "Success",
      },
      {
        fromIndex: planIndex,
        toIndex: hasCommandIndex,
        type: "Success",
      },
      {
        fromIndex: hasCommandIndex,
        toIndex: stateTransformIndex,
        type: "True",
      },
      {
        fromIndex: hasCommandIndex,
        toIndex: restReplyTransformIndex,
        type: "True",
      },
      {
        fromIndex: hasCommandIndex,
        toIndex: restReplyTransformIndex,
        type: "False",
      },
      {
        fromIndex: restReplyTransformIndex,
        toIndex: restReplyIndex,
        type: "Success",
      },
      {
        fromIndex: stateTransformIndex,
        toIndex: saveStateIndex,
        type: "Success",
      },
      {
        fromIndex: hasCommandIndex,
        toIndex: rpcTransformIndex,
        type: "True",
      },
      {
        fromIndex: rpcTransformIndex,
        toIndex: changeOriginatorIndex,
        type: "Success",
      },
      {
        fromIndex: changeOriginatorIndex,
        toIndex: rpcIndex,
        type: "Success",
      },
      {
        fromIndex: rpcIndex,
        toIndex: commandLogIndex,
        type: "Success",
      },
      {
        fromIndex: hasCommandIndex,
        toIndex: skipLogIndex,
        type: "False",
      },
    ],
    ruleChainConnections: [],
  };
}

function createRuleNode({ type, name, x, y, configuration, description }) {
  const debugEnabled = DEBUG_ALL_NODES || DEBUG_NODE_NAMES.includes(name);
  return {
    type,
    name,
    debugMode: debugEnabled,
    debugSettings: debugEnabled ? buildNodeDebugSettings() : null,
    singletonMode: false,
    queueName: null,
    configurationVersion: 0,
    configuration: withScriptDefaults(configuration),
    additionalInfo: {
      description,
      layoutX: x,
      layoutY: y,
    },
    externalId: null,
  };
}

function buildNodeDebugSettings() {
  return {
    failuresEnabled: true,
    allEnabled: true,
    allEnabledUntil: DEBUG_UNTIL_MS,
  };
}

function enableNodeDebug(node) {
  if (!node || typeof node !== "object") {
    return;
  }
  node.debugMode = true;
  node.debugSettings = buildNodeDebugSettings();
}

function withScriptDefaults(configuration) {
  if (!configuration || typeof configuration !== "object" || !("jsScript" in configuration)) {
    return configuration;
  }

  return {
    ...configuration,
    scriptLang: "JS",
    jsScript: configuration.jsScript,
    tbelScript: configuration.tbelScript || "",
  };
}

function buildRestApiCallConfiguration(urlPattern) {
  return {
    restEndpointUrlPattern: urlPattern,
    requestMethod: "GET",
    useSimpleClientHttpFactory: true,
    parseToPlainText: false,
    ignoreRequestBody: true,
    headers: {},
    maxParallelRequestsCount: 16,
    readTimeoutMs: 10000,
  };
}

function buildSaveTimeseriesConfiguration() {
  return {
    defaultTTL: 0,
    skipLatestPersistence: false,
    useServerTs: false,
    processingSettings: {
      type: "ON_EVERY_MESSAGE",
    },
  };
}

function buildGeneratorScript(field) {
  return `
var now = Date.now();
return {
  msg: {
    ts: now,
    fieldId: "${field.id}",
    fieldName: "${escapeForScript(field.name)}"
  },
  metadata: {
    irrigation: "planTick",
    ts: String(now),
    fieldId: "${field.id}",
    fieldName: "${escapeForScript(field.name)}"
  },
  msgType: "CUSTOM"
};
`.trim();
}

function buildEt0UpdateNeededScript() {
  return `
var triggerKind = String(metadata.irrigation || msg.irrigation || "");
var triggerMode = String(metadata.triggerMode || msg.triggerMode || "");
var planId = String(metadata.planId || msg.planId || "");
if (!triggerKind && triggerMode === "fieldInspect") {
  triggerKind = "fieldInspect";
}
if (!triggerKind && msgType === "CUSTOM" && !planId) {
  triggerKind = "fieldInspect";
}
var lastFetchSlot = String(metadata.lastEt0FetchSlot || metadata.ss_lastEt0FetchSlot || msg.lastEt0FetchSlot || msg.ss_lastEt0FetchSlot || "");
var lastAttemptSlot = String(metadata.lastEt0FetchAttemptSlot || metadata.ss_lastEt0FetchAttemptSlot || msg.lastEt0FetchAttemptSlot || msg.ss_lastEt0FetchAttemptSlot || "");
var lastAttemptAt = toNumber(metadata.lastEt0FetchAttemptAt || metadata.ss_lastEt0FetchAttemptAt || msg.lastEt0FetchAttemptAt || msg.ss_lastEt0FetchAttemptAt) || 0;
var lastAttemptCount = toNumber(metadata.lastEt0FetchAttemptCount || metadata.ss_lastEt0FetchAttemptCount || msg.lastEt0FetchAttemptCount || msg.ss_lastEt0FetchAttemptCount) || 0;
var lat = toNumber(metadata.centerLat || metadata.ss_centerLat || msg.centerLat || msg.ss_centerLat);
var lng = toNumber(metadata.centerLng || metadata.ss_centerLng || msg.centerLng || msg.ss_centerLng);
var now = Date.now();
var currentSlot = formatSixHourSlot(now);
var retryDelayMs = 30 * 60 * 1000;
var maxAttempts = 5;

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (e) {
      return fallback;
    }
  }
  return value;
}

function toNumber(value) {
  var parsed = parseJson(value, value);
  var numberValue = Number(parsed);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function formatSixHourSlot(ts) {
  var date = new Date(ts);
  var slotHour = Math.floor(date.getUTCHours() / 6) * 6;
  return date.toISOString().slice(0, 10) + "T" + String(slotHour).padStart(2, "0");
}

return triggerKind === "fieldInspect" &&
  lat !== null &&
  lng !== null &&
  lastFetchSlot !== currentSlot &&
  (lastAttemptSlot !== currentSlot ||
    (lastAttemptCount < maxAttempts && now - lastAttemptAt >= retryDelayMs));
`.trim();
}

function buildEt0RequestScript() {
  return `
var lat = toNumber(metadata.centerLat || metadata.ss_centerLat || msg.centerLat || msg.ss_centerLat);
var lng = toNumber(metadata.centerLng || metadata.ss_centerLng || msg.centerLng || msg.ss_centerLng);
var kc = toNumber(metadata.kc || metadata.ss_kc || msg.kc || msg.ss_kc);
var today = formatDate(Date.now());
var slot = formatSixHourSlot(Date.now());
var url = "https://api.open-meteo.com/v1/forecast?latitude=" + encodeURIComponent(String(lat)) +
  "&longitude=" + encodeURIComponent(String(lng)) +
  "&daily=et0_fao_evapotranspiration&timezone=auto";

metadata.openMeteoUrl = url;
metadata.et0FetchDate = today;
metadata.et0FetchSlot = slot;
metadata.kc = String(kc !== null && kc > 0 ? kc : 0.8);
metadata.fieldLat = String(lat);
metadata.fieldLng = String(lng);

msg.openMeteoUrl = url;
msg.et0FetchDate = today;
msg.et0FetchSlot = slot;
msg.kc = kc !== null && kc > 0 ? kc : 0.8;

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (e) {
      return fallback;
    }
  }
  return value;
}

function toNumber(value) {
  var parsed = parseJson(value, value);
  var numberValue = Number(parsed);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function formatDate(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function formatSixHourSlot(ts) {
  var date = new Date(ts);
  var slotHour = Math.floor(date.getUTCHours() / 6) * 6;
  return date.toISOString().slice(0, 10) + "T" + String(slotHour).padStart(2, "0");
}

return { msg: msg, metadata: metadata, msgType: msgType };
`.trim();
}

function buildEt0AttemptAttributesScript() {
  return `
var slot = String(metadata.et0FetchSlot || msg.et0FetchSlot || "");
var previousSlot = String(metadata.lastEt0FetchAttemptSlot || metadata.ss_lastEt0FetchAttemptSlot || msg.lastEt0FetchAttemptSlot || msg.ss_lastEt0FetchAttemptSlot || "");
var previousCount = toNumber(metadata.lastEt0FetchAttemptCount || metadata.ss_lastEt0FetchAttemptCount || msg.lastEt0FetchAttemptCount || msg.ss_lastEt0FetchAttemptCount) || 0;
var nextCount = previousSlot === slot ? previousCount + 1 : 1;

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (e) {
      return fallback;
    }
  }
  return value;
}

function toNumber(value) {
  var parsed = parseJson(value, value);
  var numberValue = Number(parsed);
  return Number.isFinite(numberValue) ? numberValue : null;
}

return {
  msg: {
    lastEt0FetchAttemptSlot: slot,
    lastEt0FetchAttemptAt: Date.now(),
    lastEt0FetchAttemptCount: nextCount,
    lastEt0FetchAttemptSource: "open-meteo"
  },
  metadata: metadata,
  msgType: "POST_ATTRIBUTES_REQUEST"
};
`.trim();
}

function buildEtcTelemetryScript() {
  return `
var payload = parseJson(msg.body || msg.response || msg, msg);
var daily = payload && payload.daily ? payload.daily : {};
var times = Array.isArray(daily.time) ? daily.time : [];
var values = Array.isArray(daily.et0_fao_evapotranspiration) ? daily.et0_fao_evapotranspiration : [];
var targetDate = String(metadata.et0FetchDate || "");
var index = times.indexOf(targetDate);
if (index < 0) {
  index = 0;
}
var et0 = toNumber(values[index]);
var kc = toNumber(metadata.kc);
if (kc === null || kc <= 0) {
  kc = 0.8;
}
if (et0 === null) {
  throw new Error("Open-Meteo ET0 响应中没有有效 et0_fao_evapotranspiration");
}
var etc = round(et0 * kc, 2);
var now = Date.now();
metadata.et0FetchDate = targetDate;
metadata.et0 = String(round(et0, 2));
metadata.kc = String(kc);
metadata.etc = String(etc);

return {
  msg: {
    ts: now,
    values: {
      et0: round(et0, 2),
      kc: kc,
      etc: etc,
      et0UpdatedAt: now,
      et0Source: "open-meteo"
    }
  },
  metadata: metadata,
  msgType: "POST_TELEMETRY_REQUEST"
};

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (e) {
      return fallback;
    }
  }
  return value;
}

function toNumber(value) {
  var parsed = parseJson(value, value);
  var numberValue = Number(parsed);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function round(value, digits) {
  var factor = Math.pow(10, digits || 0);
  return Math.round(value * factor) / factor;
}
`.trim();
}

function buildEt0DateAttributesScript() {
  return `
return {
  msg: {
    lastEt0FetchDate: metadata.et0FetchDate,
    lastEt0FetchSlot: metadata.et0FetchSlot,
    lastEt0Source: "open-meteo"
  },
  metadata: metadata,
  msgType: "POST_ATTRIBUTES_REQUEST"
};
`.trim();
}

function buildRootIrrigationFilterScript() {
  return `
var body = msg;
if (typeof body === "string") {
  try {
    body = JSON.parse(body);
  } catch (e) {
    body = {};
  }
}
body = body && typeof body === "object" ? body : {};
var irrigation = String(metadata.irrigation || body.irrigation || "");
var triggerMode = String(metadata.triggerMode || body.triggerMode || "");
return irrigation === "fieldInspect" ||
  irrigation === "planSchedule" ||
  irrigation === "zoneAdvance" ||
  irrigation === "manualExecution" ||
  triggerMode === "manualExecution" ||
  msgType === "REST_API_REQUEST" ||
  msgType === "CUSTOM";
`.trim();
}

function buildRootRestReplyPayloadScript() {
  return `
var body = msg;
if (typeof body === "string") {
  try {
    body = JSON.parse(body);
  } catch (e) {
    body = {};
  }
}
body = body && typeof body === "object" ? body : {};
return {
  msg: {
    accepted: true,
    source: "root",
    irrigation: metadata.irrigation || body.irrigation || "",
    triggerMode: metadata.triggerMode || body.triggerMode || "",
    fieldId: metadata.fieldId || body.fieldId || "",
    planId: metadata.planId || body.planId || "",
    requestId: metadata.requestId || body.requestId || "",
    at: Date.now()
  },
  metadata: metadata,
  msgType: msgType
};
`.trim();
}

function upsertConnection(connections, fromIndex, toIndex, type) {
  const exists = connections.some((connection) =>
    connection.fromIndex === fromIndex &&
    connection.toIndex === toIndex &&
    connection.type === type,
  );
  if (!exists) {
    connections.push({ fromIndex, toIndex, type });
  }
}

function buildSchedulerEventPayload(field, index, existing = null) {
  const payload = {
    name: getSchedulerEventName(field),
    type: SCHEDULER_EVENT_TYPE,
    originatorId: {
      entityType: "ASSET",
      id: field.id,
    },
    msgType: "CUSTOM",
    msgBody: {
      fieldId: field.id,
      fieldName: field.name,
    },
    metadata: {
      irrigation: "fieldInspect",
      fieldId: field.id,
      fieldName: field.name,
      ruleChainName: RULE_CHAIN_NAME,
    },
    schedule: {
      timezone: SCHEDULER_TIMEZONE,
      startTime: getSchedulerStartTime(index),
      repeat: {
        type: "TIMER",
        endsOn: 0,
        repeatInterval: TICK_PERIOD_SECONDS,
        timeUnit: "SECONDS",
      },
    },
    configuration: {
      originatorId: {
        entityType: "ASSET",
        id: field.id,
      },
      msgType: "CUSTOM",
      msgBody: {
        fieldId: field.id,
        fieldName: field.name,
      },
      metadata: {
        irrigation: "fieldInspect",
        fieldId: field.id,
        fieldName: field.name,
        ruleChainName: RULE_CHAIN_NAME,
      },
    },
    additionalInfo: {
      source: "irrigation-web-spa",
      triggerMode: "fieldInspect",
      fieldId: field.id,
      fieldName: field.name,
      ruleChainName: RULE_CHAIN_NAME,
      note: "Root Rule Chain must route metadata.irrigation=fieldInspect or planSchedule to this rule chain.",
    },
  };

  if (existing?.id) {
    payload.id = existing.id;
  }

  return payload;
}

function getSchedulerEventName(field) {
  return `${SCHEDULER_EVENT_PREFIX}${field.name}`;
}

function getSchedulerStartTime(index) {
  const now = Date.now();
  const nextMinute = Math.ceil(now / 60000) * 60000;
  const staggerMs = (index % 10) * 1000;
  return nextMinute + staggerMs;
}

function buildPlanCommandScript() {
  return `
var now = Number(metadata.ts || msg.ts || Date.now());
var fieldId = String(metadata.fieldId || msg.fieldId || "");
var triggerKind = String(metadata.irrigation || msg.irrigation || "");
var triggerMode = String(metadata.triggerMode || msg.triggerMode || "");
if (!triggerKind && msgType === "REST_API_REQUEST") {
  triggerKind = "manualExecution";
}
if (!triggerKind && msgType === "CUSTOM") {
  triggerKind = "fieldInspect";
}
var triggeredPlanId = String(metadata.planId || msg.planId || "");
var triggeredExecutionId = String(metadata.executionId || msg.executionId || "");
var triggeredZoneIndex = toNumber(metadata.zoneIndex || msg.zoneIndex);
var triggeredSchedulerEventId = String(metadata.schedulerEventId || msg.schedulerEventId || "");
var rotationPlans = toArray(metadata.rotationPlans || metadata.ss_rotationPlans || msg.rotationPlans || msg.ss_rotationPlans);
var automationStrategies = toArray(metadata.automationStrategies || metadata.ss_automationStrategies || msg.automationStrategies || msg.ss_automationStrategies);
var manualExecutionRequest = toObject(metadata.manualExecutionRequest || metadata.ss_manualExecutionRequest || msg.manualExecutionRequest || msg.ss_manualExecutionRequest);
var manualExecutionRequestConsumedId = String(metadata.manualExecutionRequestConsumedId || metadata.ss_manualExecutionRequestConsumedId || msg.manualExecutionRequestConsumedId || msg.ss_manualExecutionRequestConsumedId || "");
var executionState = toObject(metadata.irrigationExecutionState || metadata.ss_irrigationExecutionState || msg.irrigationExecutionState || msg.ss_irrigationExecutionState);
var deviceMarkers = toArray(metadata.deviceMarkers || metadata.ss_deviceMarkers || msg.deviceMarkers || msg.ss_deviceMarkers);
var soilMoisture = toNumber(metadata.soilMoisture || metadata.latest_soilMoisture || msg.soilMoisture || msg.latest_soilMoisture);
var rainSensorWet = toBoolean(metadata.rainSensorWet || metadata.latest_rainSensorWet || msg.rainSensorWet || msg.latest_rainSensorWet);
var et0 = toNumber(metadata.et0 || metadata.latest_et0 || msg.et0 || msg.latest_et0);
var etc = toNumber(metadata.etc || metadata.latest_etc || msg.etc || msg.latest_etc);
var rainfallForecastMm = toNumber(metadata.rainfallForecastMm || metadata.latest_rainfallForecastMm || msg.rainfallForecastMm || msg.latest_rainfallForecastMm);
var kc = toNumber(metadata.kc || metadata.ss_kc || msg.kc || msg.ss_kc);
var areaMu = toNumber(metadata.areaMu || metadata.ss_areaMu || msg.areaMu || msg.ss_areaMu);
msg.debug = {
  triggerKind: triggerKind,
  triggeredPlanId: triggeredPlanId,
  triggeredExecutionId: triggeredExecutionId,
  triggeredZoneIndex: triggeredZoneIndex,
  triggeredSchedulerEventId: triggeredSchedulerEventId,
  triggerMode: triggerMode,
  fieldId: fieldId,
  msgType: msgType,
  manualRequestId: manualExecutionRequest.id,
  consumedManualRequestId: manualExecutionRequestConsumedId,
  rotationPlanCount: rotationPlans.length,
  automationStrategyCount: automationStrategies.length,
  executionStatus: executionState.status,
  executionPlanId: executionState.planId
};

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (e) {
      return fallback;
    }
  }
  return value;
}

function toArray(value) {
  var parsed = parseJson(value, []);
  return Array.isArray(parsed) ? parsed : [];
}

function toObject(value) {
  var parsed = parseJson(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function toNumber(value) {
  var parsed = parseJson(value, value);
  var numberValue = Number(parsed);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function toBoolean(value) {
  if (value === true || value === "true") {
    return true;
  }
  if (value === false || value === "false") {
    return false;
  }
  return false;
}

function parseStartAt(value) {
  var parts = String(value || "00:00").split(":");
  return {
    hour: Number(parts[0] || 0),
    minute: Number(parts[1] || 0)
  };
}

function isDue(plan, ts) {
  if (!plan || !plan.enabled) {
    return false;
  }
  if (plan.mode !== "auto") {
    return false;
  }
  var date = new Date(ts);
  var start = parseStartAt(plan.startAt);
  if (date.getHours() !== start.hour || date.getMinutes() !== start.minute) {
    return false;
  }
  if (plan.scheduleType === "weekly") {
    var day = date.getDay() === 0 ? 7 : date.getDay();
    return Array.isArray(plan.weekdays) && plan.weekdays.indexOf(day) >= 0;
  }
  if (plan.scheduleType === "interval") {
    var days = Math.max(1, Number(plan.intervalDays || 1));
    var epochDays = Math.floor(ts / 86400000);
    return epochDays % days === 0;
  }
  return true;
}

function isScheduleDateAllowed(plan, ts) {
  if (!plan || !plan.enabled || plan.mode !== "auto") {
    return false;
  }
  var date = new Date(ts);
  if (plan.scheduleType === "weekly") {
    var day = date.getDay() === 0 ? 7 : date.getDay();
    return Array.isArray(plan.weekdays) && plan.weekdays.indexOf(day) >= 0;
  }
  return true;
}

function findManualExecutionPlan() {
  var requestId = String(manualExecutionRequest.id || "");
  var requestPlanId = String(manualExecutionRequest.planId || "");
  if (!requestId || !requestPlanId || requestId === manualExecutionRequestConsumedId) {
    return null;
  }
  return rotationPlans.find(function(plan) {
    return plan && plan.id === requestPlanId && plan.enabled !== false;
  }) || null;
}

function findTriggeredStrategy() {
  var activeStrategies = automationStrategies.filter(function(strategy) {
    return strategy && strategy.enabled !== false && strategy.mode === "auto";
  });
  if (activeStrategies.length === 0) {
    return null;
  }

  for (var i = 0; i < activeStrategies.length; i += 1) {
    var strategy = activeStrategies[i];
    if (strategy.rainLockEnabled && (rainSensorWet || rainfallForecastMm > 0)) {
      continue;
    }
    if (isStrategyCoolingDown(strategy)) {
      continue;
    }
    var type = strategy.type || "threshold";
    if (type === "threshold") {
      if (soilMoisture !== null && soilMoisture < Number(strategy.moistureMin || 0)) {
        return {
          reason: "土壤湿度低于阈值",
          strategy: strategy
        };
      }
      continue;
    }
    if (type === "etc") {
      var calculatedEtc = etc !== null ? etc : et0 !== null && kc !== null ? et0 * kc : null;
      var effectiveRain = rainfallForecastMm !== null
        ? rainfallForecastMm * Number(strategy.effectiveRainfallRatio || 0)
        : 0;
      var deficit = calculatedEtc !== null ? calculatedEtc - effectiveRain : null;
      if (deficit !== null && deficit >= Number(strategy.etcTriggerMm || 0)) {
        return {
          reason: "ETc 缺水达到阈值",
          strategy: strategy,
          deficitMm: deficit,
        };
      }
      continue;
    }
  }

  return null;
}

function isStrategyCoolingDown(strategy) {
  var state = toObject(metadata.automationExecutionState || metadata.ss_automationExecutionState || msg.automationExecutionState || msg.ss_automationExecutionState);
  var strategyState = toObject(state[strategy.id]);
  var minHours = Math.max(0, Number(strategy.minIntervalHours || 0));
  var lastStartedAt = Number(strategyState.lastStartedAt || 0);
  return minHours > 0 && lastStartedAt > 0 && now - lastStartedAt < minHours * 3600000;
}

function normalizePlanZones(plan) {
  return normalizeExecutableZones(Array.isArray(plan && plan.zones) ? plan.zones : []);
}

function normalizeStrategyZones(strategy) {
  var fieldZones = toArray(metadata.zones || metadata.ss_zones || msg.zones || msg.ss_zones);
  var scopedIds = Array.isArray(strategy && strategy.zoneIds) ? strategy.zoneIds : [];
  var sourceZones = fieldZones.filter(function(zone) {
    if (!zone || zone.enabled === false) {
      return false;
    }
    return strategy.scope !== "zones" || scopedIds.indexOf(zone.id) >= 0;
  }).map(function(zone, index) {
    var binding = Array.isArray(zone.deviceBindings) && zone.deviceBindings.length > 0 ? zone.deviceBindings[0] : null;
    var deviceId = zone.deviceId || (binding && binding.deviceId) || "";
    var siteNumber = Number(zone.siteNumber || zone.valveSiteNumber || (binding && binding.siteNumber) || 0);
    return {
      zoneId: zone.id,
      zoneName: zone.name,
      deviceId: deviceId,
      siteNumber: siteNumber,
      order: index + 1,
      durationMinutes: Number(strategy.maxDurationMinutes || 10),
      enabled: true
    };
  });
  return normalizeExecutableZones(sourceZones);
}

function normalizeExecutableZones(sourceZones) {
  return sourceZones
    .filter(function(zone) {
      return zone && zone.enabled !== false && zone.deviceId && Number(zone.siteNumber) > 0;
    })
    .map(function(zone) {
      if (zone.deviceName) {
        return zone;
      }
      var marker = deviceMarkers.find(function(item) {
        return item && item.deviceId === zone.deviceId;
      });
      var next = {};
      for (var key in zone) {
        next[key] = zone[key];
      }
      next.deviceName = marker && marker.name ? marker.name : "";
      return next;
    })
    .filter(function(zone) {
      return !!zone.deviceName;
    })
    .sort(function(left, right) {
      return Number(left.order || left.siteNumber || 0) - Number(right.order || right.siteNumber || 0);
    });
}

function activeExecutionReady(state, ts) {
  return state && state.status === "running" && Number(state.nextRunAt || 0) <= ts;
}

function buildStrategyPlan(triggered) {
  if (!triggered || !triggered.strategy) {
    return null;
  }
  var strategy = triggered.strategy;
  return {
    id: "strategy:" + strategy.id,
    name: strategy.name || "自动策略",
    enabled: true,
    mode: "auto",
    source: "strategy",
    strategyId: strategy.id,
    executionMode: strategy.executionMode || (strategy.type === "etc" ? "etc" : "duration"),
    targetWaterM3PerMu: strategy.targetWaterM3PerMu,
    flowRateM3h: strategy.flowRateM3h,
    irrigationEfficiency: strategy.irrigationEfficiency,
    maxDurationMinutes: strategy.maxDurationMinutes,
    zones: normalizeStrategyZones(strategy),
    policy: {
      reason: triggered.reason,
      strategyId: strategy.id,
      strategyName: strategy.name,
      strategyType: strategy.type || "threshold",
      deficitMm: triggered.deficitMm,
      replenishRatio: strategy.replenishRatio
    }
  };
}

function calculateDurationSeconds(plan, zone, zoneCount, policy) {
  if (plan && plan.executionMode === "quota") {
    var safeAreaMu = areaMu !== null && areaMu > 0 ? areaMu : 1;
    var safeZoneCount = Math.max(1, zoneCount || 1);
    var targetWaterM3PerMu = Math.max(0.1, Number(plan.targetWaterM3PerMu || 5));
    var flowRateM3h = Math.max(0.1, Number(plan.flowRateM3h || 2));
    var efficiency = Math.min(1, Math.max(0.1, Number(plan.irrigationEfficiency || metadata.irrigationEfficiency || metadata.ss_irrigationEfficiency || msg.irrigationEfficiency || msg.ss_irrigationEfficiency || 0.85)));
    var maxMinutes = Math.max(1, Number(plan.maxDurationMinutes || zone.durationMinutes || 60));
    var zoneWaterM3 = safeAreaMu / safeZoneCount * targetWaterM3PerMu;
    var minutes = zoneWaterM3 / flowRateM3h / efficiency * 60;
    return Math.max(60, Math.round(Math.min(minutes, maxMinutes) * 60));
  }

  if (policy && policy.deficitMm !== undefined && plan && plan.executionMode === "etc") {
    var etcAreaMu = areaMu !== null && areaMu > 0 ? areaMu : 1;
    var etcZoneCount = Math.max(1, zoneCount || 1);
    var replenishRatio = Math.min(1, Math.max(0.1, Number(policy.replenishRatio || 0.8)));
    var etcFlowRateM3h = Math.max(0.1, Number(plan.flowRateM3h || 2));
    var etcEfficiency = Math.min(1, Math.max(0.1, Number(plan.irrigationEfficiency || metadata.irrigationEfficiency || metadata.ss_irrigationEfficiency || msg.irrigationEfficiency || msg.ss_irrigationEfficiency || 0.85)));
    var etcMaxMinutes = Math.max(1, Number(plan.maxDurationMinutes || zone.durationMinutes || 60));
    var waterM3PerMu = Number(policy.deficitMm || 0) * replenishRatio * 0.6667;
    var etcMinutes = etcAreaMu / etcZoneCount * waterM3PerMu / etcFlowRateM3h / etcEfficiency * 60;
    return Math.max(60, Math.round(Math.min(etcMinutes, etcMaxMinutes) * 60));
  }

  return Math.max(60, Math.round(Number(zone.durationMinutes || 1) * 60));
}

var selectedPlan = null;
var selectedSource = "";
var policy = null;
var zones = [];
var zoneIndex = 0;
var manualSelectedPlan = findManualExecutionPlan();
var scheduledSelectedPlan = triggerKind === "planSchedule" && triggeredPlanId
  ? rotationPlans.find(function(plan) {
      return plan && plan.id === triggeredPlanId && isScheduleDateAllowed(plan, now);
    }) || null
  : null;
var zoneAdvanceSelectedPlan = triggerKind === "zoneAdvance" && triggeredPlanId
  ? rotationPlans.find(function(plan) {
      return plan && plan.id === triggeredPlanId && plan.enabled !== false;
    }) || null
  : null;
var zoneAdvanceAllowed = triggerKind !== "zoneAdvance"
  ? false
  : (
      executionState &&
      executionState.status === "running" &&
      String(executionState.planId || "") === triggeredPlanId &&
      (
        triggerMode === "planZoneAdvance"
          ? true
          : (
              !!triggeredExecutionId &&
              String(executionState.executionId || "") === triggeredExecutionId
            )
      ) &&
      (
        triggeredZoneIndex === null ||
        Number(executionState.zoneIndex || 0) + 1 === Number(triggeredZoneIndex)
      )
    );

if (manualSelectedPlan && (triggerKind === "fieldInspect" || triggerKind === "manualExecution")) {
  selectedPlan = manualSelectedPlan;
  selectedSource = "manual";
  zones = normalizePlanZones(selectedPlan);
  zoneIndex = 0;
} else if (scheduledSelectedPlan) {
  selectedPlan = scheduledSelectedPlan;
  selectedSource = "plan";
  zones = normalizePlanZones(selectedPlan);
  zoneIndex = 0;
} else if (zoneAdvanceSelectedPlan) {
  if (zoneAdvanceAllowed) {
    selectedPlan = zoneAdvanceSelectedPlan;
    selectedSource = String(executionState.source || metadata.source || msg.source || "manual");
    zones = normalizePlanZones(selectedPlan);
    zoneIndex = triggeredZoneIndex !== null ? Number(triggeredZoneIndex) : Number(executionState.zoneIndex || 0) + 1;
  }
} else if (activeExecutionReady(executionState, now)) {
  selectedSource = executionState.source || (String(executionState.planId || "").indexOf("strategy:") === 0 ? "strategy" : "plan");
  if (selectedSource === "strategy") {
    var runningStrategyId = String(executionState.strategyId || String(executionState.planId || "").replace("strategy:", ""));
    var runningStrategy = automationStrategies.find(function(strategy) {
      return strategy && strategy.id === runningStrategyId;
    });
    selectedPlan = buildStrategyPlan({
      strategy: runningStrategy,
      reason: executionState.reason || "自动策略继续执行",
      deficitMm: executionState.deficitMm
    });
    policy = selectedPlan ? selectedPlan.policy : null;
  } else {
    selectedPlan = rotationPlans.find(function(plan) {
      return plan && plan.id === executionState.planId;
    });
  }
  zones = selectedPlan && selectedPlan.source === "strategy" ? selectedPlan.zones : normalizePlanZones(selectedPlan);
  zoneIndex = Number(executionState.zoneIndex || 0) + 1;
} else if (!executionState || executionState.status !== "running") {
  if (triggerKind === "planTick") {
    selectedPlan = rotationPlans.find(function(plan) {
      return isDue(plan, now);
    });
    selectedSource = "plan";
  } else if (triggerKind === "fieldInspect" || triggerKind === "manualExecution") {
    selectedPlan = manualSelectedPlan;
    if (selectedPlan) {
      selectedSource = "manual";
    } else {
      var triggeredStrategy = findTriggeredStrategy();
      selectedPlan = buildStrategyPlan(triggeredStrategy);
      policy = selectedPlan ? selectedPlan.policy : null;
      selectedSource = selectedPlan ? "strategy" : "";
    }
  } else {
    selectedPlan = null;
  }
  zones = selectedPlan && selectedPlan.source === "strategy" ? selectedPlan.zones : normalizePlanZones(selectedPlan);
  zoneIndex = 0;
}

if (!selectedPlan) {
  msg.skipReason = triggerKind === "zoneAdvance"
    ? "轮灌推进条件未满足"
    : triggerKind === "fieldInspect" || triggerKind === "manualExecution"
    ? "自动策略未达到触发条件"
    : "没有到点的自动计划";
  msg.debug.selectedSource = selectedSource;
  msg.debug.skipReason = msg.skipReason;
  return { msg: msg, metadata: metadata, msgType: msgType };
}

if (selectedSource === "plan" && selectedPlan.skipIfRain && (rainSensorWet || rainfallForecastMm > 0)) {
  msg.skipReason = "计划雨天跳过";
  msg.debug.selectedPlanId = selectedPlan.id;
  msg.debug.selectedSource = selectedSource;
  msg.debug.skipReason = msg.skipReason;
  return { msg: msg, metadata: metadata, msgType: msgType };
}

if (zoneIndex >= zones.length) {
  msg.executionState = {
    planId: selectedPlan.id,
    fieldId: fieldId,
    executionId: triggeredExecutionId || executionState.executionId || "",
    status: "completed",
    source: selectedSource || selectedPlan.source || "plan",
    strategyId: selectedPlan.strategyId,
    manualRequestId: selectedSource === "manual" ? manualExecutionRequest.id : undefined,
    zoneIndex: zones.length - 1,
    updatedAt: now
  };
  msg.skipReason = selectedPlan.source === "strategy" ? "策略执行已完成" : "计划已执行完成";
  msg.debug.selectedPlanId = selectedPlan.id;
  msg.debug.selectedPlanName = selectedPlan.name;
  msg.debug.selectedSource = selectedSource || selectedPlan.source || "plan";
  msg.debug.zoneCount = zones.length;
  msg.debug.zoneIndex = zoneIndex;
  msg.debug.skipReason = msg.skipReason;
  return { msg: msg, metadata: metadata, msgType: msgType };
}

var zone = zones[zoneIndex];
var durationSeconds = calculateDurationSeconds(selectedPlan, zone, zones.length, policy);
msg.nextCommand = {
  method: "openValve",
  deviceId: zone.deviceId,
  deviceName: zone.deviceName,
  params: {
    stationId: "1",
    siteNumber: Number(zone.siteNumber),
    manualDurationSeconds: durationSeconds
  },
  planId: selectedPlan.id,
  planName: selectedPlan.name,
  source: selectedSource || selectedPlan.source || "plan",
  strategyId: selectedPlan.strategyId,
  strategyName: policy && policy.strategyName,
  executionId: triggeredExecutionId || executionState.executionId || manualExecutionRequest.executionId,
  manualRequestId: selectedSource === "manual" ? manualExecutionRequest.id : undefined,
  fieldId: fieldId,
  zoneId: zone.zoneId,
  zoneName: zone.zoneName,
  zoneIndex: zoneIndex,
  order: zone.order,
  durationSeconds: durationSeconds
};
msg.executionState = {
  planId: selectedPlan.id,
  fieldId: fieldId,
  executionId: triggeredExecutionId || executionState.executionId || manualExecutionRequest.executionId || ("exec-" + now),
  status: "running",
  source: selectedSource || selectedPlan.source || "plan",
  strategyId: selectedPlan.strategyId,
  manualRequestId: selectedSource === "manual" ? manualExecutionRequest.id : undefined,
  reason: policy && policy.reason,
  deficitMm: policy && policy.deficitMm,
  zoneIndex: zoneIndex,
  nextRunAt: now + durationSeconds * 1000,
  startedAt: zoneIndex === 0 ? now : (executionState.startedAt || now),
  updatedAt: now,
  lastProcessedAdvanceSchedulerId: triggeredSchedulerEventId || undefined
};
msg.policy = policy;
msg.debug.selectedPlanId = selectedPlan.id;
msg.debug.selectedPlanName = selectedPlan.name;
msg.debug.selectedSource = selectedSource || selectedPlan.source || "plan";
msg.debug.zoneCount = zones.length;
msg.debug.zoneIndex = zoneIndex;
msg.debug.nextDeviceName = zone.deviceName;
msg.debug.nextSiteNumber = zone.siteNumber;
msg.debug.durationSeconds = durationSeconds;
if (selectedPlan.source === "strategy" && selectedPlan.strategyId) {
  var automationState = toObject(metadata.automationExecutionState || metadata.ss_automationExecutionState || msg.automationExecutionState || msg.ss_automationExecutionState);
  automationState[selectedPlan.strategyId] = {
    lastStartedAt: executionState.startedAt || now,
    lastReason: policy && policy.reason,
    lastDeficitMm: policy && policy.deficitMm,
    status: "running"
  };
  msg.automationExecutionState = automationState;
}
if (selectedSource === "manual" && manualExecutionRequest.id) {
  msg.manualExecutionRequestConsumedId = manualExecutionRequest.id;
}

return { msg: msg, metadata: metadata, msgType: msgType };
`.trim();
}

function buildExecutionStateAttributesScript() {
  return `
return {
  msg: {
    irrigationExecutionState: msg.executionState,
    automationExecutionState: msg.automationExecutionState,
    manualExecutionRequestConsumedId: msg.manualExecutionRequestConsumedId,
    lastProcessedAdvanceSchedulerId: msg.executionState ? msg.executionState.lastProcessedAdvanceSchedulerId : undefined,
    lastProcessedAdvanceExecutionId: msg.executionState ? msg.executionState.executionId : undefined,
    lastProcessedAdvanceZoneIndex: msg.executionState ? msg.executionState.zoneIndex : undefined,
    lastProcessedAdvanceAt: Date.now(),
    lastIrrigationCommand: msg.nextCommand
  },
  metadata: metadata,
  msgType: "POST_ATTRIBUTES_REQUEST"
};
`.trim();
}

function buildRestReplyPayloadScript() {
  return `
return {
  msg: {
    accepted: !!(msg && msg.nextCommand),
    fieldId: metadata.fieldId || msg.fieldId || "",
    planId: msg && msg.nextCommand ? msg.nextCommand.planId : "",
    source: msg && msg.nextCommand ? msg.nextCommand.source : "",
    skipReason: msg && msg.skipReason ? msg.skipReason : "",
    requestId: metadata.requestId || msg.requestId || "",
    at: Date.now()
  },
  metadata: metadata,
  msgType: msgType
};
`.trim();
}

function buildRpcPayloadScript() {
  return `
metadata.targetDeviceName = String(msg.nextCommand.deviceName || "");
metadata.oneway = "true";
return {
  msg: {
    method: msg.nextCommand.method,
    params: msg.nextCommand.params
  },
  metadata: metadata,
  msgType: "RPC_CALL_FROM_SERVER_TO_DEVICE"
};
`.trim();
}

async function tbRequest(token, pathName, init = {}) {
  const response = await fetch(`${BASE_URL}${pathName}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Authorization": `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`ThingsBoard API 请求失败：${response.status} ${pathName} ${await response.text()}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function extractId(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && typeof value.id === "string") {
    return value.id;
  }
  return "";
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

async function loadDotEnv(filePath) {
  let raw = "";
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = unquoteEnvValue(trimmed.slice(separatorIndex + 1).trim());
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = value;
  }
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function normalizeTriggerMode(value) {
  const explicitValue = String(value || "").trim().toLowerCase();
  const legacyGenerator = process.env.TB_ENABLE_FIELD_TICK_GENERATORS === "1";
  const mode = explicitValue || (legacyGenerator ? "generator" : "scheduler");

  if (mode !== "scheduler" && mode !== "generator") {
    throw new Error("TB_TRIGGER_MODE 只能是 scheduler 或 generator");
  }

  return mode;
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeForScript(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function estimateMonthlyExecutions(fieldCount, nodeCount) {
  if (fieldCount <= 0) {
    return 0;
  }
  const ticksPerMonth = Math.ceil((30 * 24 * 60 * 60) / TICK_PERIOD_SECONDS);
  const averageNodesPerTick = Math.min(Math.max(nodeCount - fieldCount, 1), 8);
  return ticksPerMonth * fieldCount * averageNodesPerTick;
}

function estimateMonthlyTicks(fieldCount) {
  if (fieldCount <= 0) {
    return 0;
  }
  const ticksPerMonth = Math.ceil((30 * 24 * 60 * 60) / TICK_PERIOD_SECONDS);
  return ticksPerMonth * fieldCount;
}
