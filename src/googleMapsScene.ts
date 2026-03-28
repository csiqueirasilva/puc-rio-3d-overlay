import {
  buildEntityId,
  buildings,
  cloneBuildingConfig,
  cloneBuildingsConfig,
  getBuildingIdFromRoomId,
  patternStatus,
  type BuildingConfig,
  type RoomStatus,
} from './config';
import {
  getDefaultCameraState,
  type CameraState,
  type LatLngAltitude,
} from './cameraUrlState';
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

const gizmoPalette = {
  x: {
    outer: 'rgba(248, 113, 113, 1)',
    stroke: 'rgba(239, 68, 68, 1)',
  },
  y: {
    outer: 'rgba(74, 222, 128, 1)',
    stroke: 'rgba(34, 197, 94, 1)',
  },
  z: {
    outer: 'rgba(96, 165, 250, 1)',
    stroke: 'rgba(59, 130, 246, 1)',
  },
};

type AxisName = 'x' | 'y' | 'z';

type InteractivePolygonElement = HTMLElement & {
  altitudeMode?: string;
  drawsOccludedSegments?: boolean;
  fillColor?: string;
  geodesic?: boolean;
  outerCoordinates?: LatLngAltitude[];
  strokeColor?: string;
  strokeWidth?: number;
  zIndex?: number;
};

type InteractivePolylineElement = HTMLElement & {
  altitudeMode?: string;
  coordinates?: LatLngAltitude[];
  drawsOccludedSegments?: boolean;
  geodesic?: boolean;
  outerColor?: string;
  outerWidth?: number;
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
  maxHeading?: number;
  maxTilt?: number;
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
  col: number;
  floor: number;
  id: string;
  polygon: InteractivePolygonElement;
  row: number;
  status: RoomStatus;
}

interface DragState {
  axis: AxisName;
  buildingId: string;
  initialBuilding: BuildingConfig;
  pointerId: number;
  startX: number;
  startY: number;
}

export interface SceneController {
  destroy: () => void;
  getBuildingConfigs: () => BuildingConfig[];
  getCameraState: () => CameraState;
  setBuildingConfigs: (nextBuildings: BuildingConfig[]) => void;
  setCameraLocked: (locked: boolean) => void;
  setCameraState: (cameraState: CameraState) => void;
  setRoomsVisible: (visible: boolean) => void;
  setSelectedBuilding: (buildingId: string) => void;
  setSelectedRoom: (roomId: string) => void;
}

interface InitializeSceneOptions {
  initialBuildings?: BuildingConfig[];
  initialCameraState?: CameraState;
  onCameraStateChange?: (cameraState: CameraState) => void;
  onRoomHovered?: (roomId: string | null) => void;
  onRoomSelected?: (roomId: string) => void;
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function cloneCameraState(cameraState: CameraState): CameraState {
  return {
    center: {
      ...cameraState.center,
    },
    fov: cameraState.fov,
    heading: cameraState.heading,
    range: cameraState.range,
    tilt: cameraState.tilt,
  };
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

function applyCameraState(
  map: Map3DElementInstance,
  cameraState: CameraState,
): void {
  map.center = { ...cameraState.center };
  map.fov = cameraState.fov;
  map.heading = cameraState.heading;
  map.range = cameraState.range;
  map.tilt = cameraState.tilt;
}

function readCameraState(
  map: Map3DElementInstance,
  fallbackCameraState: CameraState,
): CameraState {
  return {
    center: {
      altitude: map.center?.altitude ?? fallbackCameraState.center.altitude,
      lat: map.center?.lat ?? fallbackCameraState.center.lat,
      lng: map.center?.lng ?? fallbackCameraState.center.lng,
    },
    fov: map.fov ?? fallbackCameraState.fov,
    heading: map.heading ?? fallbackCameraState.heading,
    range: map.range ?? fallbackCameraState.range,
    tilt: map.tilt ?? fallbackCameraState.tilt,
  };
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
    const { lat, lng } = translateLatLng(
      building.lat,
      building.lon,
      east,
      north,
    );

    return {
      altitude,
      lat,
      lng,
    };
  });
}

function getBuildingCenter(building: BuildingConfig): LatLngAltitude {
  const offsetX = building.grid.offsetX ?? 0;
  const offsetY = building.grid.offsetY ?? 0;
  const offsetZ = building.grid.offsetZ ?? 0;
  const { east, north } = rotateLocalOffset(offsetX, offsetY, building.headingDeg);
  const { lat, lng } = translateLatLng(building.lat, building.lon, east, north);

  return {
    altitude: building.baseHeight + offsetZ + (building.grid.floors * building.grid.cellZ) / 2,
    lat,
    lng,
  };
}

function getGizmoAxisCoordinates(
  building: BuildingConfig,
  axis: AxisName,
): LatLngAltitude[] {
  const center = getBuildingCenter(building);
  const { cols, rows, floors, cellX, cellY, cellZ } = building.grid;
  const localLengthX = Math.max(cols * cellX * 0.6, 12);
  const localLengthY = Math.max(rows * cellY * 0.9, 12);
  const localLengthZ = Math.max(floors * cellZ * 0.8, 12);

  if (axis === 'z') {
    return [
      center,
      {
        ...center,
        altitude: center.altitude + localLengthZ,
      },
    ];
  }

  const localEnd =
    axis === 'x'
      ? { x: (building.grid.offsetX ?? 0) + localLengthX, y: building.grid.offsetY ?? 0 }
      : { x: building.grid.offsetX ?? 0, y: (building.grid.offsetY ?? 0) + localLengthY };
  const { east, north } = rotateLocalOffset(
    localEnd.x,
    localEnd.y,
    building.headingDeg,
  );
  const { lat, lng } = translateLatLng(building.lat, building.lon, east, north);

  return [
    center,
    {
      altitude: center.altitude,
      lat,
      lng,
    },
  ];
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

function projectDragToAxis(
  axis: AxisName,
  dragState: DragState,
  currentBuilding: BuildingConfig,
  cameraHeading: number,
  dx: number,
  dy: number,
): number {
  if (axis === 'z') {
    return -dy;
  }

  const axisHeading =
    axis === 'x'
      ? currentBuilding.headingDeg
      : currentBuilding.headingDeg + 90;
  const relativeAngle = degreesToRadians(axisHeading - cameraHeading);

  return dx * Math.cos(relativeAngle) - dy * Math.sin(relativeAngle);
}

export async function initializeGoogleMapsScene(
  container: HTMLElement,
  options: InitializeSceneOptions = {},
): Promise<SceneController> {
  const {
    Map3DElement,
    Polygon3DInteractiveElement,
    Polyline3DInteractiveElement,
  } = await loadGoogleMaps3D();
  let fixedCameraState = cloneCameraState(
    options.initialCameraState ?? getDefaultCameraState(),
  );
  let currentBuildings = cloneBuildingsConfig(
    options.initialBuildings ?? buildings,
  );
  const map = new Map3DElement({
    center: fixedCameraState.center,
    defaultUIHidden: true,
    fov: fixedCameraState.fov,
    gestureHandling: 'COOPERATIVE',
    heading: fixedCameraState.heading,
    mode: 'SATELLITE',
    range: fixedCameraState.range,
    tilt: fixedCameraState.tilt,
  }) as Map3DElementInstance;

  container.replaceChildren();
  container.append(map);

  let roomMap = new Map<string, RoomMeta>();
  let roomElements: InteractivePolygonElement[] = [];
  let roomsVisible = true;
  let cameraLocked = true;
  let hoveredRoomId: string | null = null;
  let selectedBuildingId: string | null = currentBuildings[0]?.id ?? null;
  let selectedRoomId: string | null = null;
  let enforcingCamera = false;
  let dragState: DragState | null = null;

  const gizmoAxes: Record<AxisName, InteractivePolylineElement> = {
    x: new Polyline3DInteractiveElement({
      altitudeMode: 'ABSOLUTE',
      coordinates: [],
      drawsOccludedSegments: true,
      geodesic: false,
      outerColor: gizmoPalette.x.outer,
      outerWidth: 4,
      strokeColor: gizmoPalette.x.stroke,
      strokeWidth: 2.2,
      zIndex: 999,
    }) as InteractivePolylineElement,
    y: new Polyline3DInteractiveElement({
      altitudeMode: 'ABSOLUTE',
      coordinates: [],
      drawsOccludedSegments: true,
      geodesic: false,
      outerColor: gizmoPalette.y.outer,
      outerWidth: 4,
      strokeColor: gizmoPalette.y.stroke,
      strokeWidth: 2.2,
      zIndex: 999,
    }) as InteractivePolylineElement,
    z: new Polyline3DInteractiveElement({
      altitudeMode: 'ABSOLUTE',
      coordinates: [],
      drawsOccludedSegments: true,
      geodesic: false,
      outerColor: gizmoPalette.z.outer,
      outerWidth: 4,
      strokeColor: gizmoPalette.z.stroke,
      strokeWidth: 2.2,
      zIndex: 999,
    }) as InteractivePolylineElement,
  };

  const getCurrentBuildingById = (
    buildingId: string | null,
  ): BuildingConfig | undefined => {
    if (!buildingId) {
      return undefined;
    }

    return currentBuildings.find((building) => building.id === buildingId);
  };

  const syncCameraState = (): void => {
    options.onCameraStateChange?.(readCameraState(map, fixedCameraState));
  };

  const refreshRoom = (roomId: string): void => {
    const room = roomMap.get(roomId);

    if (!room) {
      return;
    }

    const building = getCurrentBuildingById(room.buildingId);

    if (!building) {
      return;
    }

    room.polygon.outerCoordinates = buildRoomPolygonCoordinates(
      building,
      room.floor,
      room.row,
      room.col,
    );
    setRoomAppearance(room, hoveredRoomId, selectedRoomId);
    room.polygon.hidden = !roomsVisible;
  };

  const refreshGizmo = (): void => {
    const selectedBuilding = getCurrentBuildingById(selectedBuildingId);

    if (!selectedBuilding || !roomsVisible) {
      for (const axis of Object.keys(gizmoAxes) as AxisName[]) {
        gizmoAxes[axis].hidden = true;
      }
      return;
    }

    for (const axis of Object.keys(gizmoAxes) as AxisName[]) {
      const gizmo = gizmoAxes[axis];
      gizmo.coordinates = getGizmoAxisCoordinates(selectedBuilding, axis);
      gizmo.hidden = false;
    }
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

    if (selectedRoomId) {
      selectedBuildingId = getBuildingIdFromRoomId(selectedRoomId);
    }

    if (previousSelectedRoomId) {
      refreshRoom(previousSelectedRoomId);
    }

    if (selectedRoomId) {
      refreshRoom(selectedRoomId);
    }

    refreshGizmo();
  };

  const renderRooms = (): void => {
    for (const element of roomElements) {
      element.remove();
    }

    roomElements = [];
    roomMap = new Map<string, RoomMeta>();

    for (const building of currentBuildings) {
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
              outerCoordinates: buildRoomPolygonCoordinates(
                building,
                floor,
                row,
                col,
              ),
              strokeColor: roomPalette[status].stroke,
              strokeWidth: 1.35,
              zIndex: floor + 1,
            }) as InteractivePolygonElement;

            polygon.addEventListener('gmp-click', () => {
              selectedBuildingId = building.id;
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

            const roomMeta: RoomMeta = {
              baseFill: roomPalette[status].fill,
              baseStroke: roomPalette[status].stroke,
              buildingId: building.id,
              col,
              floor,
              id: roomId,
              polygon,
              row,
              status,
            };

            roomMap.set(roomId, roomMeta);
            setRoomAppearance(roomMeta, hoveredRoomId, selectedRoomId);
            polygon.hidden = !roomsVisible;
            map.append(polygon);
            roomElements.push(polygon);
          }
        }
      }
    }

    for (const axis of Object.keys(gizmoAxes) as AxisName[]) {
      map.append(gizmoAxes[axis]);
    }

    refreshGizmo();
  };

  const applyBuildingTransform = (
    buildingId: string,
    nextBuilding: BuildingConfig,
  ): void => {
    currentBuildings = currentBuildings.map((building) =>
      building.id === buildingId ? cloneBuildingConfig(nextBuilding) : building,
    );

    for (const room of roomMap.values()) {
      if (room.buildingId === buildingId) {
        refreshRoom(room.id);
      }
    }

    refreshGizmo();
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
      syncCameraState();
    }, 0);
  };

  const handleDragMove = (event: PointerEvent): void => {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    const currentBuilding = getCurrentBuildingById(dragState.buildingId);

    if (!currentBuilding) {
      return;
    }

    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    const cameraHeading = map.heading ?? fixedCameraState.heading;
    const dragProjection = projectDragToAxis(
      dragState.axis,
      dragState,
      currentBuilding,
      cameraHeading,
      dx,
      dy,
    );
    const metersPerPixel = Math.max((map.range ?? fixedCameraState.range) / 220, 0.04);
    const movement = dragProjection * metersPerPixel;
    const nextBuilding = cloneBuildingConfig(dragState.initialBuilding);

    if (dragState.axis === 'x') {
      nextBuilding.grid.offsetX = (dragState.initialBuilding.grid.offsetX ?? 0) + movement;
    } else if (dragState.axis === 'y') {
      nextBuilding.grid.offsetY = (dragState.initialBuilding.grid.offsetY ?? 0) + movement;
    } else {
      nextBuilding.grid.offsetZ =
        (dragState.initialBuilding.grid.offsetZ ?? 0) + movement * 0.8;
    }

    applyBuildingTransform(dragState.buildingId, nextBuilding);
  };

  const handleDragEnd = (event: PointerEvent): void => {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    dragState = null;
    container.style.cursor = '';
  };

  const startAxisDrag = (axis: AxisName) => (event: PointerEvent): void => {
    const selectedBuilding = getCurrentBuildingById(selectedBuildingId);

    if (!selectedBuilding) {
      return;
    }

    event.preventDefault();
    dragState = {
      axis,
      buildingId: selectedBuilding.id,
      initialBuilding: cloneBuildingConfig(selectedBuilding),
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    container.style.cursor = axis === 'z' ? 'ns-resize' : 'grabbing';
  };

  for (const axis of Object.keys(gizmoAxes) as AxisName[]) {
    const gizmo = gizmoAxes[axis];
    gizmo.hidden = true;
    gizmo.style.pointerEvents = 'auto';
    gizmo.addEventListener('pointerdown', startAxisDrag(axis) as EventListener);
    map.append(gizmo);
  }

  const cameraEvents = [
    'gmp-camerapositionchange',
    'gmp-centerchange',
    'gmp-fovchange',
    'gmp-headingchange',
    'gmp-rangechange',
    'gmp-tiltchange',
  ] as const;

  const handleCameraEvent = (): void => {
    enforceFixedCamera();
    syncCameraState();
  };

  for (const eventName of cameraEvents) {
    map.addEventListener(eventName, handleCameraEvent);
  }

  applyCameraLock(map, fixedCameraState, cameraLocked);
  renderRooms();
  refreshGizmo();
  syncCameraState();

  const handlePointerLeave = (): void => {
    if (!dragState) {
      setHoveredRoom(null);
    }
  };

  container.addEventListener('pointerleave', handlePointerLeave);
  container.addEventListener('pointermove', handleDragMove);
  window.addEventListener('pointerup', handleDragEnd);

  return {
    destroy: () => {
      container.removeEventListener('pointerleave', handlePointerLeave);
      container.removeEventListener('pointermove', handleDragMove);
      window.removeEventListener('pointerup', handleDragEnd);

      for (const eventName of cameraEvents) {
        map.removeEventListener(eventName, handleCameraEvent);
      }

      container.replaceChildren();
    },
    getBuildingConfigs: () => cloneBuildingsConfig(currentBuildings),
    getCameraState: () => readCameraState(map, fixedCameraState),
    setBuildingConfigs: (nextBuildings: BuildingConfig[]) => {
      currentBuildings = cloneBuildingsConfig(nextBuildings);
      renderRooms();
    },
    setCameraLocked: (locked: boolean) => {
      cameraLocked = locked;
      applyCameraLock(map, fixedCameraState, locked);
      syncCameraState();
    },
    setCameraState: (cameraState: CameraState) => {
      fixedCameraState = cloneCameraState(cameraState);
      applyCameraState(map, fixedCameraState);
      applyCameraLock(map, fixedCameraState, cameraLocked);
      syncCameraState();
    },
    setRoomsVisible: (visible: boolean) => {
      if (roomsVisible === visible) {
        return;
      }

      roomsVisible = visible;

      for (const room of roomMap.values()) {
        room.polygon.hidden = !visible;
      }

      refreshGizmo();
    },
    setSelectedBuilding: (buildingId: string) => {
      selectedBuildingId = buildingId || null;
      refreshGizmo();
    },
    setSelectedRoom: (roomId: string) => {
      setSelectedRoom(roomId || null);
    },
  };
}
