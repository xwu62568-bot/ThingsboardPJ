import React, { useEffect, useMemo, useState } from 'react';
import {
  AppState,
  AppStateStatus,
  FlatList,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import type { BleDevice, BleSession, BleState } from '../ble/BleTypes';
import type { ThingsBoardAttributesPayload, ThingsBoardState } from '../thingsboard/ThingsBoardTypes';
import { bleService, bleStore, protocol, thingsBoardBridge, thingsBoardStore } from './ble';

type KeyValueRow = {
  label: string;
  value: string;
  tone?: 'neutral' | 'good' | 'warn';
};

const SCAN_SECONDS = 15;

export default function App(): React.JSX.Element {
  const { width } = useWindowDimensions();
  const panelContentWidth = Math.max(260, width - 64);
  const deviceCardWidth = Math.max(252, panelContentWidth - 16);
  const [state, setState] = useState<BleState>(bleStore.getState());
  const [tbState, setTbState] = useState<ThingsBoardState>(thingsBoardStore.getState());
  const [gatewayReconnectPending, setGatewayReconnectPending] = useState(false);

  useEffect(() => {
    const unsubscribeBle = bleStore.subscribe(setState);
    const unsubscribeTb = thingsBoardStore.subscribe(setTbState);
    bleService.init().catch(() => undefined);
    protocol.start();
    thingsBoardBridge.start();

    return () => {
      unsubscribeBle();
      unsubscribeTb();
      thingsBoardBridge.stop();
      protocol.stop();
      bleService.destroy();
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, []);

  const cards = useMemo(() => buildDeviceCards(state, tbState), [state, tbState]);

  const handleAppState = (nextState: AppStateStatus) => {
    if (nextState !== 'active') {
      bleService.stopScan().catch(() => undefined);
      return;
    }
    bleService.setShouldReconnect(true);
    thingsBoardBridge.resumeAfterForeground().catch((error) => {
      thingsBoardStore.setState({
        connectionState: 'error',
        lastError: { message: error instanceof Error ? error.message : String(error) },
      });
    });
  };

  const onScan = async () => {
    const ok = await bleService.requestPermissions();
    if (!ok) {
      return;
    }
    await bleService.startScan([]);
  };

  const onConnect = async (device: BleDevice) => {
    bleService.setReconnectTarget({
      deviceId: device.id,
      deviceName: device.name,
    });
    await bleService.connect(device.id);
  };

  const onDisconnect = async (deviceId?: string) => {
    await bleService.disconnect(deviceId);
  };

  const onReconnect = async (session: BleSession) => {
    bleService.setReconnectTarget({
      deviceId: session.deviceId,
      deviceName: session.deviceName,
    });
    await bleService.connect(session.deviceId);
  };

  const onRefreshDevice = async (deviceId?: string) => {
    await thingsBoardBridge.requestDeviceSnapshotNow(deviceId);
  };

  const onReconnectGateway = async () => {
    if (gatewayReconnectPending) {
      return;
    }
    setGatewayReconnectPending(true);
    try {
      thingsBoardBridge.stop();
      thingsBoardBridge.start();
    } finally {
      setTimeout(() => {
        setGatewayReconnectPending(false);
      }, 1200);
    }
  };

  const renderScanDevice = ({ item }: { item: BleDevice }) => {
    const session = state.sessions[item.id];
    const connected = session?.connectionState === 'connected';

    return (
      <View style={scanCardStyle}>
        <View style={{ flex: 1 }}>
          <View style={rowBetweenStyle}>
            <Text style={scanDeviceNameStyle}>{item.name?.trim() || item.id}</Text>
            <Text style={connected ? badgeGoodStyle : badgeNeutralStyle}>
              {connected ? '已连接' : session?.connectionState ?? '待连接'}
            </Text>
          </View>
          <Text style={metaTextStyle}>MAC: {item.id}</Text>
          <Text style={metaTextStyle}>RSSI: {item.rssi ?? '-'}</Text>
        </View>
        <View style={{ width: 96 }}>
          {connected ? (
            <ActionButton label="断开" variant="ghost" onPress={() => onDisconnect(item.id)} />
          ) : (
            <ActionButton label="连接" onPress={() => onConnect(item)} />
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={safeAreaStyle}>
      <ScrollView contentContainerStyle={screenStyle}>
        <View style={panelStyle}>
          <View style={rowBetweenStyle}>
            <View style={{ flex: 1 }}>
              <Text style={sectionTitleStyle}>ThingsBoard</Text>
              <Text style={sectionHintStyle}>仅显示 app 到平台的连接状态。</Text>
            </View>
            <ActionButton
              label={gatewayReconnectPending ? '重连中...' : '重连网关'}
              variant="ghost"
              onPress={onReconnectGateway}
              disabled={gatewayReconnectPending}
            />
          </View>
          <View style={statusStripStyle}>
            <Text style={statusStripLabelStyle}>连接状态</Text>
            <Text
              style={[
                statusStripValueStyle,
                tbState.connectionState === 'connected' ? valueGoodStyle : null,
                tbState.connectionState === 'error' ? valueWarnStyle : null,
              ]}
            >
              {formatTbConnectionState(tbState.connectionState)}
            </Text>
          </View>
          {tbState.lastError ? <Text style={errorStyle}>{tbState.lastError.message}</Text> : null}
        </View>

        <View style={panelStyle}>
          <View style={rowBetweenStyle}>
            <View style={{ flex: 1 }}>
              <Text style={sectionTitleStyle}>设备卡片</Text>
              <Text style={sectionHintStyle}>左右滑动切换，每台设备独立展示云端状态和实时状态。</Text>
            </View>
          </View>
          {cards.length ? (
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={deviceCarouselStyle}
              decelerationRate="fast"
              snapToAlignment="center"
            >
              {cards.map((card) => (
                <View
                  key={card.deviceId}
                  style={{ width: panelContentWidth, alignItems: 'center' }}
                >
                  <View
                    style={[
                      devicePanelStyle,
                      { width: deviceCardWidth },
                    ]}
                  >
                    <View style={rowBetweenStyle}>
                      <View style={{ flex: 1 }}>
                        <Text style={deviceTitleStyle}>{card.deviceName}</Text>
                        <Text style={metaTextStyle}>MAC: {card.deviceId}</Text>
                      </View>
                      <Text style={card.session?.connectionState === 'connected' ? badgeGoodStyle : badgeNeutralStyle}>
                        {card.session?.connectionState ?? 'idle'}
                      </Text>
                    </View>

                    <View style={actionRowStyle}>
                      <ActionButton
                        label="刷新设备"
                        variant="ghost"
                        onPress={() => onRefreshDevice(card.deviceId)}
                      />
                      {card.session ? (
                        <ActionButton
                          label="重连"
                          variant="ghost"
                          onPress={() => {
                            if (card.session) {
                              return onReconnect(card.session);
                            }
                          }}
                        />
                      ) : null}
                      <ActionButton
                        label={card.session?.connectionState === 'connected' ? '断开连接' : '连接'}
                        variant={card.session?.connectionState === 'connected' ? 'ghost' : 'primary'}
                        onPress={() =>
                          card.session?.connectionState === 'connected'
                            ? onDisconnect(card.deviceId)
                            : onConnect({ id: card.deviceId, name: card.deviceName })
                        }
                      />
                    </View>

                    <View style={subsectionStyle}>
                      <Text style={subsectionTitleStyle}>云端状态</Text>
                      <KeyValueGrid rows={card.cloudRows} />
                    </View>

                    <View style={subsectionStyle}>
                      <Text style={subsectionTitleStyle}>设备实时状态</Text>
                      <KeyValueGrid rows={card.realtimeRows} />
                    </View>
                  </View>
                </View>
              ))}
            </ScrollView>
          ) : (
            <Text style={emptyStyle}>还没有已连接或已同步到平台的设备。</Text>
          )}
        </View>

        <View style={rowBetweenStyle}>
          <View style={{ flex: 1 }}>
            <Text style={sectionTitleStyle}>扫描设备</Text>
            <Text style={sectionHintStyle}>扫描时长固定 {SCAN_SECONDS} 秒，可对多台设备分别连接。</Text>
          </View>
          <ActionButton
            label={state.connectionState === 'scanning' ? '扫描中' : `扫描 ${SCAN_SECONDS}s`}
            onPress={onScan}
            disabled={state.connectionState === 'scanning'}
          />
        </View>

        <View style={summaryRowStyle}>
          <Text style={summaryTextStyle}>蓝牙状态: {state.connectionState}</Text>
          <Text style={summaryTextStyle}>已发现: {state.devices.length}</Text>
          <Text style={summaryTextStyle}>已建会话: {Object.keys(state.sessions).length}</Text>
        </View>
        {state.lastError ? <Text style={errorStyle}>{state.lastError.message}</Text> : null}

        <FlatList
          data={state.devices}
          keyExtractor={(item) => item.id}
          renderItem={renderScanDevice}
          scrollEnabled={false}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={<Text style={emptyStyle}>暂无设备，点击上方按钮开始扫描。</Text>}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function buildDeviceCards(state: BleState, tbState: ThingsBoardState) {
  const sessions = Object.values(state.sessions);
  const cloudByDevice = tbState.latestCloudAttributesByDevice ?? {};
  const realtimeByDevice = tbState.latestGatewayValuesByDevice ?? {};
  const devicesByKey = new Map(
    state.devices.map((device) => [buildChildDeviceKey(device.id), device] as const),
  );
  const sessionsByKey = new Map(
    sessions.map((session) => [buildChildDeviceKey(session.deviceId), session] as const),
  );

  const deviceKeys = new Set<string>([
    ...Object.keys(cloudByDevice),
    ...Object.keys(realtimeByDevice),
    ...Array.from(devicesByKey.keys()),
    ...Array.from(sessionsByKey.keys()),
  ]);

  const cards = Array.from(deviceKeys)
    .map((deviceKey) => {
      const session = sessionsByKey.get(deviceKey);
      const device = devicesByKey.get(deviceKey);
      const cloudAttributes = cloudByDevice[deviceKey];
      const realtimeValues = realtimeByDevice[deviceKey];
      const displayName =
        readString(cloudAttributes?.client?.displayName) ||
        readString(realtimeValues?.displayName) ||
        session?.deviceName?.trim() ||
        device?.name?.trim() ||
        deviceKey;
      return {
        deviceId: session?.deviceId ?? device?.id ?? deviceKey,
        deviceName: displayName,
        deviceKey,
        session,
        cloudRows: buildCloudStatusRows(cloudAttributes),
        realtimeRows: buildRealtimeStatusRows(
          displayName,
          realtimeValues,
          session,
          inferDisplaySiteCount(displayName, cloudAttributes, realtimeValues),
        ),
        sortAt: session?.lastConnectedAt ?? 0,
      };
    })
    .filter((item) => item.session || cloudByDevice[item.deviceKey] || realtimeByDevice[item.deviceKey])
    .sort((left, right) => right.sortAt - left.sortAt);

  return cards;
}

function buildChildDeviceKey(deviceId: string) {
  return `ble-${deviceId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`;
}

function ActionButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
}: {
  label: string;
  onPress: () => void | Promise<void>;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      disabled={disabled}
      onPress={() => void onPress()}
      style={[
        variant === 'ghost' ? ghostButtonStyle : buttonStyle,
        disabled ? disabledButtonStyle : null,
      ]}
    >
      <Text
        style={[
          variant === 'ghost' ? ghostButtonTextStyle : buttonTextStyle,
          disabled ? disabledButtonTextStyle : null,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function KeyValueGrid({ rows }: { rows: KeyValueRow[] }): React.JSX.Element {
  return (
    <View style={gridStyle}>
      {rows.map((row) => (
        <View key={row.label} style={metricCardStyle}>
          <Text style={metricLabelStyle}>{row.label}</Text>
          <Text
            style={[
              metricValueStyle,
              row.tone === 'good' ? valueGoodStyle : null,
              row.tone === 'warn' ? valueWarnStyle : null,
            ]}
          >
            {row.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function buildCloudStatusRows(attributes?: ThingsBoardAttributesPayload): KeyValueRow[] {
  const client = attributes?.client;
  const shared = attributes?.shared;
  return [
    { label: '云端 BLE 状态', value: readString(client?.connectionStateText) || '-' },
    { label: '最近连接时间', value: formatTimestamp(readTimestamp(client?.lastConnectionUpdateTs)) },
    { label: '目标设备', value: readString(shared?.targetDeviceName) || '-' },
    { label: '默认控制站号', value: readDisplayValue(shared?.siteNumber) },
    { label: '默认手动时长', value: appendSeconds(shared?.manualDurationSeconds) },
    { label: '最近 RPC 站号', value: readDisplayValue(client?.lastRpcValveSiteNumber) },
    { label: '最近 RPC 阀状态', value: readDisplayValue(client?.lastRpcValveCommand) },
    { label: '最近 RPC 时长', value: appendSeconds(client?.lastRpcManualDurationSeconds) },
  ];
}

function buildRealtimeStatusRows(
  deviceName: string,
  gatewayValues: Record<string, unknown> | undefined,
  session?: BleSession,
  siteCount = 1,
): KeyValueRow[] {
  const rows: KeyValueRow[] = [
    {
      label: '本地会话',
      value: session?.connectionState ?? '-',
      tone: session?.connectionState === 'connected' ? 'good' : 'neutral',
    },
    { label: '阀门状态', value: formatValveState(gatewayValues?.valveOpen) },
    { label: '开阀时长', value: appendSeconds(gatewayValues?.openingDuration) },
    { label: '电池电量', value: appendPercent(gatewayValues?.batteryLevel) },
    { label: '电池电压', value: appendVoltage(gatewayValues?.batteryVoltage) },
    { label: '土壤传感', value: readDisplayValue(gatewayValues?.soilMoisture) },
    { label: '雨感状态', value: formatRainSensor(gatewayValues?.rainSensorWet) },
  ];

  for (let siteNumber = 1; siteNumber <= siteCount; siteNumber += 1) {
    rows.push({
      label: `${siteNumber} 路状态`,
      value: formatValveState(gatewayValues?.[`station${siteNumber}Open`]),
      tone: readBoolean(gatewayValues?.[`station${siteNumber}Open`]) ? 'good' : 'neutral',
    });
    rows.push({
      label: `${siteNumber} 路时长`,
      value: appendSeconds(gatewayValues?.[`station${siteNumber}OpeningDurationSeconds`]),
    });
  }

  return rows;
}

function inferDisplaySiteCount(
  deviceName: string,
  attributes?: ThingsBoardAttributesPayload,
  gatewayValues?: Record<string, unknown>,
): number {
  const shared = attributes?.shared;
  const client = attributes?.client;
  const explicit =
    readInt(shared?.siteCount) ??
    readInt(shared?.channels) ??
    readInt(client?.siteCount);
  if (explicit && explicit >= 1 && explicit <= 8) {
    return explicit;
  }

  const bySite = gatewayValues?.openingDurationBySite;
  if (bySite && typeof bySite === 'object') {
    const count = Object.keys(bySite as Record<string, unknown>).length;
    if (count >= 1 && count <= 8) {
      return count;
    }
  }

  const modelMatch = deviceName.trim().toUpperCase().match(/WC(\d+)/);
  const secondDigit = modelMatch?.[1]?.[1];
  if (secondDigit) {
    const parsed = Number.parseInt(secondDigit, 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 8) {
      return parsed;
    }
  }

  return 1;
}

function formatTbConnectionState(value: ThingsBoardState['connectionState']): string {
  if (value === 'connected') return '已连接';
  if (value === 'idle') return '未连接';
  if (value === 'polling') return '连接中';
  if (value === 'error') return '异常';
  return '未配置';
}

function formatValveState(value: unknown): string {
  const bool = readBoolean(value);
  if (bool === undefined) return '-';
  return bool ? '开启' : '关闭';
}

function formatRainSensor(value: unknown): string {
  const bool = readBoolean(value);
  if (bool === undefined) return '-';
  return bool ? '湿' : '干';
}

function readBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return undefined;
}

function readDisplayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

function readInt(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readTimestamp(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : undefined;
}

function formatTimestamp(value?: number): string {
  if (!value) return '-';
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function appendSeconds(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return `${num}s`;
}

function appendPercent(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return `${num}%`;
}

function appendVoltage(value: unknown): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return `${num}V`;
}

const safeAreaStyle = {
  flex: 1,
  backgroundColor: '#F4F7F6',
} as const;

const screenStyle = {
  padding: 16,
  gap: 16,
} as const;

const panelStyle = {
  backgroundColor: '#FFFFFF',
  borderRadius: 18,
  padding: 16,
  gap: 12,
  borderWidth: 1,
  borderColor: 'rgba(11,122,117,0.08)',
} as const;

const sectionTitleStyle = {
  fontSize: 20,
  fontWeight: '700',
  color: '#12312F',
} as const;

const sectionHintStyle = {
  marginTop: 4,
  fontSize: 13,
  lineHeight: 18,
  color: '#62807E',
} as const;

const rowBetweenStyle = {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
} as const;

const statusStripStyle = {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'center',
  paddingVertical: 10,
  paddingHorizontal: 12,
  borderRadius: 14,
  backgroundColor: '#F7FBFA',
} as const;

const statusStripLabelStyle = {
  fontSize: 14,
  color: '#4F6C69',
} as const;

const statusStripValueStyle = {
  fontSize: 15,
  fontWeight: '700',
  color: '#12312F',
} as const;

const errorStyle = {
  color: '#B42318',
  fontSize: 13,
} as const;

const buttonStyle = {
  minHeight: 42,
  paddingHorizontal: 14,
  borderRadius: 12,
  backgroundColor: '#0B7A75',
  justifyContent: 'center',
  alignItems: 'center',
} as const;

const ghostButtonStyle = {
  minHeight: 42,
  paddingHorizontal: 14,
  borderRadius: 12,
  backgroundColor: '#F2F8F7',
  justifyContent: 'center',
  alignItems: 'center',
  borderWidth: 1,
  borderColor: 'rgba(11,122,117,0.12)',
} as const;

const buttonTextStyle = {
  color: '#FFFFFF',
  fontSize: 14,
  fontWeight: '700',
} as const;

const ghostButtonTextStyle = {
  color: '#0B7A75',
  fontSize: 14,
  fontWeight: '700',
} as const;

const disabledButtonStyle = {
  opacity: 0.6,
} as const;

const disabledButtonTextStyle = {
  opacity: 0.85,
} as const;

const deviceCarouselStyle = {
  alignItems: 'stretch',
} as const;

const devicePanelStyle = {
  backgroundColor: '#FBFDFC',
  borderRadius: 18,
  padding: 16,
  gap: 14,
  borderWidth: 1,
  borderColor: 'rgba(11,122,117,0.1)',
} as const;

const deviceTitleStyle = {
  fontSize: 22,
  fontWeight: '800',
  color: '#12312F',
} as const;

const metaTextStyle = {
  fontSize: 12,
  color: '#6B8481',
  marginTop: 2,
} as const;

const badgeGoodStyle = {
  paddingVertical: 6,
  paddingHorizontal: 10,
  borderRadius: 999,
  backgroundColor: '#E7F6ED',
  color: '#18794E',
  overflow: 'hidden' as const,
  fontWeight: '700',
  fontSize: 12,
} as const;

const badgeNeutralStyle = {
  paddingVertical: 6,
  paddingHorizontal: 10,
  borderRadius: 999,
  backgroundColor: '#EEF3F2',
  color: '#5F7572',
  overflow: 'hidden' as const,
  fontWeight: '700',
  fontSize: 12,
} as const;

const actionRowStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap' as const,
  gap: 8,
} as const;

const subsectionStyle = {
  gap: 10,
} as const;

const subsectionTitleStyle = {
  fontSize: 16,
  fontWeight: '700',
  color: '#12312F',
} as const;

const gridStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap' as const,
  gap: 10,
} as const;

const metricCardStyle = {
  flexBasis: '48%' as const,
  flexGrow: 1,
  minHeight: 74,
  borderRadius: 14,
  padding: 12,
  backgroundColor: '#FFFFFF',
  borderWidth: 1,
  borderColor: 'rgba(11,122,117,0.08)',
} as const;

const metricLabelStyle = {
  fontSize: 12,
  color: '#6B8481',
} as const;

const metricValueStyle = {
  marginTop: 8,
  fontSize: 16,
  fontWeight: '700',
  color: '#163532',
} as const;

const valueGoodStyle = {
  color: '#18794E',
} as const;

const valueWarnStyle = {
  color: '#B54708',
} as const;

const summaryRowStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap' as const,
  gap: 12,
} as const;

const summaryTextStyle = {
  fontSize: 13,
  color: '#486562',
} as const;

const scanCardStyle = {
  flexDirection: 'row',
  gap: 12,
  alignItems: 'center',
  padding: 14,
  borderRadius: 16,
  backgroundColor: '#FFFFFF',
  borderWidth: 1,
  borderColor: 'rgba(11,122,117,0.08)',
} as const;

const scanDeviceNameStyle = {
  fontSize: 16,
  fontWeight: '700',
  color: '#12312F',
} as const;

const emptyStyle = {
  color: '#6B8481',
  fontSize: 14,
} as const;
