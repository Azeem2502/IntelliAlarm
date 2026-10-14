import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, Animated, Easing, Dimensions } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  RadialGradient,
  Stop,
  Rect,
  Circle,
  Path,
  Line,
  G,
} from 'react-native-svg';

interface Props {
  children?: React.ReactNode;
}

export default function CyberBackground({ children }: Props) {
  // Continuous horizontal scrolling translation for the glowing pulse wave
  const pulseScroll = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Continuous smooth sweep for the ECG pulse trace (seamlessly looping 4 * 140px wave periods = 560px)
    const pulseLoop = Animated.loop(
      Animated.timing(pulseScroll, {
        toValue: 560,
        duration: 3500,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    pulseLoop.start();

    return () => {
      pulseLoop.stop();
    };
  }, []);

  return (
    <View style={styles.root}>
      {/* Background SVG Grid and Gradients (STATIC - no moving radar or background distractions) */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
          <Defs>
            {/* Deep Cyber Canvas Gradient */}
            <LinearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor="#040711" stopOpacity={1} />
              <Stop offset="45%" stopColor="#0a1124" stopOpacity={1} />
              <Stop offset="100%" stopColor="#040612" stopOpacity={1} />
            </LinearGradient>

            {/* Ambient Corner Accents */}
            <RadialGradient id="cyanOrb" cx="85%" cy="15%" r="45%">
              <Stop offset="0%" stopColor="#06b6d4" stopOpacity={0.2} />
              <Stop offset="50%" stopColor="#0284c7" stopOpacity={0.06} />
              <Stop offset="100%" stopColor="#040711" stopOpacity={0} />
            </RadialGradient>

            <RadialGradient id="purpleOrb" cx="15%" cy="85%" r="55%">
              <Stop offset="0%" stopColor="#6366f1" stopOpacity={0.16} />
              <Stop offset="50%" stopColor="#4338ca" stopOpacity={0.05} />
              <Stop offset="100%" stopColor="#040612" stopOpacity={0} />
            </RadialGradient>
          </Defs>

          {/* Background base */}
          <Rect width="100%" height="100%" fill="url(#bgGrad)" />
          <Rect width="100%" height="100%" fill="url(#cyanOrb)" />
          <Rect width="100%" height="100%" fill="url(#purpleOrb)" />

          {/* Architectural telemetry grid overlay */}
          <G stroke="rgba(56, 189, 248, 0.04)" strokeWidth={1}>
            <Line x1="10%" y1="0" x2="10%" y2="100%" />
            <Line x1="25%" y1="0" x2="25%" y2="100%" />
            <Line x1="40%" y1="0" x2="40%" y2="100%" />
            <Line x1="55%" y1="0" x2="55%" y2="100%" />
            <Line x1="70%" y1="0" x2="70%" y2="100%" />
            <Line x1="85%" y1="0" x2="85%" y2="100%" />

            <Line x1="0" y1="8%" x2="100%" y2="8%" />
            <Line x1="0" y1="20%" x2="100%" y2="20%" />
            <Line x1="0" y1="35%" x2="100%" y2="35%" />
            <Line x1="0" y1="50%" x2="100%" y2="50%" />
            <Line x1="0" y1="65%" x2="100%" y2="65%" />
            <Line x1="0" y1="80%" x2="100%" y2="80%" />
            <Line x1="0" y1="92%" x2="100%" y2="92%" />
          </G>

          {/* Static Dim Base ECG Grid Track */}
          <Path
            d="M 0 42 L 30 42 L 40 28 L 50 56 L 60 20 L 70 50 L 80 42 L 150 42 L 160 28 L 170 56 L 180 20 L 190 50 L 200 42 L 270 42 L 280 28 L 290 56 L 300 20 L 310 50 L 320 42 L 390 42 L 400 28 L 410 56 L 420 20 L 430 50 L 440 42 L 510 42 L 520 28 L 530 56 L 540 20 L 550 50 L 560 42 L 630 42 L 640 28 L 650 56 L 660 20 L 670 50 L 680 42 L 750 42 L 760 28 L 770 56 L 780 20 L 790 50 L 800 42 L 870 42 L 880 28 L 890 56 L 900 20 L 910 50 L 920 42 L 1200 42"
            fill="none"
            stroke="rgba(56, 189, 248, 0.12)"
            strokeWidth={1.5}
          />
        </Svg>

        {/* ── Animated Hospital ECG Pulse Line (as in user screenshot) ── */}
        <View style={styles.pulseContainer} pointerEvents="none">
          <Animated.View
            style={[
              styles.pulseWrapper,
              {
                transform: [
                  {
                    translateX: pulseScroll.interpolate({
                      inputRange: [0, 560],
                      outputRange: [-560, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <Svg width="2000" height="70" viewBox="0 0 2000 70">
              <Defs>
                {/* Glowing cyan gradient along the pulse */}
                <LinearGradient id="pulseGlow" x1="0%" y1="0%" x2="100%" y2="0%">
                  <Stop offset="0%" stopColor="#06b6d4" stopOpacity={0.1} />
                  <Stop offset="40%" stopColor="#38bdf8" stopOpacity={0.6} />
                  <Stop offset="80%" stopColor="#06b6d4" stopOpacity={0.9} />
                  <Stop offset="100%" stopColor="#67e8f9" stopOpacity={1} />
                </LinearGradient>
              </Defs>
              <Path
                d="M 0 42 L 40 42 L 52 24 L 64 60 L 74 16 L 86 54 L 98 42 L 180 42 L 192 24 L 204 60 L 214 16 L 226 54 L 238 42 L 320 42 L 332 24 L 344 60 L 354 16 L 366 54 L 378 42 L 460 42 L 472 24 L 484 60 L 494 16 L 506 54 L 518 42 L 600 42 L 612 24 L 624 60 L 634 16 L 646 54 L 658 42 L 740 42 L 752 24 L 764 60 L 774 16 L 786 54 L 798 42 L 880 42 L 892 24 L 904 60 L 914 16 L 926 54 L 938 42 L 1020 42 L 1032 24 L 1044 60 L 1054 16 L 1066 54 L 1078 42 L 1160 42 L 1172 24 L 1184 60 L 1194 16 L 1206 54 L 1218 42 L 1300 42 L 1312 24 L 1324 60 L 1334 16 L 1346 54 L 1358 42 L 1440 42 L 1452 24 L 1464 60 L 1474 16 L 1486 54 L 1498 42 L 1580 42 L 1592 24 L 1604 60 L 1614 16 L 1626 54 L 1638 42 L 1720 42 L 1732 24 L 1744 60 L 1754 16 L 1766 54 L 1778 42 L 1860 42 L 1872 24 L 1884 60 L 1894 16 L 1906 54 L 1918 42 L 2000 42"
                fill="none"
                stroke="url(#pulseGlow)"
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </Animated.View>
        </View>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#040711',
  },
  pulseContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 70,
    overflow: 'hidden',
  },
  pulseWrapper: {
    width: 2000,
    height: 70,
  },
});
