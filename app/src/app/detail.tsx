import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { session, getWsUrl, getBackendUrl, fetchWithTimeout, onServerHostChange } from './session';
import CyberBackground from '../components/CyberBackground';
import AnimatedButton from '../components/AnimatedButton';

const ROUTES: Record<string, string[]> = {
  ICU: ['Enter through Main Lobby', 'Go straight past Reception', 'Turn left at Corridor B', 'ICU is the second door on the right'],
  OT: ['Enter through Main Lobby', 'Take the corridor to the right', 'Go up to Level 2', 'OT is straight ahead'],
  ER: ['Enter through Emergency Entrance', 'ER is immediately on the left'],
};

function tierColor(tier?: string) {
  if (tier === 'High') return '#ef4444';
  if (tier === 'Medium') return '#f59e0b';
  if (tier === 'Low') return '#38bdf8';
  return '#10b981';
}

function criticalityBadgeInfo(criticality?: string) {
  if (criticality === 'Life Safety') {
    return {
      icon: '🛡️',
      label: 'LIFE SAFETY BRANCH',
      desc: 'Top Priority Tier: Immediate human life preservation protocol (surgical / life-support areas). Dispatch immediately.',
      color: '#f43f5e',
      bg: 'rgba(244, 63, 94, 0.15)',
    };
  }
  if (criticality === 'Critical') {
    return {
      icon: '⚡',
      label: 'CRITICAL CARE BRANCH',
      desc: 'High Priority Tier: Patient monitoring, diagnostic & acute clinical care systems. Priority dispatch.',
      color: '#f59e0b',
      bg: 'rgba(245, 158, 11, 0.15)',
    };
  }
  return {
    icon: '⚙️',
    label: 'EQUIPMENT SAFETY BRANCH',
    desc: 'Standard Priority Tier: Hospital infrastructure, mechanical HVAC, chillers & compressors. Routine maintenance procedure.',
    color: '#38bdf8',
    bg: 'rgba(56, 189, 248, 0.15)',
  };
}

export default function DetailScreen() {
  const { zone } = useLocalSearchParams<{ zone: string }>();
  const [alert, setAlert] = useState<any>(null);
  const [socket, setSocket] = useState<WebSocket | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let isMounted = true;

    function connect() {
      if (!isMounted) return;
      if (ws) {
        try { ws.close(); } catch (e) {}
      }

      // Immediate fetch via HTTP
      fetchWithTimeout(`${getBackendUrl()}/alerts`, {}, 3000)
        .then((res) => res.json())
        .then((data) => {
          if (isMounted && Array.isArray(data)) {
            setAlert(data.find((a: any) => a.zone === zone) || null);
          }
        })
        .catch(() => {});

      try {
        ws = new WebSocket(getWsUrl());
        ws.onmessage = (event) => {
          if (!isMounted) return;
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'alerts') {
              setAlert(data.data.find((a: any) => a.zone === zone) || null);
            }
          } catch (e) {}
        };
        setSocket(ws);
      } catch (e) {}
    }

    connect();

    const unsub = onServerHostChange(() => {
      connect();
    });

    return () => {
      isMounted = false;
      unsub();
      if (ws) {
        try { ws.close(); } catch (e) {}
      }
    };
  }, [zone]);

  function sendAction(action: 'engage' | 'complete') {
    if (!socket) return;
    socket.send(JSON.stringify({ action, zone, technician: session.technicianId }));
    if (action === 'complete') setTimeout(() => router.back(), 300);
  }

  if (!alert) {
    return (
      <CyberBackground>
        <View style={styles.container}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <View style={styles.emptyBox}>
            <Text style={styles.emptyIcon}>✅</Text>
            <Text style={styles.title}>{zone}</Text>
            <Text style={styles.subtitle}>This fault has been resolved or cleared from the active queue.</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={() => router.back()}>
              <Text style={styles.buttonText}>Return to Command Dashboard</Text>
            </TouchableOpacity>
          </View>
        </View>
      </CyberBackground>
    );
  }

  return (
    <CyberBackground>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={styles.topRow}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backText}>‹ Back</Text>
          </TouchableOpacity>
          <View style={[styles.badge, { backgroundColor: `${tierColor(alert.tier)}25`, borderColor: tierColor(alert.tier) }]}>
            <Text style={[styles.badgeText, { color: tierColor(alert.tier) }]}>{alert.tier.toUpperCase()} RISK TIER</Text>
          </View>
        </View>

        {/* Main Incident Card */}
        {(() => {
          const crit = criticalityBadgeInfo(alert.criticality);
          return (
            <View style={[styles.incidentCard, { borderLeftColor: crit.color }]}>
              <View style={styles.cardTopHeader}>
                <Text style={styles.zoneLabel}>INCIDENT ZONE</Text>
                <View style={[styles.critBadge, { backgroundColor: crit.bg, borderColor: crit.color }]}>
                  <Text style={[styles.critBadgeText, { color: crit.color }]}>
                    {crit.icon} {crit.label}
                  </Text>
                </View>
              </View>
              <Text style={styles.title}>{alert.zone}</Text>
              <Text style={styles.faultType}>Fault: {alert.fault_type.replace('_', ' ').toUpperCase()}</Text>
              {alert.priority_score ? (
                <Text style={styles.scoreText}>
                  Risk Priority Score: <Text style={{ color: crit.color, fontWeight: '800' }}>{alert.priority_score}</Text>
                </Text>
              ) : null}
              <Text style={styles.detected}>Telemetry Logged: {new Date(alert.created_at).toLocaleTimeString()}</Text>

              <View style={[styles.protocolBox, { borderColor: `${crit.color}40`, backgroundColor: `${crit.color}10` }]}>
                <Text style={[styles.protocolTitle, { color: crit.color }]}>SAFETY DISPATCH DIRECTIVE</Text>
                <Text style={styles.protocolDesc}>{crit.desc}</Text>
              </View>

              {alert.status === 'engaged' && (
                <View style={styles.engagedBanner}>
                  <Text style={styles.engagedText}>🛠️ Engaged by Operator: <Text style={{ fontWeight: '800' }}>{alert.engaged_by}</Text></Text>
                </View>
              )}
            </View>
          );
        })()}

        {/* Tactical Navigation Pathway */}
        <View style={styles.pathCard}>
          <Text style={styles.sectionTitle}>Physical Dispatch Pathway</Text>
          {(ROUTES[alert.zone] || ['Direct access via primary medical corridor.']).map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={styles.stepNumCircle}>
                <Text style={styles.stepNumText}>{i + 1}</Text>
              </View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>

        {/* Action Controls */}
        {alert.status === 'open' && (
          <AnimatedButton scaleTo={0.96} style={styles.engageButton} onPress={() => sendAction('engage')}>
            <Text style={styles.buttonText}>⚡ ENGAGE DISPATCH (ASSIGN TO ME)</Text>
          </AnimatedButton>
        )}

        {alert.status === 'engaged' && (
          <AnimatedButton scaleTo={0.96} style={styles.completeButton} onPress={() => sendAction('complete')}>
            <Text style={styles.buttonText}>✅ MARK FAULT RESOLVED</Text>
          </AnimatedButton>
        )}
      </ScrollView>
    </CyberBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    paddingTop: 50,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
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
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  badgeText: {
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  incidentCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderLeftWidth: 5,
  },
  cardTopHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  zoneLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  critBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  critBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  title: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 4,
  },
  faultType: {
    color: '#cbd5e1',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 4,
  },
  scoreText: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 4,
  },
  protocolBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
    marginBottom: 6,
  },
  protocolTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 3,
  },
  protocolDesc: {
    color: '#e2e8f0',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  detected: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 6,
  },
  engagedBanner: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderRadius: 8,
    padding: 8,
    marginTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  engagedText: {
    color: '#f59e0b',
    fontSize: 13,
    fontWeight: '600',
  },
  pathCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    borderRadius: 16,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.15)',
  },
  sectionTitle: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  stepNumCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(56, 189, 248, 0.2)',
    borderWidth: 1,
    borderColor: '#38bdf8',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  stepNumText: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '800',
  },
  stepText: {
    color: '#f1f5f9',
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
  engageButton: {
    backgroundColor: '#0284c7',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#38bdf8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  completeButton: {
    backgroundColor: '#10b981',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  primaryButton: {
    backgroundColor: '#0284c7',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 10,
    marginTop: 20,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 20,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
  },
});