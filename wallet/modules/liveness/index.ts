import {
  requireNativeModule,
  requireNativeViewManager,
} from 'expo-modules-core';
import type { Ref } from 'react';
import type { ComponentType } from 'react';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';

export type FaceUpdate = {
  faceCount: number;
  timestamp: number;
  // Present only when a face is tracked.
  offAxisDeg?: number;
  blinkLeft?: number;
  blinkRight?: number;
  smile?: number;
  jawOpen?: number;
  browUp?: number;
  // Nose-to-cheek depth relief in mm; -1 when no fresh measurement.
  depthReliefMm: number;
};

export type CapturedFrame = {
  uri: string;
  width: number;
  height: number;
};

export type LivenessViewHandle = {
  captureFrame(): Promise<CapturedFrame>;
};

export type LivenessViewProps = ViewProps & {
  ref?: Ref<LivenessViewHandle>;
  onFaceUpdate?: (event: NativeSyntheticEvent<FaceUpdate>) => void;
  onSessionError?: (event: NativeSyntheticEvent<{ message: string }>) => void;
};

const LivenessModule = requireNativeModule<{ isSupported: boolean }>('Liveness');

export const isLivenessSupported: boolean = LivenessModule.isSupported;

export const LivenessView: ComponentType<LivenessViewProps> =
  requireNativeViewManager('Liveness');
