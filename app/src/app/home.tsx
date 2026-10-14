import { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Platform,
  Modal,
  ScrollView,
  Switch,
  Animated,
  Easing,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import {
  session,
  clearTechnicianId,
  getWsUrl,
  getBackendUrl,
  getServerHost,
  initServerHost,
  onServerHostChange,
  fetchWithTimeout,
  autoDiscoverServer,
} from './session';
import Svg, { G, Rect, Line, Circle, Text as SvgText, Polyline, Defs, LinearGradient, Stop } from 'react-native-svg';
import CyberBackground from '../components/CyberBackground';
import AnimatedButton from '../components/AnimatedButton';
import ServerConfigModal from '../components/ServerConfigModal';

function tierColor(tier?: string) {
  if (tier === 'High') return '#dc2626';
  if (tier === 'Medium') return '#f59e0b';
  if (tier === 'Low') return '#eab308';
  return '#16a34a';
}

function tierRank(tier?: string) {
  if (tier === 'High') return 0;
  if (tier === 'Medium') return 1;
  if (tier === 'Low') return 2;
  return 3;
}

const RISK_RANK: Record<string, number> = { High: 3, Medium: 2, Low: 1 };
const ZONE_RANK: Record<string, number> = { 'Life Safety': 3, Critical: 2, Equipment: 1, 'Equipment Safety': 1 };

function criticalityBadgeInfo(criticality?: string) {
  if (criticality === 'Life Safety') {
    return { icon: '🛡️', label: 'LIFE SAFETY', color: '#f43f5e', bg: 'rgba(244, 63, 94, 0.15)' };
  }
  if (criticality === 'Critical') {
    return { icon: '⚡', label: 'CRITICAL', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' };
  }
  return { icon: '⚙️', label: 'EQUIPMENT', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.15)' };
}

function priorityKey(fault: any) {
  const tier = fault.risk_tier || fault.tier || 'Low';
  const crit = fault.zone_criticality || fault.criticality || 'Equipment';
  const occ = fault.occupancy ? 1 : 0;
  let ts = typeof fault.timestamp === 'number' ? fault.timestamp : 0;
  if (!ts && fault.created_at) {
    try {
      ts = new Date(fault.created_at).getTime() / 1000;
    } catch {
      ts = 0;
    }
  }

  return {
    risk: RISK_RANK[tier] ?? 1,
    zone: ZONE_RANK[crit] ?? 1,
    occ: occ,
    negTs: -ts, // earlier timestamp ranks first in reverse=True order
  };
}

function comparePriority(a: any, b: any) {
  const keyA = priorityKey(a);
  const keyB = priorityKey(b);

  // 1. RISK_RANK (High: 3 > Medium: 2 > Low: 1)
  if (keyA.risk !== keyB.risk) {
    return keyB.risk - keyA.risk;
  }
  // 2. ZONE_RANK (Life Safety: 3 > Critical: 2 > Equipment: 1)
  if (keyA.zone !== keyB.zone) {
    return keyB.zone - keyA.zone;
  }
  // 3. Occupancy (1 > 0)
  if (keyA.occ !== keyB.occ) {
    return keyB.occ - keyA.occ;
  }
  // 4. -timestamp (earlier timestamp has higher negTs in reverse=True order)
  return keyB.negTs - keyA.negTs;
}

const WAYPOINTS = {
  mainLobby: { x: 200, y: 460 },
  reception: { x: 200, y: 400 },
  corridorB: { x: 90, y: 400 },
  corridorA: { x: 200, y: 320 },
  stairs: { x: 200, y: 230 },
  emergencyEntrance: { x: 60, y: 460 },
};

const ROOMS: Record<string, { x: number; y: number; w: number; h: number; center: { x: number; y: number } }> = {
  ICU: { x: 10, y: 180, w: 110, h: 70, center: { x: 65, y: 215 } },
  OT:  { x: 150, y: 60,  w: 110, h: 70, center: { x: 205, y: 95 } },
  ER:  { x: 10, y: 360,  w: 110, h: 70, center: { x: 65, y: 395 } },
};

const CORRIDOR_LINES: [{ x: number; y: number }, { x: number; y: number }][] = [
  [WAYPOINTS.mainLobby, WAYPOINTS.reception],
  [WAYPOINTS.reception, WAYPOINTS.corridorB],
  [WAYPOINTS.corridorB, ROOMS.ICU.center],
  [WAYPOINTS.mainLobby, WAYPOINTS.corridorA],
  [WAYPOINTS.corridorA, WAYPOINTS.stairs],
  [WAYPOINTS.stairs, ROOMS.OT.center],
  [WAYPOINTS.emergencyEntrance, ROOMS.ER.center],
];

const ROUTE_PATHS: Record<string, { x: number; y: number }[]> = {
  ICU: [WAYPOINTS.mainLobby, WAYPOINTS.reception, WAYPOINTS.corridorB, ROOMS.ICU.center],
  OT: [WAYPOINTS.mainLobby, WAYPOINTS.corridorA, WAYPOINTS.stairs, ROOMS.OT.center],
  ER: [WAYPOINTS.emergencyEntrance, ROOMS.ER.center],
};

export interface OccupancyUnit {
  id: string;
  name: string;
  code: string;
  occupied: boolean;
}

export type ZoneType = 'OT' | 'ICU' | 'ER';

export type OccupancyData = Record<ZoneType, OccupancyUnit[]>;

const DEFAULT_OCCUPANCY: OccupancyData = {
  OT:  [{ id: 'ot-1',  name: 'OT Room',  code: 'Operation Theatre', occupied: true }],
  ICU: [{ id: 'icu-1', name: 'ICU Room', code: 'Intensive Care Unit', occupied: true }],
  ER:  [{ id: 'er-1',  name: 'ER Room',  code: 'Emergency Room',    occupied: true }],
};

const OCCUPANCY_STORAGE_KEY = 'intellialarm_single_room_occupancy_v3';

function DigitalTwin({ alerts, occupancy }: { alerts: any[]; occupancy?: OccupancyData }) {
  const sorted = [...alerts]
    .filter(a => a.zone !== 'Imaging')
    .sort(comparePriority);
  const topZone = sorted.length > 0 ? sorted[0].zone : null;
  const routePoints = topZone ? ROUTE_PATHS[topZone] : null;

  // Pulsing animation for active alarm beacons
  const beaconPulse = useRef(new Animated.Value(0.4)).current;
  const [beaconOpacity, setBeaconOpacity] = useState(0.4);

  useEffect(() => {
    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(beaconPulse, {
          toValue: 0.9,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(beaconPulse, {
          toValue: 0.3,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ])
    );
    pulseAnim.start();

    const id = beaconPulse.addListener(({ value }) => {
      setBeaconOpacity(value);
    });

    return () => {
      pulseAnim.stop();
      beaconPulse.removeListener(id);
    };
  }, []);

  return (
    <Svg viewBox="0 0 400 480" width="100%" height={280}>
      <Defs>
        <LinearGradient id="corridorGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor="#1e293b" />
          <Stop offset="100%" stopColor="#0f172a" />
        </LinearGradient>
      </Defs>

      {/* Corridor Paths */}
      {CORRIDOR_LINES.map((line, i) => (
        <Line
          key={i}
          x1={line[0].x}
          y1={line[0].y}
          x2={line[1].x}
          y2={line[1].y}
          stroke="#1e293b"
          strokeWidth={8}
          strokeLinecap="round"
        />
      ))}
      {CORRIDOR_LINES.map((line, i) => (
        <Line
          key={`inner-${i}`}
          x1={line[0].x}
          y1={line[0].y}
          x2={line[1].x}
          y2={line[1].y}
          stroke="rgba(56, 189, 248, 0.18)"
          strokeWidth={2}
          strokeDasharray="4,4"
        />
      ))}

      {/* Waypoint Markers */}
      <Circle cx={WAYPOINTS.mainLobby.x} cy={WAYPOINTS.mainLobby.y} r={7} fill="#0284c7" stroke="#38bdf8" strokeWidth={2} />
      <SvgText x={WAYPOINTS.mainLobby.x} y={WAYPOINTS.mainLobby.y + 18} fill="#94a3b8" fontSize="10" fontWeight="bold" textAnchor="middle">MAIN LOBBY</SvgText>

      <Circle cx={WAYPOINTS.emergencyEntrance.x} cy={WAYPOINTS.emergencyEntrance.y} r={7} fill="#ef4444" stroke="#f87171" strokeWidth={2} />
      <SvgText x={WAYPOINTS.emergencyEntrance.x} y={WAYPOINTS.emergencyEntrance.y + 18} fill="#94a3b8" fontSize="9" fontWeight="bold" textAnchor="middle">EMERGENCY ENTRANCE</SvgText>

      <SvgText x={WAYPOINTS.reception.x + 8} y={WAYPOINTS.reception.y - 6} fill="#64748b" fontSize="9">Reception</SvgText>
      <SvgText x={WAYPOINTS.corridorB.x - 15} y={WAYPOINTS.corridorB.y - 8} fill="#64748b" fontSize="9">Corridor B</SvgText>
      <SvgText x={WAYPOINTS.corridorA.x + 8} y={370} fill="#64748b" fontSize="9">Corridor A</SvgText>
      <SvgText x={WAYPOINTS.stairs.x + 8} y={WAYPOINTS.stairs.y} fill="#64748b" fontSize="9">Stairs to Level 2</SvgText>

      {/* Rooms with Pulsing Glow Beacons */}
      {Object.entries(ROOMS).map(([zone, room]) => {
        const alert = alerts.find((a) => a.zone === zone);
        const zoneOcc = occupancy ? occupancy[zone as ZoneType] : undefined;
        const occOccupied = zoneOcc ? zoneOcc.filter((u) => u.occupied).length : null;
        const occTotal = zoneOcc ? zoneOcc.length : null;
        const isAlert = Boolean(alert);

        return (
          <G key={zone}>
            {/* Animated Beacon Halo around Faulted Rooms */}
            {isAlert && (
              <Rect
                x={room.x - 4}
                y={room.y - 4}
                width={room.w + 8}
                height={room.h + 8}
                rx={15}
                fill="none"
                stroke={tierColor(alert?.tier)}
                strokeWidth={3}
                strokeOpacity={beaconOpacity}
              />
            )}
            <Rect
              x={room.x}
              y={room.y}
              width={room.w}
              height={room.h}
              rx={12}
              fill={tierColor(alert?.tier)}
              stroke={isAlert ? '#ffffff' : 'rgba(255,255,255,0.2)'}
              strokeWidth={isAlert ? 2 : 1}
            />
            <SvgText x={room.center.x} y={room.center.y - 4} fill="#ffffff" fontSize="15" fontWeight="900" textAnchor="middle">
              {zone}
            </SvgText>
            {zoneOcc && (
              <SvgText x={room.center.x} y={room.center.y + 14} fill="#ffffff" fontSize="10" fontWeight="bold" textAnchor="middle">
                {occOccupied}/{occTotal} OCCUPIED
              </SvgText>
            )}
          </G>
        );
      })}

      {/* Active Navigation Route */}
      {routePoints && (
        <Polyline
          points={routePoints.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke="#38bdf8"
          strokeWidth={4}
          strokeDasharray="8,6"
        />
      )}
    </Svg>
  );
}

export default function HomeScreen() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [connected, setConnected] = useState(false);
  const [occupancy, setOccupancy] = useState<OccupancyData>(DEFAULT_OCCUPANCY);
  const [occupancyModalVisible, setOccupancyModalVisible] = useState(false);
  const [selectedZone, setSelectedZone] = useState<ZoneType>('OT');
  const [menuVisible, setMenuVisible] = useState(false);

  // Dynamic server host state
  const [serverHost, setCurrentServerHost] = useState(getServerHost());
  const [serverModalVisible, setServerModalVisible] = useState(false);

  // Real-time sensor telemetry state
  const [sensorsData, setSensorsData] = useState<any[]>([
    { zone: 'OT', name: 'Operation Theatre', voltage: 1182.4, current: 4.93, power_watts: 1340.7, fault_type: 'overload' },
    { zone: 'ICU', name: 'Intensive Care Unit', voltage: 230.0, current: 0.9, power_watts: 207.0, fault_type: 'nominal' },
    { zone: 'ER', name: 'Emergency Room', voltage: 228.0, current: 1.5, power_watts: 342.0, fault_type: 'nominal' },
  ]);
  const [esp32Connected, setEsp32Connected] = useState(true);
  const [sensorsModalVisible, setSensorsModalVisible] = useState(false);
  const lastAliveRef = useRef<number>(Date.now());
  const isDiscoveringRef = useRef(false);

  async function handleLogout() {
    await clearTechnicianId();
    router.replace('/');
  }

  // Reactively listen to server changes from anywhere in the app
  useEffect(() => {
    initServerHost().then((host) => {
      setCurrentServerHost(host);
    });
    const unsub = onServerHostChange((newHost) => {
      setCurrentServerHost(newHost);
    });
    return unsub;
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: any = null;
    let pollInterval: any = null;
    let pingInterval: any = null;
    let isMounted = true;
    let failedHttpCount = 0;

    async function fetchDataHttp() {
      if (!isMounted) return;
      try {
        const [alertsRes, sensorsRes] = await Promise.all([
          fetchWithTimeout(`${getBackendUrl()}/alerts`, {}, 5000).catch(() => null),
          fetchWithTimeout(`${getBackendUrl()}/sensors`, {}, 5000).catch(() => null),
        ]);

        let hasData = false;
        if (alertsRes && alertsRes.ok) {
          const data = await alertsRes.json();
          if (isMounted && Array.isArray(data)) {
            setAlerts(data);
            hasData = true;
          }
        }
        if (sensorsRes && sensorsRes.ok) {
          const sData = await sensorsRes.json();
          if (isMounted && sData) {
            if (Array.isArray(sData.sensors)) setSensorsData(sData.sensors);
            setEsp32Connected(Boolean(sData.esp32_connected));
            hasData = true;
          }
        }

        if (hasData && isMounted) {
          failedHttpCount = 0;
          lastAliveRef.current = Date.now();
          setConnected(true);
        } else if (isMounted) {
          failedHttpCount++;
          // Only declare offline if no alive signal for > 25 seconds AND at least 3 consecutive failures
          if (failedHttpCount >= 3 && Date.now() - lastAliveRef.current > 25000) {
            setConnected(false);
          }
        }
      } catch {
        if (isMounted) {
          failedHttpCount++;
          if (failedHttpCount >= 3 && Date.now() - lastAliveRef.current > 25000) {
            setConnected(false);
          }
        }
      }
    }

    // Immediately fetch active alerts and sensors via HTTP
    fetchDataHttp();

    function connect() {
      if (!isMounted) return;
      if (ws) {
        try { ws.close(); } catch (e) {}
      }
      try {
        ws = new WebSocket(getWsUrl());
        ws.onopen = () => {
          if (isMounted) {
            failedHttpCount = 0;
            lastAliveRef.current = Date.now();
            setConnected(true);
          }
        };
        ws.onclose = () => {
          if (isMounted) {
            if (timer) clearTimeout(timer);
            timer = setTimeout(connect, 1500);
          }
        };
        ws.onerror = () => {
          if (isMounted) {
            if (timer) clearTimeout(timer);
            timer = setTimeout(connect, 1500);
          }
        };
        ws.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data);
            failedHttpCount = 0;
            lastAliveRef.current = Date.now();
            setConnected(true);
            if (data.type === 'alerts') {
              if (Array.isArray(data.data)) setAlerts(data.data);
              if (Array.isArray(data.sensors)) setSensorsData(data.sensors);
            }
          } catch (e) {}
        };
      } catch (e) {
        if (isMounted) {
          if (timer) clearTimeout(timer);
          timer = setTimeout(connect, 2000);
        }
      }
    }

    connect();

    // Active heartbeat ping every 3s over WebSocket so the mobile TCP socket never idles
    pingInterval = setInterval(() => {
      if (!isMounted) return;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'ping' }));
        } catch {}
      }
    }, 3000);

    // Background HTTP poll every 3s as continuous backup
    pollInterval = setInterval(fetchDataHttp, 3000);

    return () => {
      isMounted = false;
      if (timer) clearTimeout(timer);
      if (pollInterval) clearInterval(pollInterval);
      if (pingInterval) clearInterval(pingInterval);
      if (ws) {
        try { ws.close(); } catch (e) {}
      }
    };
  }, [serverHost]);
  useEffect(() => {
    async function loadOccupancy() {
      try {
        // Clean up any old legacy keys from previous runs
        await AsyncStorage.removeItem('intellialarm_zone_occupancy');
        await AsyncStorage.removeItem('intellialarm_single_room_occupancy_v2');

        const stored = await AsyncStorage.getItem(OCCUPANCY_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          const sanitized: OccupancyData = {
            OT: Array.isArray(parsed.OT) && parsed.OT.length > 0
              ? [{ ...DEFAULT_OCCUPANCY.OT[0], occupied: Boolean(parsed.OT[0].occupied) }]
              : DEFAULT_OCCUPANCY.OT,
            ICU: Array.isArray(parsed.ICU) && parsed.ICU.length > 0
              ? [{ ...DEFAULT_OCCUPANCY.ICU[0], occupied: Boolean(parsed.ICU[0].occupied) }]
              : DEFAULT_OCCUPANCY.ICU,
            ER: Array.isArray(parsed.ER) && parsed.ER.length > 0
              ? [{ ...DEFAULT_OCCUPANCY.ER[0], occupied: Boolean(parsed.ER[0].occupied) }]
              : DEFAULT_OCCUPANCY.ER,
          };
          setOccupancy(sanitized);
          await AsyncStorage.setItem(OCCUPANCY_STORAGE_KEY, JSON.stringify(sanitized));
        } else {
          setOccupancy(DEFAULT_OCCUPANCY);
          await AsyncStorage.setItem(OCCUPANCY_STORAGE_KEY, JSON.stringify(DEFAULT_OCCUPANCY));
        }
      } catch (e) {
        console.warn('Failed to load occupancy', e);
        setOccupancy(DEFAULT_OCCUPANCY);
      }
    }
    loadOccupancy();
  }, []);


  async function toggleUnit(zone: ZoneType, unitId: string) {
    const updatedZoneList = occupancy[zone].map((unit) =>
      unit.id === unitId ? { ...unit, occupied: !unit.occupied } : unit
    );
    const newOccupancy = { ...occupancy, [zone]: updatedZoneList };
    setOccupancy(newOccupancy);
    try {
      await AsyncStorage.setItem(OCCUPANCY_STORAGE_KEY, JSON.stringify(newOccupancy));
    } catch (e) {
      console.warn('Failed to save occupancy', e);
    }
  }

  async function setAllUnits(zone: ZoneType, state: boolean) {
    const updatedZoneList = occupancy[zone].map((unit) => ({ ...unit, occupied: state }));
    const newOccupancy = { ...occupancy, [zone]: updatedZoneList };
    setOccupancy(newOccupancy);
    try {
      await AsyncStorage.setItem(OCCUPANCY_STORAGE_KEY, JSON.stringify(newOccupancy));
    } catch (e) {
      console.warn('Failed to save occupancy', e);
    }
  }

  const getOccupiedCount = (zone: ZoneType) =>
    occupancy[zone] ? occupancy[zone].filter((u) => u.occupied).length : 0;

  const totalOccupied =
    getOccupiedCount('OT') + getOccupiedCount('ICU') + getOccupiedCount('ER');
  const totalUnits =
    occupancy.OT.length + occupancy.ICU.length + occupancy.ER.length;

  const sortedAlerts = [...alerts]
    .filter(a => a.zone !== 'Imaging')
    .sort(comparePriority);

  return (
    <CyberBackground>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity
              style={styles.menuIconButton}
              onPress={() => setMenuVisible(true)}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <View style={styles.menuLine} />
              <View style={[styles.menuLine, { width: 14 }]} />
              <View style={styles.menuLine} />
            </TouchableOpacity>

            <View style={styles.headerBrand}>
              <View style={styles.brandIconBox}>
                <Text style={styles.brandIcon}>⚡</Text>
              </View>
              <View>
                <Text style={styles.headerTitle}>IntelliAlarm</Text>
                <Text style={styles.headerSub}>
                  {session.technicianId ? `OP: ${session.technicianId}` : 'CRITICAL RESILIENCE'}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={() => setServerModalVisible(true)}
              activeOpacity={0.7}
              style={[styles.statusPill, { borderColor: connected ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)' }]}
            >
              <View style={[styles.statusDot, { backgroundColor: connected ? '#10b981' : '#ef4444' }]} />
              <Text style={[styles.statusText, { color: connected ? '#34d399' : '#f87171' }]}>
                {connected ? 'LIVE' : 'OFFLINE'}
              </Text>
            </TouchableOpacity>
            <AnimatedButton scaleTo={0.92} onPress={handleLogout} style={styles.logoutButton}>
              <Text style={styles.logoutText}>Logout</Text>
            </AnimatedButton>
          </View>
        </View>

        {/* ── Top Header Quick Telemetry Bar (Always Visible) ── */}
        <TouchableOpacity
          style={styles.quickTelemetryBar}
          activeOpacity={0.7}
          onPress={() => setSensorsModalVisible(true)}
        >
          <View style={styles.quickTelemetryBadge}>
            <View style={[styles.espDot, { backgroundColor: esp32Connected ? '#10b981' : '#f59e0b' }]} />
            <Text style={styles.quickTelemetryBadgeText}>
              {esp32Connected ? 'ESP32 LIVE' : 'SYNCING'}
            </Text>
          </View>
          <Text style={styles.quickTelemetryText} numberOfLines={1}>
            ⚡ OT: {sensorsData.find((s) => s.zone === 'OT')?.voltage ?? 1182.4}V • {sensorsData.find((s) => s.zone === 'OT')?.current ?? 4.93}A [{sensorsData.find((s) => s.zone === 'OT')?.fault_type?.toUpperCase() ?? 'OVERLOAD'}]
          </Text>
          <Text style={styles.quickTelemetryAction}>TELEMETRY ›</Text>
        </TouchableOpacity>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Digital Twin</Text>
          <Text style={styles.sectionBadge}>LEVEL 1 • RADAR GRID</Text>
        </View>
        <View style={styles.twinCard}>
          <DigitalTwin alerts={alerts} occupancy={occupancy} />
        </View>
        {sortedAlerts.length > 0 && (
          <View style={styles.routeBanner}>
            <Text style={styles.routeHint}>
              📍 Top Dispatch: <Text style={styles.routeBold}>{sortedAlerts[0].zone}</Text>
              {' • '}
              <Text style={{ color: criticalityBadgeInfo(sortedAlerts[0].criticality || sortedAlerts[0].zone_criticality).color, fontWeight: '800' }}>
                {criticalityBadgeInfo(sortedAlerts[0].criticality || sortedAlerts[0].zone_criticality).icon} {criticalityBadgeInfo(sortedAlerts[0].criticality || sortedAlerts[0].zone_criticality).label}
              </Text>
              {' • '}
              <Text style={{ color: tierColor(sortedAlerts[0].tier), fontWeight: '800' }}>
                {sortedAlerts[0].tier} Risk
              </Text>
            </Text>
          </View>
        )}

        <View style={styles.sectionHeaderRow}>
          <View>
            <Text style={styles.sectionTitle}>Priority Queue ({sortedAlerts.length})</Text>
            <Text style={styles.sectionHierarchyHint}>Priority: Risk Tier › Criticality › Occupancy › Time</Text>
          </View>
          <Text style={styles.sectionBadge}>ACTIVE ALERTS</Text>
        </View>
        <FlatList
          style={styles.list}
          data={sortedAlerts}
          keyExtractor={(item) => String(item.id)}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🛡️</Text>
              <Text style={styles.emptyText}>All systems nominal • No active faults</Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const critInfo = criticalityBadgeInfo(item.criticality || item.zone_criticality);
            return (
              <AnimatedButton
                scaleTo={0.97}
                style={[styles.queueItem, { borderLeftColor: critInfo.color }]}
                onPress={() => router.push({ pathname: '/detail', params: { zone: item.zone } })}
              >
                <View style={styles.queueHeaderRow}>
                  <View style={styles.queueZoneGroup}>
                    <Text style={styles.queueZone}>{item.zone}</Text>
                    <View style={[styles.critPill, { backgroundColor: critInfo.bg, borderColor: critInfo.color }]}>
                      <Text style={[styles.critPillText, { color: critInfo.color }]}>
                        {critInfo.icon} {critInfo.label}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.queueBadgeGroup}>
                    <Text style={[styles.queueTierPill, { color: tierColor(item.tier), borderColor: tierColor(item.tier) }]}>
                      {item.tier} RISK
                    </Text>
                  </View>
                </View>
                <View style={styles.queueMetaRow}>
                  <Text style={styles.queueFault}>{item.fault_type.replace('_', ' ').toUpperCase()}</Text>
                  <View style={styles.queueMetaRight}>
                    <Text style={[styles.occBadgeText, { color: item.occupancy ? '#34d399' : '#94a3b8' }]}>
                      {item.occupancy ? '🛏️ Occupied' : '⚪ Vacant'}
                    </Text>
                    {item.priority_score ? (
                      <Text style={styles.priorityScoreText}>Score: {item.priority_score}</Text>
                    ) : null}
                  </View>
                </View>
                {item.status === 'engaged' ? (
                  <Text style={styles.queueEngaged}>🛠️ Engaged by {item.engaged_by}</Text>
                ) : (
                  <Text style={styles.queueOpen}>⚠️ Dispatch #{index + 1} • Action Required ›</Text>
                )}
              </AnimatedButton>
            );
          }}
        />

      {/* Bottom Occupancy Button Bar */}
      <AnimatedButton
        scaleTo={0.98}
        style={styles.occupancyBar}
        onPress={() => setOccupancyModalVisible(true)}
      >
        <View style={styles.occupancyBarLeft}>
          <View style={styles.occupancyIconCircle}>
            <Text style={styles.occupancyIconEmoji}>🛏️</Text>
          </View>
          <View>
            <Text style={styles.occupancyBarTitle}>Zone Occupancy</Text>
            <Text style={styles.occupancyBarSubtitle}>
              OT: {getOccupiedCount('OT')}/{occupancy.OT.length} • ICU: {getOccupiedCount('ICU')}/{occupancy.ICU.length} • ER: {getOccupiedCount('ER')}/{occupancy.ER.length}
            </Text>
          </View>
        </View>
        <View style={styles.occupancyBarRight}>
          <View style={styles.occupancyTotalBadge}>
            <Text style={styles.occupancyTotalBadgeText}>
              {totalOccupied}/{totalUnits} In Use
            </Text>
          </View>
          <Text style={styles.occupancyArrow}>›</Text>
        </View>
      </AnimatedButton>

      {/* Occupancy Modal Sheet */}
      <Modal
        visible={occupancyModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setOccupancyModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderTitleRow}>
                <View style={styles.modalHeaderIconBadge}>
                  <Text style={styles.modalHeaderIcon}>👥</Text>
                </View>
                <View>
                  <Text style={styles.modalTitle}>Zone Occupancy Manager</Text>
                  <Text style={styles.modalSubtitle}>
                    {totalOccupied} of {totalUnits} rooms occupied
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setOccupancyModalVisible(false)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Three Zone Icons / Buttons: OT, ICU, ER */}
            <View style={styles.zoneTabs}>
              {(['OT', 'ICU', 'ER'] as ZoneType[]).map((zoneKey) => {
                const isSelected = selectedZone === zoneKey;
                const occ = getOccupiedCount(zoneKey);
                const total = occupancy[zoneKey].length;
                const icon = zoneKey === 'OT' ? '🏥' : zoneKey === 'ICU' ? '🩺' : '🚑';
                const label =
                  zoneKey === 'OT'
                    ? 'Operation Theatre'
                    : zoneKey === 'ICU'
                    ? 'Intensive Care'
                    : 'Emergency Room';

                return (
                  <TouchableOpacity
                    key={zoneKey}
                    style={[styles.zoneTab, isSelected && styles.zoneTabActive]}
                    onPress={() => setSelectedZone(zoneKey)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.zoneTabEmoji}>{icon}</Text>
                    <Text style={[styles.zoneTabCode, isSelected && styles.zoneTabCodeActive]}>
                      {zoneKey}
                    </Text>
                    <Text style={styles.zoneTabLabel} numberOfLines={1}>
                      {label}
                    </Text>
                    <View
                      style={[
                        styles.zoneBadge,
                        isSelected ? styles.zoneBadgeActive : styles.zoneBadgeInactive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.zoneBadgeText,
                          isSelected && styles.zoneBadgeTextActive,
                        ]}
                      >
                        {occ}/{total} Occupied
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Selected Zone List Header */}
            <View style={styles.zoneListHeader}>
              <View>
                <Text style={styles.zoneListTitle}>
                  {selectedZone === 'OT'
                    ? '🏥 Operation Theatre (OT)'
                    : selectedZone === 'ICU'
                    ? '🩺 Intensive Care Unit (ICU)'
                    : '🚑 Emergency Room (ER)'}
                </Text>
                <Text style={styles.zoneListSub}>
                  Status: {occupancy[selectedZone]?.[0]?.occupied ? '🔴 Occupied' : '🟢 Vacant'}
                </Text>
              </View>
              <View style={styles.quickActionRow}>
                <TouchableOpacity
                  style={styles.quickActionButton}
                  onPress={() => setAllUnits(selectedZone, true)}
                >
                  <Text style={styles.quickActionText}>Occupied</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.quickActionButton}
                  onPress={() => setAllUnits(selectedZone, false)}
                >
                  <Text style={styles.quickActionText}>Vacant</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* List with Toggle Buttons */}
            <ScrollView
              style={styles.unitList}
              contentContainerStyle={{ paddingBottom: 24 }}
              showsVerticalScrollIndicator={false}
            >
              {occupancy[selectedZone].map((unit) => (
                <View
                  key={unit.id}
                  style={[styles.unitCard, unit.occupied && styles.unitCardOccupied]}
                >
                  <View style={styles.unitInfo}>
                    <View style={styles.unitNameRow}>
                      <Text style={styles.unitName}>{unit.name}</Text>
                      <View
                        style={[
                          styles.unitStatusPill,
                          unit.occupied ? styles.statusPillOccupied : styles.statusPillVacant,
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusPillText,
                            unit.occupied
                              ? styles.statusPillTextOccupied
                              : styles.statusPillTextVacant,
                          ]}
                        >
                          {unit.occupied ? 'OCCUPIED' : 'VACANT'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.unitCode}>{unit.code}</Text>
                  </View>
                  <View style={styles.switchWrapper}>
                    <Switch
                      value={unit.occupied}
                      onValueChange={() => toggleUnit(selectedZone, unit.id)}
                      trackColor={{ false: '#334155', true: '#dc2626' }}
                      thumbColor={unit.occupied ? '#f87171' : '#94a3b8'}
                    />
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Slide-Out Left Cyber Menu Modal ───────────────────────── */}
      <Modal
        visible={menuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <View style={styles.menuOverlay}>
          <TouchableOpacity
            style={styles.menuBackdrop}
            activeOpacity={1}
            onPress={() => setMenuVisible(false)}
          />
          <View style={styles.menuDrawer}>
            <ScrollView
              contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
              showsVerticalScrollIndicator={false}
            >
              {/* Drawer Header */}
            <View style={styles.drawerHeader}>
              <View style={styles.drawerBrandRow}>
                <View style={styles.drawerLogoBox}>
                  <Text style={styles.drawerLogoIcon}>⚡</Text>
                </View>
                <View>
                  <Text style={styles.drawerTitle}>IntelliAlarm</Text>
                  <Text style={styles.drawerSubTitle}>SYSTEM MENU • LEVEL 1</Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.drawerCloseBtn}
                onPress={() => setMenuVisible(false)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.drawerCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Active Operator Pill */}
            <View style={styles.drawerOperatorBox}>
              <View style={styles.drawerOpAvatar}>
                <Text style={{ fontSize: 14 }}>👤</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.drawerOpLabel}>ACTIVE OPERATOR</Text>
                <Text style={styles.drawerOpName}>
                  {session.technicianId || 'Azeem (Operator)'}
                </Text>
              </View>
              <View style={[styles.drawerStatusDot, { backgroundColor: connected ? '#10b981' : '#ef4444' }]} />
            </View>

            <View style={styles.drawerDivider} />

            {/* Menu Items */}
            <View style={styles.drawerList}>
              {/* Live Telemetry Menu Item */}
              <TouchableOpacity
                style={styles.drawerItem}
                activeOpacity={0.7}
                onPress={() => {
                  setMenuVisible(false);
                  setSensorsModalVisible(true);
                }}
              >
                <View style={[styles.drawerItemIconBox, { backgroundColor: 'rgba(56, 189, 248, 0.15)', borderColor: 'rgba(56, 189, 248, 0.4)' }]}>
                  <Text style={styles.drawerItemEmoji}>⚡</Text>
                </View>
                <View style={styles.drawerItemTextCol}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.drawerItemTitle}>Live Telemetry</Text>
                    <View style={[styles.espBadge, esp32Connected ? styles.espOnline : styles.espOffline]}>
                      <View style={[styles.espDot, { backgroundColor: esp32Connected ? '#10b981' : '#f59e0b' }]} />
                      <Text style={[styles.espText, { color: esp32Connected ? '#34d399' : '#fbbf24' }]}>
                        {esp32Connected ? 'ONLINE' : 'SYNCING'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.drawerItemDesc}>Voltage, current & ESP32 electrical metrics</Text>
                </View>
                <Text style={styles.drawerItemChevron}>›</Text>
              </TouchableOpacity>

              {/* Fault History */}
              <TouchableOpacity
                style={styles.drawerItem}
                activeOpacity={0.7}
                onPress={() => {
                  setMenuVisible(false);
                  router.push({ pathname: '/history', params: { tab: 'faults' } });
                }}
              >
                <View style={[styles.drawerItemIconBox, { backgroundColor: 'rgba(245, 158, 11, 0.15)', borderColor: 'rgba(245, 158, 11, 0.4)' }]}>
                  <Text style={styles.drawerItemEmoji}>⚠️</Text>
                </View>
                <View style={styles.drawerItemTextCol}>
                  <Text style={styles.drawerItemTitle}>Fault History</Text>
                  <Text style={styles.drawerItemDesc}>Past alarms, priority orders & incident log</Text>
                </View>
                <Text style={styles.drawerItemChevron}>›</Text>
              </TouchableOpacity>

              {/* Admin Access */}
              <TouchableOpacity
                style={styles.drawerItem}
                activeOpacity={0.7}
                onPress={() => {
                  setMenuVisible(false);
                  router.push({ pathname: '/history', params: { tab: 'login' } });
                }}
              >
                <View style={[styles.drawerItemIconBox, { backgroundColor: 'rgba(56, 189, 248, 0.15)', borderColor: 'rgba(56, 189, 248, 0.4)' }]}>
                  <Text style={styles.drawerItemEmoji}>🔐</Text>
                </View>
                <View style={styles.drawerItemTextCol}>
                  <Text style={styles.drawerItemTitle}>Admin Access</Text>
                  <Text style={styles.drawerItemDesc}>Technician login records & system audit</Text>
                </View>
                <Text style={styles.drawerItemChevron}>›</Text>
              </TouchableOpacity>

              {/* Zone Occupancy */}
              <TouchableOpacity
                style={styles.drawerItem}
                activeOpacity={0.7}
                onPress={() => {
                  setMenuVisible(false);
                  setOccupancyModalVisible(true);
                }}
              >
                <View style={[styles.drawerItemIconBox, { backgroundColor: 'rgba(16, 185, 129, 0.15)', borderColor: 'rgba(16, 185, 129, 0.4)' }]}>
                  <Text style={styles.drawerItemEmoji}>🛏️</Text>
                </View>
                <View style={styles.drawerItemTextCol}>
                  <Text style={styles.drawerItemTitle}>Zone Occupancy</Text>
                  <Text style={styles.drawerItemDesc}>Manage bed allocation ({totalOccupied}/{totalUnits} in use)</Text>
                </View>
                <Text style={styles.drawerItemChevron}>›</Text>
              </TouchableOpacity>

              {/* Server Network IP */}
              <TouchableOpacity
                style={styles.drawerItem}
                activeOpacity={0.7}
                onPress={() => {
                  setMenuVisible(false);
                  setServerModalVisible(true);
                }}
              >
                <View style={[styles.drawerItemIconBox, { backgroundColor: 'rgba(139, 92, 246, 0.15)', borderColor: 'rgba(139, 92, 246, 0.4)' }]}>
                  <Text style={styles.drawerItemEmoji}>🌐</Text>
                </View>
                <View style={styles.drawerItemTextCol}>
                  <Text style={styles.drawerItemTitle}>Server Network IP</Text>
                  <Text style={styles.drawerItemDesc}>Target: {serverHost}:8000</Text>
                </View>
                <Text style={styles.drawerItemChevron}>›</Text>
              </TouchableOpacity>
            </View>

            {/* Drawer Footer */}
            <View style={styles.drawerFooter}>
              <TouchableOpacity
                style={styles.drawerLogoutBtn}
                activeOpacity={0.8}
                onPress={() => {
                  setMenuVisible(false);
                  handleLogout();
                }}
              >
                <Text style={styles.drawerLogoutText}>🚪 Logout Operator</Text>
              </TouchableOpacity>
              <Text style={styles.drawerVersionText}>
                IntelliAlarm Mobile OS • Grid {serverHost}
              </Text>
            </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Reusable Server Config Modal ── */}
      <ServerConfigModal
        visible={serverModalVisible}
        onClose={() => setServerModalVisible(false)}
        onServerChanged={(newHost) => setCurrentServerHost(newHost)}
      />

      {/* ── Expanded Live Sensor Telemetry Modal ── */}
      <Modal
        visible={sensorsModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSensorsModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.sensorModalContainer}>
            {/* Header */}
            <View style={styles.sensorModalHeader}>
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontSize: 16 }}>📊</Text>
                  <Text style={styles.sensorModalTitle}>REAL-TIME HARDWARE TELEMETRY</Text>
                </View>
                <Text style={styles.sensorModalSub}>
                  ESP32 Microcontroller Node • Port 1883 MQTT Stream
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setSensorsModalVisible(false)}
                style={styles.sensorModalCloseX}
              >
                <Text style={{ color: '#94a3b8', fontSize: 18, fontWeight: '700' }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Hardware Status Strip */}
            <View style={[styles.espStatusBar, esp32Connected ? styles.espStatusBarOnline : styles.espStatusBarOffline]}>
              <View style={[styles.espDot, { backgroundColor: esp32Connected ? '#10b981' : '#f59e0b' }]} />
              <Text style={[styles.espStatusBarText, { color: esp32Connected ? '#34d399' : '#fbbf24' }]}>
                {esp32Connected
                  ? `HARDWARE LINK ESTABLISHED • TARGET HOST: ${serverHost}`
                  : `SYNCING WITH SERVER • RETRYING ${serverHost}:8000`}
              </Text>
            </View>

            {/* Sensor Cards List */}
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              {(sensorsData.length > 0
                ? sensorsData
                : [
                    { zone: 'OT', name: 'Operation Theatre', voltage: 1185.2, current: 4.95, power_watts: 1349.3, fault_type: 'overload', timestamp: 'Live' },
                    { zone: 'ICU', name: 'Intensive Care Unit', voltage: 230.0, current: 0.9, power_watts: 207.0, fault_type: 'nominal', timestamp: 'Live' },
                    { zone: 'ER', name: 'Emergency Room', voltage: 228.0, current: 1.5, power_watts: 342.0, fault_type: 'nominal', timestamp: 'Live' },
                  ]
              ).map((s: any) => {
                const isFault = s.fault_type && s.fault_type !== 'nominal';
                return (
                  <View
                    key={s.zone}
                    style={[styles.sensorDetailCard, isFault && styles.sensorDetailCardFault]}
                  >
                    <View style={styles.sensorCardHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={[styles.sensorZoneChipLg, { backgroundColor: isFault ? 'rgba(239, 68, 68, 0.25)' : 'rgba(56, 189, 248, 0.2)' }]}>
                          <Text style={[styles.sensorZoneChipLgText, { color: isFault ? '#f87171' : '#38bdf8' }]}>
                            {s.zone}
                          </Text>
                        </View>
                        <View>
                          <Text style={styles.sensorCardTitle}>{s.name || `Zone ${s.zone}`}</Text>
                          <Text style={styles.sensorCardSub}>
                            {s.timestamp ? `Feed: ${s.timestamp}` : 'Continuous Stream'}
                          </Text>
                        </View>
                      </View>

                      <View style={[styles.sensorStatusBadge, isFault ? styles.sensorBadgeFault : styles.sensorBadgeOk]}>
                        <Text style={[styles.sensorBadgeText, isFault ? styles.sensorBadgeTextFault : styles.sensorBadgeTextOk]}>
                          {isFault ? s.fault_type.toUpperCase() : 'NOMINAL'}
                        </Text>
                      </View>
                    </View>

                    {/* Gauges Grid */}
                    <View style={styles.sensorMetricsGrid}>
                      <View style={styles.sensorMetricBox}>
                        <Text style={styles.sensorMetricLabel}>⚡ VOLTAGE</Text>
                        <Text style={styles.sensorMetricVal}>
                          {s.voltage < 1000 ? `${s.voltage.toFixed(1)} V` : `${s.voltage.toFixed(0)} mV`}
                        </Text>
                      </View>

                      <View style={styles.sensorMetricBox}>
                        <Text style={styles.sensorMetricLabel}>🔌 CURRENT</Text>
                        <Text style={[styles.sensorMetricVal, { color: s.current > 3.0 ? '#f87171' : '#38bdf8' }]}>
                          {s.current.toFixed(2)} A
                        </Text>
                      </View>

                      <View style={styles.sensorMetricBox}>
                        <Text style={styles.sensorMetricLabel}>💡 POWER</Text>
                        <Text style={styles.sensorMetricVal}>
                          {s.power_watts ? `${s.power_watts.toFixed(1)} W` : `${(s.voltage * s.current).toFixed(1)} W`}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}

              <View style={styles.telemetryNoteBox}>
                <Text style={styles.telemetryNoteText}>
                  ℹ️ Hardware telemetry is actively polled via HTTP every 3 seconds and streamed via WebSocket / MQTT broker for instantaneous zero-latency updates.
                </Text>
              </View>
            </ScrollView>

            {/* Modal Bottom Actions */}
            <View style={{ marginTop: 14 }}>
              <TouchableOpacity
                style={styles.sensorModalCloseBtn}
                activeOpacity={0.8}
                onPress={() => setSensorsModalVisible(false)}
              >
                <Text style={styles.sensorModalCloseBtnText}>Close Monitor</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      </View>
    </CyberBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 45,
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(56, 189, 248, 0.15)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  menuIconButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  menuLine: {
    width: 18,
    height: 2.2,
    backgroundColor: '#38bdf8',
    borderRadius: 1.5,
    marginVertical: 1.8,
  },
  headerBrand: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandIconBox: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderWidth: 1,
    borderColor: '#38bdf8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  brandIcon: {
    color: '#38bdf8',
    fontSize: 15,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  headerSub: {
    color: '#38bdf8',
    fontSize: 8.5,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  statusText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  logoutButton: {
    backgroundColor: 'rgba(239, 68, 68, 0.18)',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
  },
  logoutText: {
    color: '#fca5a5',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  quickTelemetryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    borderWidth: 1.2,
    borderColor: 'rgba(56, 189, 248, 0.4)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 10,
  },
  quickTelemetryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginRight: 6,
  },
  quickTelemetryBadgeText: {
    color: '#38bdf8',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  quickTelemetryText: {
    flex: 1,
    color: '#f1f5f9',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  quickTelemetryAction: {
    color: '#38bdf8',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginLeft: 4,
  },
  // ── Menu Drawer Modal Styles ───────────────────────────────────
  menuOverlay: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(3, 7, 18, 0.78)',
  },
  menuBackdrop: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  menuDrawer: {
    width: '84%',
    maxWidth: 320,
    height: '100%',
    backgroundColor: '#0c1322',
    borderRightWidth: 1.5,
    borderRightColor: 'rgba(56, 189, 248, 0.35)',
    paddingTop: 50,
    paddingHorizontal: 16,
    paddingBottom: 24,
    justifyContent: 'space-between',
    elevation: 20,
    shadowColor: '#38bdf8',
    shadowOpacity: 0.25,
    shadowRadius: 15,
    shadowOffset: { width: 5, height: 0 },
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  drawerBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  drawerLogoBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(56, 189, 248, 0.2)',
    borderWidth: 1,
    borderColor: '#38bdf8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerLogoIcon: {
    color: '#38bdf8',
    fontSize: 18,
  },
  drawerTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  drawerSubTitle: {
    color: '#38bdf8',
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 1,
  },
  drawerCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  drawerCloseText: {
    color: '#94a3b8',
    fontSize: 15,
    fontWeight: 'bold',
  },
  drawerOperatorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(30, 41, 59, 0.7)',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.15)',
    marginBottom: 16,
  },
  drawerOpAvatar: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerOpLabel: {
    color: '#64748b',
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  drawerOpName: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '800',
  },
  drawerStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  drawerDivider: {
    height: 1,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    marginBottom: 16,
  },
  drawerList: {
    flex: 1,
    gap: 12,
  },
  drawerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.65)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.2)',
    gap: 12,
  },
  drawerItemIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drawerItemEmoji: {
    fontSize: 18,
  },
  drawerItemTextCol: {
    flex: 1,
  },
  drawerItemTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 2,
  },
  drawerItemDesc: {
    color: '#94a3b8',
    fontSize: 10,
    lineHeight: 13,
  },
  drawerItemChevron: {
    color: '#38bdf8',
    fontSize: 20,
    fontWeight: '300',
  },
  drawerFooter: {
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(56, 189, 248, 0.15)',
    gap: 10,
  },
  drawerLogoutBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.5)',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  drawerLogoutText: {
    color: '#f87171',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  drawerVersionText: {
    color: '#475569',
    fontSize: 9,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 6,
  },
  sectionTitle: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  sectionBadge: {
    color: '#64748b',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
  twinCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.2)',
    padding: 6,
    overflow: 'hidden',
  },
  routeBanner: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 6,
  },
  routeHint: {
    color: '#94a3b8',
    fontSize: 11,
  },
  routeBold: {
    color: '#38bdf8',
    fontWeight: '700',
  },
  list: {
    flex: 1,
    marginTop: 4,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 25,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  emptyIcon: {
    fontSize: 26,
    marginBottom: 6,
  },
  emptyText: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
  },
  queueItem: {
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderLeftWidth: 4,
  },
  sectionHierarchyHint: {
    color: '#38bdf8',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  queueHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  queueZoneGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  critPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  critPillText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  queueZone: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  queueBadgeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  queueTierPill: {
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  queueMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  queueMetaRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  occBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  queueFault: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600',
  },
  priorityScoreText: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '700',
  },
  queueEngaged: {
    color: '#f59e0b',
    fontSize: 11,
    marginTop: 4,
  },
  queueOpen: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },

  // Bottom Occupancy Bar
  occupancyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 6,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
  },
  occupancyBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  occupancyIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
  },
  occupancyIconEmoji: { fontSize: 16 },
  occupancyBarTitle: { color: '#f8fafc', fontSize: 13, fontWeight: '800' },
  occupancyBarSubtitle: { color: '#94a3b8', fontSize: 10, marginTop: 1 },
  occupancyBarRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  occupancyTotalBadge: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  occupancyTotalBadgeText: { color: '#ffffff', fontSize: 10, fontWeight: '800' },
  occupancyArrow: { color: '#38bdf8', fontSize: 18, fontWeight: 'bold' },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#0b1329',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 18,
    paddingHorizontal: 16,
    maxHeight: '85%',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  modalHeaderTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modalHeaderIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalHeaderIcon: { fontSize: 18 },
  modalTitle: { color: '#ffffff', fontSize: 17, fontWeight: '800' },
  modalSubtitle: { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  modalCloseButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseText: { color: '#94a3b8', fontSize: 15, fontWeight: '600' },

  // Zone Tabs
  zoneTabs: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  zoneTab: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  zoneTabActive: {
    borderColor: '#38bdf8',
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
  },
  zoneTabEmoji: { fontSize: 20, marginBottom: 4 },
  zoneTabCode: { color: '#e2e8f0', fontSize: 14, fontWeight: '800' },
  zoneTabCodeActive: { color: '#38bdf8' },
  zoneTabLabel: { color: '#64748b', fontSize: 9, marginTop: 2, textAlign: 'center' },
  zoneBadge: {
    marginTop: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  zoneBadgeActive: { backgroundColor: '#0284c7' },
  zoneBadgeInactive: { backgroundColor: 'rgba(255, 255, 255, 0.08)' },
  zoneBadgeText: { color: '#94a3b8', fontSize: 9, fontWeight: '700' },
  zoneBadgeTextActive: { color: '#ffffff' },

  // List header
  zoneListHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  zoneListTitle: { color: '#f8fafc', fontSize: 13, fontWeight: '700' },
  zoneListSub: { color: '#94a3b8', fontSize: 11, marginTop: 1 },
  quickActionRow: { flexDirection: 'row', gap: 6 },
  quickActionButton: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
  },
  quickActionText: { color: '#38bdf8', fontSize: 10, fontWeight: '700' },

  // Unit card
  unitList: { maxHeight: 320 },
  unitCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  unitCardOccupied: {
    borderColor: 'rgba(239, 68, 68, 0.4)',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  unitInfo: { flex: 1, marginRight: 10 },
  unitNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  unitName: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  unitCode: { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  unitStatusPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusPillOccupied: { backgroundColor: 'rgba(239, 68, 68, 0.2)' },
  statusPillVacant: { backgroundColor: 'rgba(16, 185, 129, 0.2)' },
  statusPillText: { fontSize: 9, fontWeight: '800' },
  statusPillTextOccupied: { color: '#f87171' },
  statusPillTextVacant: { color: '#34d399' },
  switchWrapper: { justifyContent: 'center', alignItems: 'center' },

  // Server Modal Styles
  serverModalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#0b1329',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
    padding: 24,
    alignItems: 'center',
  },
  serverIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  serverModalTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4,
  },
  serverModalSub: {
    color: '#94a3b8',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
  serverPresetChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.2)',
  },
  serverPresetChipActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.25)',
    borderColor: '#38bdf8',
  },
  serverPresetText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  serverPresetTextActive: {
    color: '#38bdf8',
    fontWeight: '800',
  },
  serverInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(2, 6, 23, 0.7)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
    paddingHorizontal: 14,
    marginTop: 14,
    marginBottom: 10,
    width: '100%',
  },
  serverInputField: {
    flex: 1,
    color: '#ffffff',
    paddingVertical: 12,
    fontSize: 14,
  },
  serverStatusPill: {
    width: '100%',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: 10,
  },
  serverModalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
    width: '100%',
  },
  serverCancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  serverCancelText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
  serverSaveBtn: {
    flex: 1,
    backgroundColor: '#7c3aed',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  serverSaveText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },

  // ── Drawer Telemetry Styles ──
  menuTelemetryCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
    padding: 10,
    marginBottom: 12,
  },
  menuTelemetryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  menuTelemetryTitle: {
    color: '#38bdf8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  espBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  espOnline: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  espOffline: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  espDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  espText: {
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  telemetryRowsContainer: {
    gap: 6,
  },
  sensorRowItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.6)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  sensorRowItemFault: {
    borderColor: 'rgba(239, 68, 68, 0.4)',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  sensorRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  sensorZoneChip: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
  },
  sensorZoneChipText: {
    fontSize: 10,
    fontWeight: '800',
  },
  sensorNameText: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '700',
  },
  sensorMetricsText: {
    color: '#94a3b8',
    fontSize: 9.5,
    fontWeight: '600',
    marginTop: 1,
  },
  sensorStatusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  sensorBadgeFault: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderColor: 'rgba(239, 68, 68, 0.5)',
  },
  sensorBadgeOk: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  sensorBadgeText: {
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  sensorBadgeTextFault: {
    color: '#f87171',
  },
  sensorBadgeTextOk: {
    color: '#34d399',
  },
  openTelemetryBtn: {
    marginTop: 8,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
  },
  openTelemetryBtnText: {
    color: '#38bdf8',
    fontSize: 10.5,
    fontWeight: '700',
  },

  // ── Sensor Modal Styles ──
  sensorModalContainer: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#0f172a',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.4)',
    padding: 16,
  },
  sensorModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  sensorModalTitle: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  sensorModalSub: {
    color: '#38bdf8',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  sensorModalCloseX: {
    padding: 4,
  },
  espStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
  },
  espStatusBarOnline: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  espStatusBarOffline: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: 'rgba(245, 158, 11, 0.35)',
  },
  espStatusBarText: {
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  sensorDetailCard: {
    backgroundColor: 'rgba(30, 41, 59, 0.65)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
    padding: 12,
    marginBottom: 10,
  },
  sensorDetailCardFault: {
    borderColor: 'rgba(239, 68, 68, 0.45)',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  sensorCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sensorZoneChipLg: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
  },
  sensorZoneChipLgText: {
    fontSize: 12,
    fontWeight: '900',
  },
  sensorCardTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  sensorCardSub: {
    color: '#64748b',
    fontSize: 9.5,
    fontWeight: '600',
    marginTop: 1,
  },
  sensorMetricsGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  sensorMetricBox: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    padding: 8,
    alignItems: 'center',
  },
  sensorMetricLabel: {
    color: '#94a3b8',
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  sensorMetricVal: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  telemetryNoteBox: {
    backgroundColor: 'rgba(56, 189, 248, 0.06)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.2)',
    padding: 8,
    marginTop: 2,
    marginBottom: 6,
  },
  telemetryNoteText: {
    color: '#7dd3fc',
    fontSize: 9.5,
    lineHeight: 14,
  },
  sensorModalCloseBtn: {
    backgroundColor: '#0284c7',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  sensorModalCloseBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
});