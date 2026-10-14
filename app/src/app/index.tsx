import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  ScrollView,
  FlatList,
  Animated,
  Easing,
} from 'react-native';
import { router } from 'expo-router';
import {
  loadTechnicianId,
  recordLogin,
  getLoginHistory,
  clearLoginHistory,
  verifyAdmin,
  getAdminKey,
  getServerHost,
  initServerHost,
  onServerHostChange,
  LoginRecord,
} from './session';
import CyberBackground from '../components/CyberBackground';
import AnimatedButton from '../components/AnimatedButton';
import ServerConfigModal from '../components/ServerConfigModal';
import Svg, { Path } from 'react-native-svg';

export default function LoginScreen() {
  const [id, setId] = useState('');
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);

  // Server Host Config Modal
  const [serverModal, setServerModal] = useState(false);
  const [serverHost, setCurrentServerHost] = useState(getServerHost());

  // Admin modal state
  const [adminModal, setAdminModal] = useState(false);
  const [adminPasscode, setAdminPasscode] = useState('');
  const [adminVerifying, setAdminVerifying] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  // History modal state (only shown after admin auth)
  const [historyModal, setHistoryModal] = useState(false);
  const [loginHistoryList, setLoginHistoryList] = useState<LoginRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Shake animation for wrong passcode
  const shakeAnim = useRef(new Animated.Value(0)).current;
  // Ambient logo breathing pulse animation
  const logoPulse = useRef(new Animated.Value(1)).current;
  // Entrance fade & slide
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardTranslateY = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    let isMounted = true;

    async function init() {
      const activeHost = await initServerHost();
      if (isMounted) setCurrentServerHost(activeHost);

      const saved = await loadTechnicianId();
      if (!isMounted) return;
      if (saved) {
        router.replace('/home');
      } else {
        setChecking(false);
      }
    }
    init();

    const unsubHost = onServerHostChange((newHost) => {
      if (isMounted) setCurrentServerHost(newHost);
    });

    // Check if admin is already authenticated in this session
    getAdminKey().then((key) => {
      if (key && isMounted) setIsAdmin(true);
    });

    // Start logo pulse loop
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(logoPulse, {
          toValue: 1.08,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(logoPulse, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();

    // Card entrance animation
    Animated.parallel([
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(cardTranslateY, {
        toValue: 0,
        duration: 800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    return () => {
      isMounted = false;
      unsubHost();
      pulseLoop.stop();
    };
  }, []);

  function shake() {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }

  function handleEnter(targetId?: string) {
    const loginId = (targetId || id).trim();
    if (loginId.length === 0) return;
    setLoading(true);
    // Instant entrance: save session and fire non-blocking audit
    recordLogin(loginId);
    router.replace('/home');
  }

  async function handleAdminLogin() {
    if (!adminPasscode.trim()) return;
    setAdminVerifying(true);
    setAdminError('');
    const ok = await verifyAdmin(adminPasscode.trim());
    setAdminVerifying(false);
    if (ok) {
      setIsAdmin(true);
      setAdminPasscode('');
      setAdminModal(false);
      openHistory(adminPasscode.trim());
    } else {
      setAdminError('Invalid admin passcode. Access denied.');
      shake();
    }
  }

  async function openHistory(keyOverride?: string) {
    const key = keyOverride || (await getAdminKey());
    if (!key) {
      setAdminModal(true);
      return;
    }
    setHistoryLoading(true);
    setHistoryModal(true);
    const list = await getLoginHistory(key);
    setLoginHistoryList(list);
    setHistoryLoading(false);
  }

  async function handleClearHistory() {
    const key = await getAdminKey();
    if (!key) return;
    await clearLoginHistory(key);
    setLoginHistoryList([]);
  }

  // Extract unique recent technicians for quick-select chips
  const recentTechs = Array.from(new Set(loginHistoryList.map((h) => h.technician_id))).slice(0, 4);

  if (checking) {
    return (
      <CyberBackground>
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color="#38bdf8" />
          <Text style={styles.loadingText}>Initializing IntelliAlarm...</Text>
        </View>
      </CyberBackground>
    );
  }

  return (
    <CyberBackground>
      <View style={styles.container}>
        {/* Medical Shield & Pulse Logo */}
        <Animated.View style={[styles.logoWrapper, { transform: [{ scale: logoPulse }] }]}>
          <View style={styles.logoHalo} />
          <Svg width={64} height={64} viewBox="0 0 24 24" fill="none">
            <Path
              d="M12 2L4 5V11.09C4 16.14 7.41 20.85 12 22C16.59 20.85 20 16.14 20 11.09V5L12 2Z"
              fill="rgba(6, 182, 212, 0.15)"
              stroke="#38bdf8"
              strokeWidth={1.75}
            />
            <Path
              d="M7.5 12H9.5L11 9L13 15L14.5 12H16.5"
              stroke="#06b6d4"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Animated.View>

        <Text style={styles.brandTitle}>INTELLIALARM</Text>
        <Text style={styles.brandSubtitle}>CRITICAL HOSPITAL POWER MONITORING • v1.1.0</Text>

        {/* Glassmorphism Login Card */}
        <Animated.View
          style={[
            styles.card,
            {
              opacity: cardOpacity,
              transform: [{ translateY: cardTranslateY }],
            },
          ]}
        >
          <View style={styles.cardGlowBar} />

          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Technician Portal</Text>
            <View style={styles.activePill}>
              <View style={styles.activeDot} />
              <Text style={styles.activeText}>SYSTEM READY</Text>
            </View>
          </View>

          <Text style={styles.inputLabel}>OPERATOR IDENTIFIER</Text>
          <View style={styles.inputWrapper}>
            <Text style={styles.inputIcon}>👤</Text>
            <TextInput
              style={styles.input}
              value={id}
              onChangeText={setId}
              placeholder="Enter Technician ID (e.g. Ravi)"
              placeholderTextColor="#64748b"
              autoCapitalize="words"
              onSubmitEditing={() => handleEnter()}
            />
          </View>

          {/* Quick Selection Chips */}
          {recentTechs.length > 0 && (
            <View style={styles.recentWrapper}>
              <Text style={styles.recentLabel}>Recent:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                {recentTechs.map((tech) => (
                  <AnimatedButton
                    key={tech}
                    scaleTo={0.92}
                    style={styles.chip}
                    onPress={() => {
                      setId(tech);
                      handleEnter(tech);
                    }}
                  >
                    <Text style={styles.chipText}>{tech}</Text>
                  </AnimatedButton>
                ))}
              </ScrollView>
            </View>
          )}

          <AnimatedButton
            scaleTo={0.97}
            style={[styles.button, (!id.trim() && !loading) && styles.buttonDisabled]}
            onPress={() => handleEnter()}
            disabled={loading || !id.trim()}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.buttonText}>AUTHENTICATE & ENTER ›</Text>
            )}
          </AnimatedButton>

          {/* Admin Access Button */}
          <View style={styles.adminRow}>
            <View style={styles.adminDivider} />
            <Text style={styles.adminDividerText}>ADMIN</Text>
            <View style={styles.adminDivider} />
          </View>
          <AnimatedButton
            scaleTo={0.97}
            style={[styles.adminBtn, isAdmin && styles.adminBtnActive]}
            onPress={() => openHistory()}
          >
            <Text style={styles.adminBtnText}>
              {isAdmin ? '🔓 View Login Audit Log' : '🔐 Admin Access — Login History'}
            </Text>
          </AnimatedButton>
        </Animated.View>

        {/* Server Host Quick Status & Switcher */}
        <TouchableOpacity
          style={styles.serverPill}
          onPress={() => setServerModal(true)}
          activeOpacity={0.7}
        >
          <View style={styles.serverDot} />
          <Text style={styles.serverText}>Server: {serverHost}</Text>
          <Text style={styles.serverEditHint}>⚙️ Edit</Text>
        </TouchableOpacity>

        <Text style={styles.footerNote}>v1.1.0 • ML RISK FORMULA ACTIVE • HOSPITAL RESILIENCE TWIN</Text>

        {/* ── Reusable Server Config Modal ── */}
        <ServerConfigModal
          visible={serverModal}
          onClose={() => setServerModal(false)}
          onServerChanged={(newHost) => setCurrentServerHost(newHost)}
        />

        {/* ── Admin Passcode Modal ── */}
        <Modal
          visible={adminModal}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setAdminModal(false);
            setAdminPasscode('');
            setAdminError('');
          }}
        >
          <View style={styles.modalBackdrop}>
            <Animated.View style={[styles.adminModalCard, { transform: [{ translateX: shakeAnim }] }]}>
              <View style={styles.lockIconWrap}>
                <Text style={styles.lockIcon}>🔒</Text>
              </View>
              <Text style={styles.adminModalTitle}>Admin Authentication</Text>
              <Text style={styles.adminModalSub}>
                Enter the admin passcode to access the Login Audit Log
              </Text>

              <View style={[styles.inputWrapper, { marginTop: 20 }]}>
                <Text style={styles.inputIcon}>🔑</Text>
                <TextInput
                  style={styles.input}
                  value={adminPasscode}
                  onChangeText={(v) => {
                    setAdminPasscode(v);
                    setAdminError('');
                  }}
                  placeholder="Admin Passcode"
                  placeholderTextColor="#64748b"
                  secureTextEntry
                  autoCapitalize="none"
                  onSubmitEditing={handleAdminLogin}
                />
              </View>

              {adminError ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>⛔ {adminError}</Text>
                </View>
              ) : null}

              <View style={styles.modalFooter}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => {
                    setAdminModal(false);
                    setAdminPasscode('');
                    setAdminError('');
                  }}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, { flex: 1 }]}
                  onPress={handleAdminLogin}
                  disabled={adminVerifying || !adminPasscode.trim()}
                >
                  {adminVerifying ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.buttonText}>VERIFY ACCESS</Text>
                  )}
                </TouchableOpacity>
              </View>
            </Animated.View>
          </View>
        </Modal>

        {/* ── Login History Modal (admin-only) ── */}
        <Modal
          visible={historyModal}
          transparent
          animationType="fade"
          onRequestClose={() => setHistoryModal(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>🔓 Login Audit Log</Text>
                  <Text style={styles.modalSubtitle}>Admin View — Recorded technician authentication events</Text>
                </View>
                <TouchableOpacity style={styles.closeBtn} onPress={() => setHistoryModal(false)}>
                  <Text style={styles.closeBtnText}>✕</Text>
                </TouchableOpacity>
              </View>

              {historyLoading ? (
                <View style={styles.emptyBox}>
                  <ActivityIndicator size="large" color="#38bdf8" />
                  <Text style={[styles.emptyText, { marginTop: 12 }]}>Loading records...</Text>
                </View>
              ) : (
                <FlatList
                  data={loginHistoryList}
                  keyExtractor={(item, index) => String(item.id || index)}
                  style={styles.historyList}
                  ListEmptyComponent={
                    <View style={styles.emptyBox}>
                      <Text style={styles.emptyIcon}>📋</Text>
                      <Text style={styles.emptyText}>No login history recorded yet</Text>
                    </View>
                  }
                  renderItem={({ item }) => (
                    <View style={styles.historyRow}>
                      <View style={styles.historyAvatar}>
                        <Text style={styles.avatarText}>
                          {item.technician_id ? item.technician_id.substring(0, 2).toUpperCase() : 'OP'}
                        </Text>
                      </View>
                      <View style={styles.historyInfo}>
                        <View style={styles.historyRowTop}>
                          <Text style={styles.historyName}>{item.technician_id}</Text>
                          <Text style={styles.historyBadge}>AUTHENTICATED</Text>
                        </View>
                        <Text style={styles.historyDevice}>Device: {item.device_info || 'Browser'}</Text>
                        <Text style={styles.historyTime}>
                          {new Date(item.logged_in_at).toLocaleString()}
                        </Text>
                      </View>
                    </View>
                  )}
                />
              )}

              <View style={styles.modalFooter}>
                {loginHistoryList.length > 0 && (
                  <TouchableOpacity style={styles.clearBtn} onPress={handleClearHistory}>
                    <Text style={styles.clearBtnText}>🗑 Clear History</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.doneBtn} onPress={() => setHistoryModal(false)}>
                  <Text style={styles.doneBtnText}>Close</Text>
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#94a3b8',
    marginTop: 14,
    fontSize: 14,
    letterSpacing: 1,
  },
  logoWrapper: {
    marginBottom: 16,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoHalo: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
  },
  brandTitle: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 3,
    textAlign: 'center',
  },
  brandSubtitle: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
    marginTop: 4,
    marginBottom: 28,
    textAlign: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.22)',
    shadowColor: '#0284c7',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 25,
    elevation: 8,
    position: 'relative',
    overflow: 'hidden',
  },
  cardGlowBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: '#38bdf8',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  cardTitle: {
    color: '#f1f5f9',
    fontSize: 18,
    fontWeight: '700',
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
    marginRight: 6,
  },
  activeText: {
    color: '#34d399',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  inputLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(2, 6, 23, 0.7)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  inputIcon: {
    fontSize: 18,
    marginRight: 10,
  },
  input: {
    flex: 1,
    color: '#ffffff',
    paddingVertical: 14,
    fontSize: 15,
  },
  recentWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  recentLabel: {
    color: '#64748b',
    fontSize: 12,
    marginRight: 8,
  },
  chipRow: {
    flexDirection: 'row',
  },
  chip: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    marginRight: 8,
  },
  chipText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '600',
  },
  button: {
    backgroundColor: '#0284c7',
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#38bdf8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
  },
  adminRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
    marginBottom: 12,
    gap: 10,
  },
  adminDivider: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(139, 92, 246, 0.25)',
  },
  adminDividerText: {
    color: '#7c3aed',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
  },
  adminBtn: {
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.4)',
    backgroundColor: 'rgba(139, 92, 246, 0.08)',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  adminBtnActive: {
    borderColor: '#7c3aed',
    backgroundColor: 'rgba(139, 92, 246, 0.18)',
  },
  adminBtnText: {
    color: '#a78bfa',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  serverPill: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
    gap: 8,
  },
  serverDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#38bdf8',
  },
  serverText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  serverEditHint: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '700',
  },
  footerNote: {
    color: '#475569',
    fontSize: 10,
    letterSpacing: 1.5,
    marginTop: 20,
    textAlign: 'center',
  },
  adminModalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#0b0f1e',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.4)',
    padding: 28,
    alignItems: 'center',
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
  },
  serverModalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#0b1329',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    padding: 24,
    alignItems: 'center',
  },
  presetsWrapper: {
    width: '100%',
    marginTop: 14,
  },
  presetsLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 6,
  },
  presetChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  presetChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.2)',
  },
  presetChipActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.25)',
    borderColor: '#38bdf8',
  },
  presetChipText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  presetChipTextActive: {
    color: '#38bdf8',
    fontWeight: '800',
  },
  statusBanner: {
    width: '100%',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 6,
    marginBottom: 6,
    alignItems: 'center',
  },
  lockIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  lockIcon: {
    fontSize: 28,
  },
  adminModalTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 6,
    textAlign: 'center',
  },
  adminModalSub: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  errorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
    width: '100%',
  },
  errorText: {
    color: '#f87171',
    fontSize: 13,
    textAlign: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '80%',
    backgroundColor: '#0b1329',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    paddingBottom: 14,
    marginBottom: 12,
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  modalSubtitle: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: 'bold',
  },
  historyList: {
    flexGrow: 0,
    maxHeight: 380,
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 35,
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  emptyText: {
    color: '#64748b',
    fontSize: 14,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.12)',
    marginBottom: 8,
  },
  historyAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderWidth: 1,
    borderColor: '#38bdf8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#38bdf8',
    fontWeight: '800',
    fontSize: 14,
  },
  historyInfo: {
    flex: 1,
  },
  historyRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyName: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
  historyBadge: {
    color: '#10b981',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    fontSize: 9,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  historyDevice: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  historyTime: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 2,
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    paddingTop: 14,
    marginTop: 10,
    gap: 10,
    width: '100%',
  },
  clearBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  clearBtnText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '600',
  },
  doneBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  doneBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  cancelBtnText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
});