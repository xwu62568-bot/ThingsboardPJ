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
 *   TB_ENABLE_FIELD_TICK_GENERATORS=1
 *   TB_FIELD_ASSET_IDS=assetId1,assetId2
 *   TB_TICK_PERIOD_SECONDS=60
 *   TB_RULE_CHAIN_DRY_RUN=1
 *
 * Notes:
 * - Run this from a trusted local/CI environment, not from the browser.
 * - The default metadata creates per-field minute tick generators, reads Field
 *   asset attributes, calculates the next rotation command, stores execution
 *   state back to the Field asset, and sends RPC to the bound device.
 * - If the ThingsBoard node schemas in your Cloud version differ, export a
 *   verified metadata JSON from ThingsBoard and pass TB_RULE_CHAIN_METADATA.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const BASE_URL = normalizeBaseUrl(process.env.TB_BASE_URL || process.env.VITE_TB_BASE_URL || "https://thingsboard.cloud");
const USERNAME = process.env.TB_USERNAME || "";
const PASSWORD = process.env.TB_PASSWORD || "";
const RULE_CHAIN_NAME = process.env.TB_RULE_CHAIN_NAME || "专业灌溉执行链";
const METADATA_PATH = process.env.TB_RULE_CHAIN_METADATA || "";
const DRY_RUN = process.env.TB_RULE_CHAIN_DRY_RUN === "1";
const ENABLE_FIELD_TICK_GENERATORS = process.env.TB_ENABLE_FIELD_TICK_GENERATORS !== "0";
const FIELD_ASSET_IDS = parseCsv(process.env.TB_FIELD_ASSET_IDS || "");
const FIELD_ASSET_TYPE = process.env.TB_FIELD_ASSET_TYPE || "Field";
const TICK_PERIOD_SECONDS = Math.max(60, Number(process.env.TB_TICK_PERIOD_SECONDS || 60) || 60);

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
  const fieldAssets = ENABLE_FIELD_TICK_GENERATORS && !METADATA_PATH
    ? await fetchFieldAssets(token, FIELD_ASSET_IDS)
    : [];
  const metadata = METADATA_PATH
    ? await loadMetadataFile(METADATA_PATH, ruleChainId)
    : buildDefaultMetadata(ruleChainId, nodeTypes, fieldAssets);

  if (DRY_RUN) {
    console.log(JSON.stringify({ ruleChain, fieldAssets, metadata }, null, 2));
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

  console.log(`规则链已配置：${RULE_CHAIN_NAME}`);
  console.log(`Rule Chain ID：${ruleChainId}`);
  console.log(`节点数量：${savedNodeCount}`);
  if (ENABLE_FIELD_TICK_GENERATORS) {
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
  const defaults = {
    generator: "org.thingsboard.rule.engine.action.TbMsgGeneratorNode",
    originatorAttributes: "org.thingsboard.rule.engine.metadata.TbGetAttributesNode",
    transform: "org.thingsboard.rule.engine.transform.TbTransformMsgNode",
    filter: "org.thingsboard.rule.engine.filter.TbJsFilterNode",
    saveAttributes: "org.thingsboard.rule.engine.telemetry.TbMsgAttributesNode",
    changeOriginator: "org.thingsboard.rule.engine.transform.TbChangeOriginatorNode",
    rpcRequest: "org.thingsboard.rule.engine.rpc.TbSendRPCRequestNode",
    log: "org.thingsboard.rule.engine.action.TbLogNode",
  };

  const components = await fetchRuleNodeComponents(token).catch(() => []);
  return {
    generator: findComponentClazz(components, "generator") || defaults.generator,
    originatorAttributes: findComponentClazz(components, "originator attributes") || defaults.originatorAttributes,
    transform: findComponentClazz(components, "script") || defaults.transform,
    filter: findComponentClazz(components, "script filter") || defaults.filter,
    saveAttributes: findComponentClazz(components, "save attributes") || defaults.saveAttributes,
    changeOriginator: findComponentClazz(components, "change originator") || defaults.changeOriginator,
    rpcRequest: findComponentClazz(components, "rpc call request") || defaults.rpcRequest,
    log: findComponentClazz(components, "log") || defaults.log,
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

function buildDefaultMetadata(ruleChainId, nodeTypes, fieldAssets) {
  const generatorNodes = fieldAssets.map((field, index) =>
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
  );

  const baseStartIndex = generatorNodes.length;
  const baseNodes = [
    createRuleNode({
      type: nodeTypes.originatorAttributes,
      name: "读取地块配置",
      x: 540,
      y: 160,
      configuration: {
        fetchTo: "DATA",
        clientAttributeNames: [],
        sharedAttributeNames: [],
        serverAttributeNames: [
          "rotationPlans",
          "automationStrategies",
          "irrigationExecutionState",
          "deviceMarkers",
          "kc",
          "irrigationEfficiency",
        ],
        latestTsKeyNames: ["soilMoisture", "rainSensorWet", "et0", "etc", "rainfallForecastMm"],
        tellFailureIfAbsent: false,
        getLatestValueWithTs: false,
      },
      description: "读取 Field 资产属性中的计划、策略、设备标记和执行状态。",
    }),
    createRuleNode({
      type: nodeTypes.transform,
      name: "生成基础轮灌命令",
      x: 790,
      y: 160,
      configuration: {
        jsScript: buildPlanCommandScript(),
      },
      description: "判断是否到点，按分区顺序生成下一条 openValve 命令。自动策略先预留入口。",
    }),
    createRuleNode({
      type: nodeTypes.filter,
      name: "存在待执行命令",
      x: 1040,
      y: 160,
      configuration: {
        jsScript: "return msg && msg.nextCommand && msg.nextCommand.deviceName;",
      },
      description: "没有到点计划、策略不允许、未绑定设备名或计划完成时不继续执行。",
    }),
    createRuleNode({
      type: nodeTypes.transform,
      name: "写入执行状态",
      x: 1290,
      y: 90,
      configuration: {
        jsScript: buildExecutionStateAttributesScript(),
      },
      description: "转换为 Field 资产 SERVER_SCOPE 属性写入消息。",
    }),
    createRuleNode({
      type: nodeTypes.saveAttributes,
      name: "保存地块执行状态",
      x: 1540,
      y: 90,
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
      x: 1290,
      y: 230,
      configuration: {
        jsScript: buildRpcPayloadScript(),
      },
      description: "转换为 RPC 请求格式，并设置 metadata.targetDeviceName。",
    }),
    createRuleNode({
      type: nodeTypes.changeOriginator,
      name: "切换到目标设备",
      x: 1540,
      y: 230,
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
      x: 1790,
      y: 230,
      configuration: {
        timeoutInSeconds: 30,
      },
      description: "向目标设备发送 openValve RPC。",
    }),
    createRuleNode({
      type: nodeTypes.log,
      name: "记录执行命令",
      x: 2040,
      y: 230,
      configuration: {
        jsScript:
          "return 'Irrigation command: ' + JSON.stringify(msg) + ', target=' + metadata.targetDeviceName;",
      },
      description: "记录已下发命令。",
    }),
    createRuleNode({
      type: nodeTypes.log,
      name: "未执行原因",
      x: 1290,
      y: 360,
      configuration: {
        jsScript: "return 'Irrigation skipped: ' + (msg && msg.skipReason ? msg.skipReason : 'no command');",
      },
      description: "记录未生成执行命令的原因。",
    }),
  ];

  const nodes = [...generatorNodes, ...baseNodes];
  const readFieldIndex = baseStartIndex;
  const planIndex = baseStartIndex + 1;
  const hasCommandIndex = baseStartIndex + 2;
  const stateTransformIndex = baseStartIndex + 3;
  const saveStateIndex = baseStartIndex + 4;
  const rpcTransformIndex = baseStartIndex + 5;
  const changeOriginatorIndex = baseStartIndex + 6;
  const rpcIndex = baseStartIndex + 7;
  const commandLogIndex = baseStartIndex + 8;
  const skipLogIndex = baseStartIndex + 9;

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
  return {
    type,
    name,
    debugMode: false,
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

function buildPlanCommandScript() {
  return `
var now = Number(metadata.ts || msg.ts || Date.now());
var fieldId = String(metadata.fieldId || msg.fieldId || "");
var rotationPlans = toArray(msg.rotationPlans || msg.ss_rotationPlans);
var automationStrategies = toArray(msg.automationStrategies || msg.ss_automationStrategies);
var executionState = toObject(msg.irrigationExecutionState || msg.ss_irrigationExecutionState);
var deviceMarkers = toArray(msg.deviceMarkers || msg.ss_deviceMarkers);
var soilMoisture = toNumber(msg.soilMoisture || msg.latest_soilMoisture);
var rainSensorWet = toBoolean(msg.rainSensorWet || msg.latest_rainSensorWet);
var et0 = toNumber(msg.et0 || msg.latest_et0);
var etc = toNumber(msg.etc || msg.latest_etc);
var rainfallForecastMm = toNumber(msg.rainfallForecastMm || msg.latest_rainfallForecastMm);
var kc = toNumber(msg.kc || msg.ss_kc);

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

function policyAllows(plan) {
  var activeStrategies = automationStrategies.filter(function(strategy) {
    return strategy && strategy.enabled !== false && strategy.mode === "auto";
  });
  if (activeStrategies.length === 0) {
    return {
      ok: true,
      reason: "没有自动策略，按计划执行",
      strategies: automationStrategies
    };
  }

  for (var i = 0; i < activeStrategies.length; i += 1) {
    var strategy = activeStrategies[i];
    if (strategy.rainLockEnabled && (rainSensorWet || rainfallForecastMm > 0)) {
      return {
        ok: false,
        reason: "雨天锁定",
        strategyId: strategy.id,
        strategies: activeStrategies
      };
    }
  }

  for (var index = 0; index < activeStrategies.length; index += 1) {
    var item = activeStrategies[index];
    var type = item.type || "threshold";
    if (type === "threshold") {
      if (soilMoisture !== null && soilMoisture < Number(item.moistureMin || 0)) {
        return {
          ok: true,
          reason: "土壤湿度低于阈值",
          strategyId: item.id,
          strategies: activeStrategies
        };
      }
      continue;
    }
    if (type === "etc") {
      var calculatedEtc = etc !== null ? etc : et0 !== null && kc !== null ? et0 * kc : null;
      var effectiveRain = rainfallForecastMm !== null
        ? rainfallForecastMm * Number(item.effectiveRainfallRatio || 0)
        : 0;
      var deficit = calculatedEtc !== null ? calculatedEtc - effectiveRain : null;
      if (deficit !== null && deficit >= Number(item.etcTriggerMm || 0)) {
        return {
          ok: true,
          reason: "ETc 缺水达到阈值",
          strategyId: item.id,
          deficitMm: deficit,
          strategies: activeStrategies
        };
      }
      continue;
    }
    if (type === "quota") {
      return {
        ok: true,
        reason: "定量策略允许执行",
        strategyId: item.id,
        strategies: activeStrategies
      };
    }
  }

  return {
    ok: false,
    reason: "自动策略未达到触发条件",
    strategies: activeStrategies
  };
}

function normalizeZones(plan) {
  return (Array.isArray(plan && plan.zones) ? plan.zones : [])
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

var selectedPlan = null;
var zones = [];
var zoneIndex = 0;

if (activeExecutionReady(executionState, now)) {
  selectedPlan = rotationPlans.find(function(plan) {
    return plan && plan.id === executionState.planId;
  });
  zones = normalizeZones(selectedPlan);
  zoneIndex = Number(executionState.zoneIndex || 0) + 1;
} else if (!executionState || executionState.status !== "running") {
  selectedPlan = rotationPlans.find(function(plan) {
    return isDue(plan, now);
  });
  zones = normalizeZones(selectedPlan);
  zoneIndex = 0;
}

if (!selectedPlan) {
  msg.skipReason = "没有到点的自动计划";
  return { msg: msg, metadata: metadata, msgType: msgType };
}

var policy = policyAllows(selectedPlan);
if (!policy.ok) {
  msg.skipReason = policy.reason;
  msg.policy = policy;
  return { msg: msg, metadata: metadata, msgType: msgType };
}

if (zoneIndex >= zones.length) {
  msg.executionState = {
    planId: selectedPlan.id,
    fieldId: fieldId,
    status: "completed",
    zoneIndex: zones.length - 1,
    updatedAt: now
  };
  msg.skipReason = "计划已执行完成";
  return { msg: msg, metadata: metadata, msgType: msgType };
}

var zone = zones[zoneIndex];
var durationSeconds = Math.max(60, Math.round(Number(zone.durationMinutes || 1) * 60));
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
  fieldId: fieldId,
  zoneId: zone.zoneId,
  zoneName: zone.zoneName,
  order: zone.order,
  durationSeconds: durationSeconds
};
msg.executionState = {
  planId: selectedPlan.id,
  fieldId: fieldId,
  status: "running",
  zoneIndex: zoneIndex,
  nextRunAt: now + durationSeconds * 1000,
  startedAt: executionState.startedAt || now,
  updatedAt: now
};
msg.policy = policy;

return { msg: msg, metadata: metadata, msgType: msgType };
`.trim();
}

function buildExecutionStateAttributesScript() {
  return `
return {
  msg: {
    irrigationExecutionState: msg.executionState,
    lastIrrigationCommand: msg.nextCommand
  },
  metadata: metadata,
  msgType: "POST_ATTRIBUTES_REQUEST"
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
