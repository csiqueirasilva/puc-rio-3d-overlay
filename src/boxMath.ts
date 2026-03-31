import type { CameraState, LatLngAltitude } from './cameraUrlState';
import type { BoxConfig, Vector3 } from './config';

const METERS_PER_DEGREE_LAT = 111320;
const BOX_FACE_INDEXES = [
  [0, 1, 2, 3],
  [4, 5, 6, 7],
  [0, 1, 5, 4],
  [1, 2, 6, 5],
  [2, 3, 7, 6],
  [3, 0, 4, 7],
] as const;

export interface LocalPoint {
  x: number;
  y: number;
  z: number;
}

export interface ScreenPoint {
  depth: number;
  x: number;
  y: number;
}

export interface ScreenVector {
  x: number;
  y: number;
}

export interface BoxFootprintProjection {
  angleDeg: number;
  center: ScreenVector;
  heightPx: number;
  widthPx: number;
  xAxisPerMeter: ScreenVector;
  yAxisPerMeter: ScreenVector;
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI;
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

export function inverseRotateLocalPoint(
  point: LocalPoint,
  rotation: Vector3,
): LocalPoint {
  const negativeZ = degreesToRadians(-rotation.z);
  const negativeY = degreesToRadians(-rotation.y);
  const negativeX = degreesToRadians(-rotation.x);

  let x = point.x;
  let y = point.y;
  let z = point.z;

  const cosZ = Math.cos(negativeZ);
  const sinZ = Math.sin(negativeZ);
  const xAfterZ = x * cosZ - y * sinZ;
  const yAfterZ = x * sinZ + y * cosZ;
  x = xAfterZ;
  y = yAfterZ;

  const cosY = Math.cos(negativeY);
  const sinY = Math.sin(negativeY);
  const xAfterY = x * cosY + z * sinY;
  const zAfterY = -x * sinY + z * cosY;
  x = xAfterY;
  z = zAfterY;

  const cosX = Math.cos(negativeX);
  const sinX = Math.sin(negativeX);
  const yAfterX = y * cosX - z * sinX;
  const zAfterX = y * sinX + z * cosX;

  return {
    x,
    y: yAfterX,
    z: zAfterX,
  };
}

export function getOffsetFromPosition(
  origin: LatLngAltitude,
  target: LatLngAltitude,
): LocalPoint {
  const averageLat = (origin.lat + target.lat) / 2;

  return {
    x: (target.lng - origin.lng) * metersPerDegreeLng(averageLat),
    y: (target.lat - origin.lat) * METERS_PER_DEGREE_LAT,
    z: target.altitude - origin.altitude,
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

export function getBoxCentroid(box: BoxConfig): LatLngAltitude {
  const corners = getBoxWorldCorners(box);
  const sums = corners.reduce(
    (accumulator, corner) => ({
      altitude: accumulator.altitude + corner.altitude,
      lat: accumulator.lat + corner.lat,
      lng: accumulator.lng + corner.lng,
    }),
    {
      altitude: 0,
      lat: 0,
      lng: 0,
    },
  );

  return {
    altitude: sums.altitude / corners.length,
    lat: sums.lat / corners.length,
    lng: sums.lng / corners.length,
  };
}

export function getCameraPositionFromState(
  cameraState: CameraState,
): LatLngAltitude {
  const tiltRadians = degreesToRadians(cameraState.tilt);
  const azimuthRadians = degreesToRadians(cameraState.heading + 180);
  const horizontalDistance = cameraState.range * Math.sin(tiltRadians);
  const upDistance = cameraState.range * Math.cos(tiltRadians);
  const eastDistance = Math.sin(azimuthRadians) * horizontalDistance;
  const northDistance = Math.cos(azimuthRadians) * horizontalDistance;

  return translatePosition(
    cameraState.center,
    eastDistance,
    northDistance,
    upDistance,
  );
}

export function getCameraStateFromCenterAndPosition(
  center: LatLngAltitude,
  cameraPosition: LatLngAltitude,
  baseCameraState: CameraState,
): CameraState {
  const offset = getOffsetFromPosition(center, cameraPosition);
  const horizontalDistance = Math.hypot(offset.x, offset.y);
  const range = Math.max(Math.hypot(horizontalDistance, offset.z), 0.0001);
  const azimuthDegrees = radiansToDegrees(Math.atan2(offset.x, offset.y));
  const tilt = radiansToDegrees(
    Math.acos(Math.min(1, Math.max(-1, offset.z / range))),
  );

  return {
    center,
    fov: baseCameraState.fov,
    heading: normalizeDegrees(azimuthDegrees - 180),
    range,
    tilt,
  };
}

function getCameraBasis(cameraState: CameraState): {
  forward: LocalPoint;
  right: LocalPoint;
  up: LocalPoint;
} {
  const headingRadians = degreesToRadians(cameraState.heading);
  const tiltRadians = degreesToRadians(cameraState.tilt);
  const sinHeading = Math.sin(headingRadians);
  const cosHeading = Math.cos(headingRadians);
  const sinTilt = Math.sin(tiltRadians);
  const cosTilt = Math.cos(tiltRadians);

  const forward = {
    x: sinHeading * sinTilt,
    y: cosHeading * sinTilt,
    z: -cosTilt,
  };
  const right = {
    x: cosHeading,
    y: -sinHeading,
    z: 0,
  };
  const up = {
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x,
  };

  return {
    forward,
    right,
    up,
  };
}

function dotProduct(left: LocalPoint, right: LocalPoint): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function getScreenDistance(left: ScreenVector, right: ScreenVector): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function averageScreenVectors(...vectors: ScreenVector[]): ScreenVector {
  const totals = vectors.reduce(
    (accumulator, vector) => ({
      x: accumulator.x + vector.x,
      y: accumulator.y + vector.y,
    }),
    { x: 0, y: 0 },
  );

  return {
    x: totals.x / vectors.length,
    y: totals.y / vectors.length,
  };
}

function isPointInPolygon(
  point: { x: number; y: number },
  polygon: Array<{ x: number; y: number }>,
): boolean {
  let inside = false;

  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

export function projectWorldPointToScreen(
  cameraState: CameraState,
  worldPoint: LatLngAltitude,
  viewportWidth: number,
  viewportHeight: number,
): ScreenPoint | null {
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return null;
  }

  const cameraPosition = getCameraPositionFromState(cameraState);
  const offset = getOffsetFromPosition(cameraPosition, worldPoint);
  const { forward, right, up } = getCameraBasis(cameraState);
  const cameraX = dotProduct(offset, right);
  const cameraY = dotProduct(offset, up);
  const cameraZ = dotProduct(offset, forward);

  if (cameraZ <= 0.001) {
    return null;
  }

  const aspectRatio = viewportWidth / viewportHeight;
  const tanHalfVerticalFov = Math.tan(degreesToRadians(cameraState.fov) / 2);
  const tanHalfHorizontalFov = tanHalfVerticalFov * aspectRatio;
  const normalizedX = cameraX / (cameraZ * tanHalfHorizontalFov);
  const normalizedY = cameraY / (cameraZ * tanHalfVerticalFov);

  if (
    !Number.isFinite(normalizedX) ||
    !Number.isFinite(normalizedY) ||
    normalizedX < -1.5 ||
    normalizedX > 1.5 ||
    normalizedY < -1.5 ||
    normalizedY > 1.5
  ) {
    return null;
  }

  return {
    depth: cameraZ,
    x: ((normalizedX + 1) / 2) * viewportWidth,
    y: ((1 - normalizedY) / 2) * viewportHeight,
  };
}

export function pickBoxAtScreenPoint(
  boxes: BoxConfig[],
  cameraState: CameraState,
  viewportWidth: number,
  viewportHeight: number,
  screenX: number,
  screenY: number,
): string | null {
  let closestBoxId: string | null = null;
  let closestDepth = Number.POSITIVE_INFINITY;

  for (const box of boxes) {
    const corners = getBoxWorldCorners(box);

    for (const faceIndexes of BOX_FACE_INDEXES) {
      const projectedFace: ScreenPoint[] = [];
      let depthSum = 0;
      let isValidFace = true;

      for (const cornerIndex of faceIndexes) {
        const projectedPoint = projectWorldPointToScreen(
          cameraState,
          corners[cornerIndex],
          viewportWidth,
          viewportHeight,
        );

        if (!projectedPoint) {
          isValidFace = false;
          break;
        }

        projectedFace.push(projectedPoint);
        depthSum += projectedPoint.depth;
      }

      if (!isValidFace) {
        continue;
      }

      if (
        isPointInPolygon(
          { x: screenX, y: screenY },
          projectedFace.map((point) => ({ x: point.x, y: point.y })),
        )
      ) {
        const averageDepth = depthSum / projectedFace.length;

        if (averageDepth < closestDepth) {
          closestDepth = averageDepth;
          closestBoxId = box.id;
        }
      }
    }
  }

  return closestBoxId;
}

export function projectBoxFootprintToScreen(
  box: BoxConfig,
  cameraState: CameraState,
  viewportWidth: number,
  viewportHeight: number,
): BoxFootprintProjection | null {
  const projectedBottomCorners = getBoxWorldCorners(box)
    .slice(0, 4)
    .map((corner) =>
      projectWorldPointToScreen(
        cameraState,
        corner,
        viewportWidth,
        viewportHeight,
      ),
    );

  if (projectedBottomCorners.some((corner) => !corner)) {
    return null;
  }

  const [bottomLeft, bottomRight, topRight, topLeft] =
    projectedBottomCorners as ScreenPoint[];
  const center = averageScreenVectors(
    bottomLeft,
    bottomRight,
    topRight,
    topLeft,
  );
  const xAxisScreen = averageScreenVectors(
    {
      x: bottomRight.x - bottomLeft.x,
      y: bottomRight.y - bottomLeft.y,
    },
    {
      x: topRight.x - topLeft.x,
      y: topRight.y - topLeft.y,
    },
  );
  const yAxisScreen = averageScreenVectors(
    {
      x: topLeft.x - bottomLeft.x,
      y: topLeft.y - bottomLeft.y,
    },
    {
      x: topRight.x - bottomRight.x,
      y: topRight.y - bottomRight.y,
    },
  );
  const widthPx = Math.max(
    1,
    (getScreenDistance(bottomLeft, bottomRight) +
      getScreenDistance(topLeft, topRight)) /
      2,
  );
  const heightPx = Math.max(
    1,
    (getScreenDistance(bottomLeft, topLeft) +
      getScreenDistance(bottomRight, topRight)) /
      2,
  );

  return {
    angleDeg: radiansToDegrees(Math.atan2(xAxisScreen.y, xAxisScreen.x)),
    center,
    heightPx,
    widthPx,
    xAxisPerMeter: {
      x: xAxisScreen.x / Math.max(box.scale.x, 0.0001),
      y: xAxisScreen.y / Math.max(box.scale.x, 0.0001),
    },
    yAxisPerMeter: {
      x: yAxisScreen.x / Math.max(box.scale.y, 0.0001),
      y: yAxisScreen.y / Math.max(box.scale.y, 0.0001),
    },
  };
}

export function solveLocalMetersFromScreenDelta(
  screenDelta: ScreenVector,
  xAxisPerMeter: ScreenVector,
  yAxisPerMeter: ScreenVector,
): { x: number; y: number } | null {
  const determinant =
    xAxisPerMeter.x * yAxisPerMeter.y - xAxisPerMeter.y * yAxisPerMeter.x;

  if (Math.abs(determinant) < 0.000001) {
    return null;
  }

  return {
    x:
      (screenDelta.x * yAxisPerMeter.y - screenDelta.y * yAxisPerMeter.x) /
      determinant,
    y:
      (xAxisPerMeter.x * screenDelta.y - xAxisPerMeter.y * screenDelta.x) /
      determinant,
  };
}
