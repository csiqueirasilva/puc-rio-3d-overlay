import type { LatLngAltitude } from './cameraUrlState';
import type { BoxConfig, Vector3 } from './config';

const METERS_PER_DEGREE_LAT = 111320;

export interface LocalPoint {
  x: number;
  y: number;
  z: number;
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function metersPerDegreeLng(latitude: number): number {
  return Math.max(
    METERS_PER_DEGREE_LAT * Math.cos(degreesToRadians(latitude)),
    0.00001,
  );
}

export function clampScaleValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }

  return Math.max(0.5, value);
}

export function normalizeDegrees(value: number): number {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 ? 180 : normalized;
}

export function translatePosition(
  position: LatLngAltitude,
  eastMeters: number,
  northMeters: number,
  upMeters: number,
): LatLngAltitude {
  const nextLat = position.lat + northMeters / METERS_PER_DEGREE_LAT;
  const nextLng = position.lng + eastMeters / metersPerDegreeLng(nextLat);

  return {
    altitude: position.altitude + upMeters,
    lat: nextLat,
    lng: nextLng,
  };
}

export function rotateLocalPoint(
  point: LocalPoint,
  rotation: Vector3,
): LocalPoint {
  const rx = degreesToRadians(rotation.x);
  const ry = degreesToRadians(rotation.y);
  const rz = degreesToRadians(rotation.z);

  let x = point.x;
  let y = point.y;
  let z = point.z;

  const cosX = Math.cos(rx);
  const sinX = Math.sin(rx);
  const yAfterX = y * cosX - z * sinX;
  const zAfterX = y * sinX + z * cosX;
  y = yAfterX;
  z = zAfterX;

  const cosY = Math.cos(ry);
  const sinY = Math.sin(ry);
  const xAfterY = x * cosY + z * sinY;
  const zAfterY = -x * sinY + z * cosY;
  x = xAfterY;
  z = zAfterY;

  const cosZ = Math.cos(rz);
  const sinZ = Math.sin(rz);
  const xAfterZ = x * cosZ - y * sinZ;
  const yAfterZ = x * sinZ + y * cosZ;

  return {
    x: xAfterZ,
    y: yAfterZ,
    z,
  };
}

export function getBoxLocalCorners(scale: Vector3): LocalPoint[] {
  const halfX = scale.x / 2;
  const halfY = scale.y / 2;

  return [
    { x: -halfX, y: -halfY, z: 0 },
    { x: halfX, y: -halfY, z: 0 },
    { x: halfX, y: halfY, z: 0 },
    { x: -halfX, y: halfY, z: 0 },
    { x: -halfX, y: -halfY, z: scale.z },
    { x: halfX, y: -halfY, z: scale.z },
    { x: halfX, y: halfY, z: scale.z },
    { x: -halfX, y: halfY, z: scale.z },
  ];
}

export function getBoxWorldCorners(box: BoxConfig): LatLngAltitude[] {
  return getBoxLocalCorners(box.scale).map((corner) => {
    const rotated = rotateLocalPoint(corner, box.rotation);
    return translatePosition(box.position, rotated.x, rotated.y, rotated.z);
  });
}
