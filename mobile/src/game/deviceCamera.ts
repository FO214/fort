/** The camera maths in camera.ts, for the phone in hand. */
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { CAMERA_ZOOM, STREAM_ASPECT, lensMm, screenHfov, sensorHfov } from './camera';

/** This phone's main camera: field of view across the long side of its image. */
export const SENSOR_HFOV_DEG = sensorHfov(lensMm(Device.modelName, Platform.OS));

/** Field of view across this screen, with the player's trim from Settings (degrees). */
export function cameraHfov(width: number, height: number, trim = 0): number {
  return Math.max(30, Math.min(110, screenHfov(SENSOR_HFOV_DEG, width, height, STREAM_ASPECT, CAMERA_ZOOM) + trim));
}
