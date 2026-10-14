import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import {
  getServerHost,
  setServerHost,
  testServerConnection,
  autoDiscoverServer,
  PRESET_SERVER_HOSTS,
  cleanHost,
  isSecureHost,
} from '../app/session';

interface ServerConfigModalProps {
  visible: boolean;
  onClose: () => void;
  onServerChanged?: (newHost: string) => void;
}

export default function ServerConfigModal({
  visible,
  onClose,
  onServerChanged,
}: ServerConfigModalProps) {
  const [activeHost, setActiveHost] = useState(getServerHost());
  const [inputHost, setInputHost] = useState(getServerHost());
  const [testing, setTesting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryMsg, setDiscoveryMsg] = useState('');
  const [testResult, setTestResult] = useState<{
    tested: boolean;
    ok: boolean;
    text: string;
  } | null>(null);

  useEffect(() => {
    if (visible) {
      const current = getServerHost();
      setActiveHost(current);
      setInputHost(current);
      setTestResult(null);
      setDiscovering(false);
      setDiscoveryMsg('');
    }
  }, [visible]);

  async function handleAutoDiscover() {
    setDiscovering(true);
    setDiscoveryMsg('Scanning local Wi-Fi for IntelliAlarm server...');
    setTestResult(null);
    const found = await autoDiscoverServer((msg) => {
      setDiscoveryMsg(msg);
    });
    setDiscovering(false);
    if (found) {
      setInputHost(found);
      setActiveHost(found);
      onServerChanged?.(found);
      setTestResult({
        tested: true,
        ok: true,
        text: `Connected • Server located at ${found}:8000`,
      });
    } else {
      setTestResult({
        tested: true,
        ok: false,
        text: 'Could not auto-detect server on this Wi-Fi. Please check PC hotspot or enter manually.',
      });
    }
  }

  async function handleTest() {
    const target = cleanHost(inputHost);
    setTesting(true);
    setTestResult(null);
    const res = await testServerConnection(target);
    setTesting(false);
    setTestResult({
      tested: true,
      ok: res.ok,
      text: res.ok ? `Connected • ${res.statusText}` : `Failed • ${res.statusText}`,
    });
  }

  async function handleSaveAndApply() {
    const target = cleanHost(inputHost);
    if (!target) return;
    const applied = await setServerHost(target);
    setActiveHost(applied);
    onServerChanged?.(applied);
    onClose();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Header Icon */}
          <View style={styles.iconCircle}>
            <Text style={styles.iconText}>🌐</Text>
          </View>

          <Text style={styles.title}>Server Network IP</Text>
          <Text style={styles.subtitle}>
            Connect the app to your computer running the IntelliAlarm backend.
          </Text>

          {/* Active Server Pill */}
          <View style={styles.activePill}>
            <View style={styles.activeDot} />
            <Text style={styles.activeText}>
              Active: {isSecureHost(activeHost) ? activeHost : `${activeHost}:8000`}
            </Text>
          </View>

          {/* Auto-Discover Button */}
          <TouchableOpacity
            style={styles.autoDetectBtn}
            onPress={handleAutoDiscover}
            disabled={discovering}
            activeOpacity={0.8}
          >
            {discovering ? (
              <ActivityIndicator size="small" color="#38bdf8" style={{ marginRight: 8 }} />
            ) : (
              <Text style={{ fontSize: 14, marginRight: 6 }}>🔍</Text>
            )}
            <Text style={styles.autoDetectBtnText}>
              {discovering ? (discoveryMsg || 'Scanning Network...') : 'Auto-Detect Server on Wi-Fi'}
            </Text>
          </TouchableOpacity>

          {/* Presets */}
          <View style={styles.presetsSection}>
            <Text style={styles.presetsTitle}>QUICK PRESETS</Text>
            <View style={styles.presetsRow}>
              {PRESET_SERVER_HOSTS.map((preset) => {
                const isSelected = cleanHost(inputHost) === cleanHost(preset);
                return (
                  <TouchableOpacity
                    key={preset}
                    style={[styles.presetChip, isSelected && styles.presetChipSelected]}
                    onPress={() => {
                      setInputHost(preset);
                      setTestResult(null);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.presetChipText, isSelected && styles.presetChipTextSelected]}>
                      {preset}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Input Field */}
          <Text style={styles.inputLabel}>SERVER IP ADDRESS / HOST</Text>
          <View style={styles.inputWrap}>
            <Text style={styles.inputIcon}>📡</Text>
            <TextInput
              style={styles.input}
              value={inputHost}
              onChangeText={(val) => {
                setInputHost(val);
                setTestResult(null);
              }}
              placeholder="e.g. 192.168.137.103"
              placeholderTextColor="#64748b"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {inputHost ? (
              <TouchableOpacity onPress={() => setInputHost('')} style={styles.clearBtn}>
                <Text style={styles.clearBtnText}>✕</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Test Status Banner */}
          {testResult ? (
            <View style={[styles.testBanner, testResult.ok ? styles.testBannerOk : styles.testBannerFail]}>
              <Text style={[styles.testBannerText, testResult.ok ? styles.testTextOk : styles.testTextFail]}>
                {testResult.ok ? '✅ ' : '⚠️ '} {testResult.text}
              </Text>
            </View>
          ) : null}

          {/* Action Buttons */}
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={styles.testBtn}
              onPress={handleTest}
              disabled={testing || !inputHost.trim()}
              activeOpacity={0.7}
            >
              {testing ? (
                <ActivityIndicator size="small" color="#38bdf8" />
              ) : (
                <Text style={styles.testBtnText}>⚡ Test Ping</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.saveBtn, !inputHost.trim() && styles.saveBtnDisabled]}
              onPress={handleSaveAndApply}
              disabled={!inputHost.trim()}
              activeOpacity={0.8}
            >
              <Text style={styles.saveBtnText}>💾 SAVE & SWITCH</Text>
            </TouchableOpacity>
          </View>

          {/* Cancel / Close */}
          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#0b1329',
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.35)',
    padding: 24,
    alignItems: 'center',
    shadowColor: '#38bdf8',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  iconText: {
    fontSize: 28,
  },
  title: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 4,
    textAlign: 'center',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 14,
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    marginBottom: 16,
    gap: 6,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
  },
  activeText: {
    color: '#34d399',
    fontSize: 11,
    fontWeight: '700',
  },
  autoDetectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    borderWidth: 1.2,
    borderColor: 'rgba(56, 189, 248, 0.4)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    width: '100%',
    marginBottom: 14,
  },
  autoDetectBtnText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  presetsSection: {
    width: '100%',
    marginBottom: 14,
  },
  presetsTitle: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 6,
  },
  presetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  presetChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.2)',
  },
  presetChipSelected: {
    backgroundColor: 'rgba(56, 189, 248, 0.25)',
    borderColor: '#38bdf8',
  },
  presetChipText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  presetChipTextSelected: {
    color: '#38bdf8',
    fontWeight: '800',
  },
  inputLabel: {
    alignSelf: 'flex-start',
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 6,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(2, 6, 23, 0.8)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    paddingHorizontal: 12,
    width: '100%',
    marginBottom: 12,
  },
  inputIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  input: {
    flex: 1,
    color: '#ffffff',
    paddingVertical: 12,
    fontSize: 14,
  },
  clearBtn: {
    padding: 6,
  },
  clearBtnText: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: 'bold',
  },
  testBanner: {
    width: '100%',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
    alignItems: 'center',
  },
  testBannerOk: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: '#10b981',
  },
  testBannerFail: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderColor: '#f59e0b',
  },
  testBannerText: {
    fontSize: 12,
    fontWeight: '700',
  },
  testTextOk: {
    color: '#34d399',
  },
  testTextFail: {
    color: '#fbbf24',
  },
  buttonRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
    marginTop: 4,
  },
  testBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.4)',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  testBtnText: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '700',
  },
  saveBtn: {
    flex: 2,
    backgroundColor: '#0284c7',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#38bdf8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  saveBtnDisabled: {
    opacity: 0.45,
  },
  saveBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  cancelBtn: {
    marginTop: 14,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  cancelText: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '600',
  },
});
