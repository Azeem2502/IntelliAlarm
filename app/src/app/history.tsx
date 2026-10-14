import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import {
  getBackendUrl,
  getServerHost,
  onServerHostChange,
  fetchWithTimeout,
  getLoginHistory,
  clearLoginHistory,
  verifyAdmin,
  getAdminKey,
  clearAdminSession,
  LoginRecord,
} from './session';
import CyberBackground from '../components/CyberBackground';
import AnimatedButton from '../components/AnimatedButton';
import ServerConfigModal from '../components/ServerConfigModal';

const FAULT_CACHE_KEY = 'intellialarm_fault_history_cache';

const DEFAULT_SAMPLE_FAULTS = [
  {
    zone: 'ICU',
    fault_type: 'short_circuit',
    tier: 'High',
    created_at: '2026-09-19T14:46:18',
    status: 'completed',
    criticality: 'Life Safety',
    priority_score: 88.5,
    completed_by: 'Ravi',
    completed_at: '2026-09-19T14:48:10',
  },
  {
    zone: 'ER',
    fault_type: 'earth_leakage',
    tier: 'High',
    created_at: '2026-09-19T14:46:13',
    status: 'open',
    criticality: 'Critical',
    priority_score: 64.2,
    engaged_by: 'Azeem',
    engaged_at: '2026-09-19T14:47:00',
  },
  {
    zone: 'OT',
    fault_type: 'voltage_sag',
    tier: 'Medium',
    created_at: '2026-09-19T14:46:02',
    status: 'open',
    criticality: 'Life Safety',
    priority_score: 52.8,
  },
  {
    zone: 'ER',
    fault_type: 'short_circuit',
    tier: 'Medium',
    created_at: '2026-09-19T14:32:04',
    status: 'completed',
    criticality: 'Equipment',
    priority_score: 38.4,
    completed_by: 'Azeem',
    completed_at: '2026-09-19T14:35:12',
  },
  {
    zone: 'ICU',
    fault_type: 'outage',
    tier: 'High',
    created_at: '2026-09-19T14:31:18',
    status: 'completed',
    criticality: 'Life Safety',
    priority_score: 91.2,
    completed_by: 'Dr. Suresh',
    completed_at: '2026-09-19T14:33:45',
  },
];

function safeFormatDate(dateStr?: string | null): string {
  if (!dateStr) return 'N/A';
  try {
    const clean = String(dateStr).trim().replace(' ', 'T');
    const d = new Date(clean);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }) + ' ' + d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(dateStr);
  }
}

function safeFormatTime(dateStr?: string | null): string {
  if (!dateStr) return 'N/A';
  try {
    const clean = String(dateStr).trim().replace(' ', 'T');
    const d = new Date(clean);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(dateStr);
  }
}

function tierColor(tier?: string) {
  if (tier === 'High') return '#ef4444';
  if (tier === 'Medium') return '#f59e0b';
  if (tier === 'Low') return '#38bdf8';
  return '#10b981';
}

function criticalityBadgeInfo(criticality?: string) {
  if (criticality === 'Life Safety') {
    return { icon: '🛡️', label: 'LIFE SAFETY', color: '#f43f5e', bg: 'rgba(244, 63, 94, 0.15)' };
  }
  if (criticality === 'Critical') {
    return { icon: '⚡', label: 'CRITICAL', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' };
  }
  return { icon: '⚙️', label: 'EQUIPMENT', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.15)' };
}

export default function HistoryScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [activeTab, setActiveTab] = useState<'faults' | 'logins'>(
    params.tab === 'login' || params.tab === 'logins' ? 'logins' : 'faults'
  );
  const [records, setRecords] = useState<any[]>([]);
  const [loginRecords, setLoginRecords] = useState<LoginRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingFaults, setLoadingFaults] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [serverModal, setServerModal] = useState(false);
  const [serverHost, setServerHostState] = useState(getServerHost());

  // Admin lock state for login tab
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPasscode, setAdminPasscode] = useState('');
  const [adminError, setAdminError] = useState('');
  const [adminVerifying, setAdminVerifying] = useState(false);


  // Sync tab with navigation params
  useEffect(() => {
    if (params.tab === 'login' || params.tab === 'logins') {
      setActiveTab('logins');
    } else if (params.tab === 'faults') {
      setActiveTab('faults');
    }
  }, [params.tab]);

  // Load cached records immediately from local storage on mount
  useEffect(() => {
    async function initCache() {
      try {
        const cached = await AsyncStorage.getItem(FAULT_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setRecords(parsed);
            setLoadingFaults(false);
          }
        } else {
          // Pre-seed sample faults so screen is never blank
          setRecords(DEFAULT_SAMPLE_FAULTS);
          await AsyncStorage.setItem(FAULT_CACHE_KEY, JSON.stringify(DEFAULT_SAMPLE_FAULTS));
          setLoadingFaults(false);
        }
      } catch (e) {
        setRecords(DEFAULT_SAMPLE_FAULTS);
        setLoadingFaults(false);
      }
    }

    initCache();

    // Check stored admin session on mount
    getAdminKey().then((key) => {
      if (key) {
        setIsAdmin(true);
        loadLogins(key);
      }
    });
  }, []);

  const loadFaults = useCallback(async () => {
    try {
      const res = await fetchWithTimeout(`${getBackendUrl()}/history`, {}, 3500);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          const filtered = data.filter((d: any) => d.zone !== 'Imaging');
          setRecords(filtered);
          setIsOffline(false);
          await AsyncStorage.setItem(FAULT_CACHE_KEY, JSON.stringify(filtered));
          setLoadingFaults(false);
          return;
        }
      }
      setIsOffline(true);
    } catch {
      setIsOffline(true);
    } finally {
      setLoadingFaults(false);
    }
  }, []);

  const loadLogins = useCallback(async (key?: string) => {
    const k = key || (await getAdminKey());
    if (!k) return;
    const data = await getLoginHistory(k);
    setLoginRecords(data);
  }, []);

  const loadAll = useCallback(() => {
    setRefreshing(true);
    loadFaults().finally(() => {
      getAdminKey().then((key) => {
        if (key) loadLogins(key);
        setRefreshing(false);
      });
    });
  }, [loadFaults, loadLogins]);

  useEffect(() => {
    loadFaults();
  }, [loadFaults]);

  // Reactively listen to server changes from anywhere in the app
  useEffect(() => {
    const unsub = onServerHostChange((newHost) => {
      setServerHostState(newHost);
      loadFaults();
      getAdminKey().then((key) => {
        if (key) loadLogins(key);
      });
    });
    return unsub;
  }, [loadFaults, loadLogins]);

  async function handleAdminUnlock() {
    if (!adminPasscode.trim()) return;
    setAdminVerifying(true);
    setAdminError('');
    const ok = await verifyAdmin(adminPasscode.trim());
    setAdminVerifying(false);
    if (ok) {
      setIsAdmin(true);
      setAdminError('');
      loadLogins(adminPasscode.trim());
      setAdminPasscode('');
    } else {
      setAdminError('Invalid passcode. Admin access only.');
    }
  }

  async function handleAdminLock() {
    await clearAdminSession();
    setIsAdmin(false);
    setLoginRecords([]);
  }

  async function handleClearLogins() {
    const key = await getAdminKey();
    if (!key) return;
    await clearLoginHistory(key);
    setLoginRecords([]);
  }

  return (
    <CyberBackground>
      <View style={styles.container}>
        {/* Navigation & Header */}
        <View style={styles.header}>
          <AnimatedButton scaleTo={0.92} style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backText}>‹ Back</Text>
          </AnimatedButton>
          <Text style={styles.headerTitle}>System Audit Logs</Text>
          {isAdmin && activeTab === 'logins' ? (
            <AnimatedButton scaleTo={0.92} style={styles.lockIconBtn} onPress={handleAdminLock}>
              <Text style={styles.lockIconText}>🔒 Lock</Text>
            </AnimatedButton>
          ) : (
            <View style={{ width: 60 }} />
          )}
        </View>

        {/* Tab Switcher */}
        <View style={styles.tabContainer}>
          <AnimatedButton
            scaleTo={0.96}
            style={[styles.tabBtn, activeTab === 'faults' && styles.tabBtnActive]}
            onPress={() => setActiveTab('faults')}
          >
            <Text style={[styles.tabText, activeTab === 'faults' && styles.tabTextActive]}>
              ⚠️ Fault History ({records.length})
            </Text>
          </AnimatedButton>

          <AnimatedButton
            scaleTo={0.96}
            style={[styles.tabBtn, activeTab === 'logins' && styles.tabBtnActive]}
            onPress={() => setActiveTab('logins')}
          >
            <Text style={[styles.tabText, activeTab === 'logins' && styles.tabTextActive]}>
              {isAdmin ? `👤 Logins (${loginRecords.length})` : '🔐 Logins (Admin)'}
            </Text>
          </AnimatedButton>
        </View>

        {/* Status Indicator & Server Switcher Banner */}
        <View style={styles.syncStatusRow}>
          <TouchableOpacity
            style={isOffline ? styles.offlineBanner : styles.liveBanner}
            onPress={() => setServerModal(true)}
            activeOpacity={0.7}
          >
            {isOffline ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <Text style={styles.offlineBannerText}>
                  ⚠️ Server Offline ({serverHost})
                </Text>
                <Text style={{ color: '#fbbf24', fontSize: 11, fontWeight: '700' }}>🌐 Switch Server</Text>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveBannerText}>LIVE SYNCED ({serverHost}:8000)</Text>
                </View>
                <Text style={{ color: '#38bdf8', fontSize: 10, fontWeight: '700' }}>🌐 Change</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Reusable Server Config Modal */}
        <ServerConfigModal
          visible={serverModal}
          onClose={() => setServerModal(false)}
          onServerChanged={(newHost) => {
            setServerHostState(newHost);
            loadFaults();
          }}
        />

        {/* Content */}
        {activeTab === 'faults' ? (
          loadingFaults && records.length === 0 ? (
            <View style={styles.centerLoading}>
              <ActivityIndicator size="large" color="#38bdf8" />
              <Text style={styles.loadingText}>Retrieving fault incident records...</Text>
            </View>
          ) : (
            <FlatList
              data={records}
              keyExtractor={(_, i) => String(i)}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadAll} tintColor="#38bdf8" />}
              ListEmptyComponent={
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyIcon}>🛡️</Text>
                  <Text style={styles.emptyTitle}>No Fault Events Recorded</Text>
                  <Text style={styles.emptySub}>All systems operating at normal parameters</Text>
                </View>
              }
              renderItem={({ item }) => {
                const crit = criticalityBadgeInfo(item.criticality);
                const faultType = (item.fault_type || 'Unknown Fault').replace(/_/g, ' ').toUpperCase();
                const zone = item.zone || 'Zone';
                const status = (item.status || 'open').toUpperCase();
                const isDone = status === 'COMPLETED';

                return (
                  <View style={[styles.card, { borderLeftColor: crit.color, borderLeftWidth: 4 }]}>
                    <View style={styles.cardHeader}>
                      <View style={styles.zoneRow}>
                        <Text style={styles.zoneBadge}>{zone}</Text>
                        <View style={[styles.critBadge, { backgroundColor: crit.bg, borderColor: crit.color }]}>
                          <Text style={[styles.critBadgeText, { color: crit.color }]}>
                            {crit.icon} {crit.label}
                          </Text>
                        </View>
                        <Text style={[styles.tierBadge, { color: tierColor(item.tier) }]}>{item.tier || 'Standard'} Risk</Text>
                      </View>
                      <Text style={[styles.statusBadge, isDone ? styles.statusDone : styles.statusOpen]}>
                        {status}
                      </Text>
                    </View>

                    <View style={styles.faultTitleRow}>
                      <Text style={styles.faultName}>{faultType}</Text>
                      {item.priority_score ? (
                        <View style={styles.scoreBadge}>
                          <Text style={styles.scoreText}>Score: {Number(item.priority_score).toFixed(1)}</Text>
                        </View>
                      ) : null}
                    </View>

                    <Text style={styles.timeText}>🕒 Detected: {safeFormatDate(item.created_at)}</Text>

                    {item.engaged_by && (
                      <View style={styles.technicianRow}>
                        <Text style={styles.techIcon}>🛠️</Text>
                        <Text style={styles.techText}>
                          Engaged by <Text style={styles.highlight}>{item.engaged_by}</Text> at {safeFormatTime(item.engaged_at)}
                        </Text>
                      </View>
                    )}
                    {item.completed_by && (
                      <View style={styles.technicianRow}>
                        <Text style={styles.techIcon}>✅</Text>
                        <Text style={styles.techText}>
                          Resolved by <Text style={styles.highlight}>{item.completed_by}</Text> at {safeFormatTime(item.completed_at)}
                        </Text>
                      </View>
                    )}
                  </View>
                );
              }}
            />
          )
        ) : !isAdmin ? (
          /* Locked State for non-admin */
          <View style={styles.lockedContainer}>
            <View style={styles.lockBox}>
              <View style={styles.lockIconCircle}>
                <Text style={styles.lockBigIcon}>🔒</Text>
              </View>
              <Text style={styles.lockTitle}>Admin Verification Required</Text>
              <Text style={styles.lockSub}>
                Technician login history is restricted. Enter admin passcode to unlock and view records.
              </Text>

              <View style={styles.adminPassWrapper}>
                <TextInput
                  style={styles.adminPassInput}
                  value={adminPasscode}
                  onChangeText={(v) => {
                    setAdminPasscode(v);
                    setAdminError('');
                  }}
                  placeholder="Enter admin passcode"
                  placeholderTextColor="#64748b"
                  secureTextEntry
                  autoCapitalize="none"
                  onSubmitEditing={handleAdminUnlock}
                />
              </View>

              {adminError ? (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorBannerText}>⛔ {adminError}</Text>
                </View>
              ) : null}

              <AnimatedButton
                scaleTo={0.96}
                style={[styles.unlockBtn, (!adminPasscode.trim() || adminVerifying) && styles.unlockBtnDisabled]}
                onPress={handleAdminUnlock}
                disabled={!adminPasscode.trim() || adminVerifying}
              >
                {adminVerifying ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.unlockBtnText}>VERIFY & VIEW LOGS ›</Text>
                )}
              </AnimatedButton>
            </View>
          </View>
        ) : (
          /* Unlocked Admin View of Login Records */
          <View style={{ flex: 1 }}>
            <View style={styles.actionRow}>
              <View style={styles.adminActiveBadge}>
                <View style={styles.adminActiveDot} />
                <Text style={styles.adminActiveText}>ADMIN ACCESS ACTIVE</Text>
              </View>
              {loginRecords.length > 0 && (
                <TouchableOpacity style={styles.clearLink} onPress={handleClearLogins}>
                  <Text style={styles.clearLinkText}>🗑 Clear Logins</Text>
                </TouchableOpacity>
              )}
            </View>
            <FlatList
              data={loginRecords}
              keyExtractor={(item, i) => String(item.id || i)}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadAll} tintColor="#38bdf8" />}
              ListEmptyComponent={
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyIcon}>👤</Text>
                  <Text style={styles.emptyTitle}>No Login Records Found</Text>
                  <Text style={styles.emptySub}>Technician logins will appear here in real time</Text>
                </View>
              }
              renderItem={({ item }) => (
                <View style={styles.loginCard}>
                  <View style={styles.loginAvatar}>
                    <Text style={styles.avatarLetter}>
                      {item.technician_id ? item.technician_id.substring(0, 2).toUpperCase() : 'TC'}
                    </Text>
                  </View>
                  <View style={styles.loginContent}>
                    <View style={styles.loginTop}>
                      <Text style={styles.loginName}>{item.technician_id}</Text>
                      <View style={styles.authBadge}>
                        <View style={styles.authDot} />
                        <Text style={styles.authText}>AUTHENTICATED</Text>
                      </View>
                    </View>
                    <Text style={styles.loginDevice}>💻 {item.device_info || 'Browser client'}</Text>
                    <Text style={styles.loginTime}>🕒 {safeFormatDate(item.logged_in_at)}</Text>
                  </View>
                </View>
              )}
            />
          </View>
        )}
      </View>
    </CyberBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 45,
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  backBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
  },
  backText: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: '700',
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1,
  },
  lockIconBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  lockIconText: {
    color: '#f87171',
    fontSize: 12,
    fontWeight: '700',
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderRadius: 12,
    padding: 4,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.2)',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabBtnActive: {
    backgroundColor: '#0284c7',
    shadowColor: '#38bdf8',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  tabText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#ffffff',
    fontWeight: '800',
  },
  syncStatusRow: {
    marginBottom: 12,
  },
  liveBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
    marginRight: 6,
  },
  liveBannerText: {
    color: '#34d399',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  offlineBanner: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    alignItems: 'center',
  },
  offlineBannerText: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '700',
  },
  centerLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 12,
  },
  card: {
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  zoneRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  zoneBadge: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
    marginRight: 2,
  },
  critBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  critBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  tierBadge: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusBadge: {
    fontSize: 9,
    fontWeight: '800',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
    flexShrink: 0,
    marginLeft: 6,
  },
  statusOpen: {
    color: '#f59e0b',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  statusDone: {
    color: '#10b981',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  faultTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
    marginTop: 2,
  },
  faultName: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '700',
  },
  scoreBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
  },
  scoreText: {
    color: '#38bdf8',
    fontSize: 10,
    fontWeight: '700',
  },
  timeText: {
    color: '#64748b',
    fontSize: 11,
    marginBottom: 4,
  },
  technicianRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
  },
  techIcon: {
    fontSize: 11,
    marginRight: 5,
  },
  techText: {
    color: '#94a3b8',
    fontSize: 11,
  },
  highlight: {
    color: '#38bdf8',
    fontWeight: '700',
  },
  lockedContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  lockBox: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
    padding: 28,
    alignItems: 'center',
  },
  lockIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  lockBigIcon: {
    fontSize: 28,
  },
  lockTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  lockSub: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  adminPassWrapper: {
    width: '100%',
    backgroundColor: 'rgba(2, 6, 23, 0.8)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  adminPassInput: {
    color: '#ffffff',
    paddingVertical: 12,
    fontSize: 15,
  },
  errorBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 8,
    padding: 8,
    marginBottom: 12,
    width: '100%',
  },
  errorBannerText: {
    color: '#f87171',
    fontSize: 12,
    textAlign: 'center',
  },
  unlockBtn: {
    width: '100%',
    backgroundColor: '#7c3aed',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  unlockBtnDisabled: {
    opacity: 0.45,
  },
  unlockBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  adminActiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  adminActiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#a78bfa',
    marginRight: 6,
  },
  adminActiveText: {
    color: '#c4b5fd',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  clearLink: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  clearLinkText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '600',
  },
  loginCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.15)',
  },
  loginAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderWidth: 1.5,
    borderColor: '#38bdf8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarLetter: {
    color: '#38bdf8',
    fontSize: 16,
    fontWeight: '800',
  },
  loginContent: {
    flex: 1,
  },
  loginTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  loginName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  authBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  authDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#10b981',
    marginRight: 5,
  },
  authText: {
    color: '#34d399',
    fontSize: 9,
    fontWeight: '800',
  },
  loginDevice: {
    color: '#94a3b8',
    fontSize: 12,
    marginBottom: 2,
  },
  loginTime: {
    color: '#64748b',
    fontSize: 11,
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  emptyTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  emptySub: {
    color: '#64748b',
    fontSize: 13,
    marginTop: 4,
  },
});