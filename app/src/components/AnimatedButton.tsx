import React, { useRef } from 'react';
import { Animated, TouchableOpacity, StyleProp, ViewStyle, GestureResponderEvent, Platform } from 'react-native';

interface AnimatedButtonProps {
  onPress?: (event: GestureResponderEvent) => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  activeOpacity?: number;
  scaleTo?: number;
  glowColor?: string;
  children: React.ReactNode;
}

export default function AnimatedButton({
  onPress,
  style,
  disabled = false,
  activeOpacity = 0.85,
  scaleTo = 0.95,
  glowColor,
  children,
}: AnimatedButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0)).current;

  const handlePressIn = () => {
    if (disabled) return;
    Animated.parallel([
      Animated.spring(scale, {
        toValue: scaleTo,
        useNativeDriver: Platform.OS !== 'web' ? true : false,
        speed: 50,
        bounciness: 4,
      }),
      Animated.timing(glow, {
        toValue: 1,
        duration: 100,
        useNativeDriver: false,
      }),
    ]).start();
  };

  const handlePressOut = () => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: Platform.OS !== 'web' ? true : false,
        speed: 35,
        bounciness: 10,
      }),
      Animated.timing(glow, {
        toValue: 0,
        duration: 250,
        useNativeDriver: false,
      }),
    ]).start();
  };

  const animatedGlowStyle = glowColor
    ? {
        shadowColor: glowColor,
        shadowOpacity: glow.interpolate({
          inputRange: [0, 1],
          outputRange: [0.2, 0.8],
        }),
        shadowRadius: glow.interpolate({
          inputRange: [0, 1],
          outputRange: [4, 16],
        }),
      }
    : {};

  return (
    <Animated.View style={[{ transform: [{ scale }] }, animatedGlowStyle]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled}
        activeOpacity={activeOpacity}
        style={style}
      >
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
}
