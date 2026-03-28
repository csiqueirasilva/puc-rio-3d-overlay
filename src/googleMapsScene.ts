import {
  buildEntityId,
  buildings,
  initialView,
  patternStatus,
  type BuildingConfig,
  type RoomStatus,
} from './config';
import { loadGoogleMaps3D } from './googleMapsLoader';

const EARTH_RADIUS_METERS = 6_378_137;
const LOCK_BOUNDS_DELTA = 0.00008;
const CAMERA_EPSILON = 0.0001;

const roomPalette: Record<RoomStatus, { fill: string; stroke: string }> = {
  free: {
    fill: 'rgba(34, 197, 94, 0.28)',
    stroke: 'rgba(220, 252, 231, 0.65)',
  },
  busy: {
    fill: 'rgba(239, 68, 68, 0.34)',
    stroke: 'rgba(254, 202, 202, 0.72)',
  },
  blocked: {
    fill: 'rgba(245, 158, 11, 0.4)',
    stroke: 'rgba(254, 243, 199, 0.78)',
  },
};

const hoverPalette = {
  fill: 'rgba(250, 204, 21, 0.9)',
  stroke: 'rgba(254, 240, 138, 1)',
};

const selectedPalette = {
  fill: 'rgba(248, 250, 252, 0.92)',
  stroke: 'rgba(255, 255, 255, 1)',
};

type LatLngAltitude = {
  altitude: number;
  lat: number;
  lng: number;
};

type CameraState = {
  center: LatLngAltitude;
  fov: number;
  heading: number;
  range: number;
  tilt: number;
};

type InteractivePolygonElement = HTMLElement & {
  altitudeMode?: string;
  drawOccludedSegments?: boolean;
  drawsOccludedSegments?: boolean;
  fillColor?: string;
  geodesic?: boolean;
  outerCoordinates?: LatLngAltitude[];
  strokeColor?: string;
  strokeWidth?: number;
  zIndex?: number;
};

type Map3DElementInstance = HTMLElement & {
  bounds?: {
    east: number;
    north: number;
    south: number;
    west: number;
  };
  center?: LatLngAltitude;
  defaultUIHidden?: boolean;
  fov?: number;
  gestureHandling?: string;
  heading?: number;
  maxAltitude?: number;
  maxHeading?: number;
  maxTilt?: number;
  minAltitude?: number;
  minHeading?: number;
  minTilt?: number;
  mode?: string;
  range?: number;
  tilt?: number;
  stopCameraAnimation?: () => Promise<void>;
};

interface RoomMeta {
  baseFill: string;
  baseStroke: string;
  buildingId: string;
  id: string;
  polygon: InteractivePolygonElement;
  status: RoomStatus;
}

export interface SceneController {
  destroy: () => void;
  setCameraLocked: (locked: boolean) => void;
  setRoomsVisible: (visible: boolean) => void;
  setSelectedRoom: (roomId: string) => void;
}

interface InitializeSceneOptions {
  onRoomHovered?: (roomId: string | null) => void;
  onRoomSelected?: (roomId: string) => void;
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function translateLatLng(
  originLat: number,
  originLng: number,
  eastMeters: number,
  northMeters: number,
): { lat: number; lng: number } {
  const latRadians = degreesToRadians(originLat);
  const dLat = northMeters / EARTH_RADIUS_METERS;
  const dLng = eastMeters / (EARTH_RADIUS_METERS * Math.cos(latRadians));

  return {
    lat: originLat + (dLat * 180) / Math.PI,
    lng: originLng + (dLng * 180) / Math.PI,
  };
}

function rotateLocalOffset(
  localX: number,
  localY: number,
  headingDeg: number,
): { east: number; north: number } {
  const headingRadians = degreesToRadians(headingDeg);

  return {
    east:
      localX * Math.cos(headingRadians) + localY * Math.sin(headingRadians),
    north:
      -localX * Math.sin(headingRadians) + localY * Math.cos(headingRadians),
  };
}

function buildFixedCameraState(): CameraState {
  return {
    center: {
      lat: initialView.lat,
      lng: initialView.lon,
      altitude: initialView.centerAltitude,
    },
    fov: initialView.fov,
    heading: initialView.heading,
    range: initialView.range,
    tilt: initialView.tilt,
  };
}

function applyCameraState(map: Map3DElementInstance, cameraState: CameraState): void {
  map.center = { ...cameraState.center };
  map.fov = cameraState.fov;
  map.heading = cameraState.heading;
  map.range = cameraState.range;
  map.tilt = cameraState.tilt;
}

function applyCameraLock(
  map: Map3DElementInstance,
  cameraState: CameraState,
  locked: boolean,
): void {
  if (locked) {
    map.bounds = {
      east: cameraState.center.lng + LOCK_BOUNDS_DELTA,
      north: cameraState.center.lat + LOCK_BOUNDS_DELTA,
      south: cameraState.center.lat - LOCK_BOUNDS_DELTA,
      west: cameraState.center.lng - LOCK_BOUNDS_DELTA,
    };
    map.minHeading = cameraState.heading;
    map.maxHeading = cameraState.heading;
    map.minTilt = cameraState.tilt;
    map.maxTilt = cameraState.tilt;
    applyCameraState(map, cameraState);
    return;
  }

  map.bounds = undefined;
  map.minHeading = undefined;
  map.maxHeading = undefined;
  map.minTilt = undefined;
  map.maxTilt = undefined;
}

function buildRoomPolygonCoordinates(
  building: BuildingConfig,
  floor: number,
  row: number,
  col: number,
): LatLngAltitude[] {
  const { cellX, cellY, cellZ, cols, rows, padding } = building.grid;
  const offsetX = building.grid.offsetX ?? 0;
  const offsetY = building.grid.offsetY ?? 0;
  const offsetZ = building.grid.offsetZ ?? 0;
  const halfWidth = (cellX * padding) / 2;
  const halfDepth = (cellY * padding) / 2;
  const centerX = offsetX + (col - (cols - 1) / 2) * cellX;
  const centerY = offsetY + (row - (rows - 1) / 2) * cellY;
  const altitude = building.baseHeight + offsetZ + floor * cellZ + cellZ / 2;
  const corners = [
    { x: centerX - halfWidth, y: centerY - halfDepth },
    { x: centerX + halfWidth, y: centerY - halfDepth },
    { x: centerX + halfWidth, y: centerY + halfDepth },
    { x: centerX - halfWidth, y: centerY + halfDepth },
  ];

  return corners.map(({ x, y }) => {
    const { east, north } = rotateLocalOffset(x, y, building.headingDeg);
    const { lat, lng } = translateLatLng(building.lat, building.lon, east, north);

    return {
      altitude,
      lat,
      lng,
    };
  });
}

function resolveRoomColors(
  room: RoomMeta,
  hoveredRoomId: string | null,
  selectedRoomId: string | null,
): { fill: string; stroke: string } {
  if (room.id === hoveredRoomId) {
    return hoverPalette;
  }

  if (room.id === selectedRoomId) {
    return selectedPalette;
  }

  return {
    fill: room.baseFill,
    stroke: room.baseStroke,
  };
}

function setRoomAppearance(
  room: RoomMeta,
  hoveredRoomId: string | null,
  selectedRoomId: string | null,
): void {
  const colors = resolveRoomColors(room, hoveredRoomId, selectedRoomId);
  room.polygon.fillColor = colors.fill;
  room.polygon.strokeColor = colors.stroke;
}

export async function initializeGoogleMapsScene(
  container: HTMLElement,
  options: InitializeSceneOptions = {},
): Promise<SceneController> {
  const { Map3DElement, Polygon3DInteractiveElement } =
    await loadGoogleMaps3D();
  const map = new Map3DElement({
    center: {
      lat: initialView.lat,
      lng: initialView.lon,
      altitude: initialView.centerAltitude,
    },
    defaultUIHidden: true,
    fov: initialView.fov,
    gestureHandling: 'COOPERATIVE',
    heading: initialView.heading,
    mode: 'SATELLITE',
    range: initialView.range,
    tilt: initialView.tilt,
  }) as Map3DElementInstance;

  container.replaceChildren();
  container.append(map);

  const fixedCameraState = buildFixedCameraState();
  const roomMap = new Map<string, RoomMeta>();
  let roomsVisible = true;
  let cameraLocked = true;
  let hoveredRoomId: string | null = null;
  let selectedRoomId: string | null = null;
  let enforcingCamera = false;

  const refreshRoom = (roomId: string): void => {
    const room = roomMap.get(roomId);

    if (!room) {
      return;
    }

    setRoomAppearance(room, hoveredRoomId, selectedRoomId);
  };

  const setHoveredRoom = (roomId: string | null): void => {
    if (hoveredRoomId === roomId) {
      return;
    }

    const previousHoveredRoomId = hoveredRoomId;
    hoveredRoomId = roomId;

    if (previousHoveredRoomId) {
      refreshRoom(previousHoveredRoomId);
    }

    if (hoveredRoomId) {
      refreshRoom(hoveredRoomId);
    }

    options.onRoomHovered?.(hoveredRoomId);
  };

  const setSelectedRoom = (roomId: string | null): void => {
    if (selectedRoomId === roomId) {
      return;
    }

    const previousSelectedRoomId = selectedRoomId;
    selectedRoomId = roomId;

    if (previousSelectedRoomId) {
      refreshRoom(previousSelectedRoomId);
    }

    if (selectedRoomId) {
      refreshRoom(selectedRoomId);
    }
  };

  const enforceFixedCamera = (): void => {
    if (!cameraLocked || enforcingCamera) {
      return;
    }

    const headingDiff = Math.abs((map.heading ?? 0) - fixedCameraState.heading);
    const tiltDiff = Math.abs((map.tilt ?? 0) - fixedCameraState.tilt);
    const rangeDiff = Math.abs((map.range ?? 0) - fixedCameraState.range);
    const center = map.center;
    const centerLatDiff = Math.abs((center?.lat ?? 0) - fixedCameraState.center.lat);
    const centerLngDiff = Math.abs((center?.lng ?? 0) - fixedCameraState.center.lng);

    if (
      headingDiff < CAMERA_EPSILON &&
      tiltDiff < CAMERA_EPSILON &&
      rangeDiff < CAMERA_EPSILON &&
      centerLatDiff < CAMERA_EPSILON &&
      centerLngDiff < CAMERA_EPSILON
    ) {
      return;
    }

    enforcingCamera = true;
    void map.stopCameraAnimation?.().catch(() => undefined);
    applyCameraState(map, fixedCameraState);
    window.setTimeout(() => {
      enforcingCamera = false;
    }, 0);
  };

  const cameraEvents = [
    'gmp-camerapositionchange',
    'gmp-centerchange',
    'gmp-headingchange',
    'gmp-rangechange',
    'gmp-tiltchange',
  ] as const;

  for (const eventName of cameraEvents) {
    map.addEventListener(eventName, enforceFixedCamera);
  }

  applyCameraLock(map, fixedCameraState, cameraLocked);

  for (const building of buildings) {
    const { cols, rows, floors } = building.grid;

    for (let floor = 0; floor < floors; floor += 1) {
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const sequenceIndex = floor * rows * cols + row * cols + col;
          const status = patternStatus(sequenceIndex, building.statusPattern);
          const roomId = buildEntityId(building.id, floor, row, col);
          const polygon = new Polygon3DInteractiveElement({
            altitudeMode: 'ABSOLUTE',
            drawsOccludedSegments: true,
            fillColor: roomPalette[status].fill,
            geodesic: false,
            outerCoordinates: buildRoomPolygonCoordinates(building, floor, row, col),
            strokeColor: roomPalette[status].stroke,
            strokeWidth: 1.35,
            zIndex: floor + 1,
          }) as InteractivePolygonElement;

          polygon.addEventListener('gmp-click', () => {
            setSelectedRoom(roomId);
            options.onRoomSelected?.(roomId);
          });

          polygon.addEventListener('mouseenter', () => {
            setHoveredRoom(roomId);
          });
          polygon.addEventListener('mouseleave', () => {
            setHoveredRoom(null);
          });
          polygon.addEventListener('pointerenter', () => {
            setHoveredRoom(roomId);
          });
          polygon.addEventListener('pointerleave', () => {
            setHoveredRoom(null);
          });

          roomMap.set(roomId, {
            id: roomId,
            buildingId: building.id,
            status,
            polygon,
            baseFill: roomPalette[status].fill,
            baseStroke: roomPalette[status].stroke,
          });

          map.append(polygon);
        }
      }
    }
  }

  const handlePointerLeave = (): void => {
    setHoveredRoom(null);
  };

  container.addEventListener('pointerleave', handlePointerLeave);

  return {
    destroy: () => {
      container.removeEventListener('pointerleave', handlePointerLeave);

      for (const eventName of cameraEvents) {
        map.removeEventListener(eventName, enforceFixedCamera);
      }

      container.replaceChildren();
    },
    setCameraLocked: (locked: boolean) => {
      cameraLocked = locked;
      applyCameraLock(map, fixedCameraState, locked);
    },
    setRoomsVisible: (visible: boolean) => {
      if (roomsVisible === visible) {
        return;
      }

      roomsVisible = visible;

      for (const room of roomMap.values()) {
        room.polygon.hidden = !visible;
      }
    },
    setSelectedRoom: (roomId: string) => {
      setSelectedRoom(roomId || null);
    },
  };
}
