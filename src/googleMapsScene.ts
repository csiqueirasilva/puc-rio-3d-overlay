import {
  cloneBoxesConfig,
  createBoxId,
  createBoxName,
  type BoxConfig,
} from './config';
import {
  getDefaultCameraState,
  type CameraState,
  type LatLngAltitude,
} from './cameraUrlState';
import { getBoxWorldCorners, pickBoxAtScreenPoint } from './boxMath';
import { editorStore } from './editorStore';
import { loadGoogleMaps3D } from './googleMapsLoader';

const LOCK_BOUNDS_DELTA = 0.00008;
const CAMERA_EPSILON = 0.0001;
const DEFAULT_BOX_SCALE = {
  x: 6,
  y: 6,
  z: 4,
} as const;

const FACE_INDEXES = [
  [0, 1, 2, 3],
  [4, 5, 6, 7],
  [0, 1, 5, 4],
  [1, 2, 6, 5],
  [2, 3, 7, 6],
  [3, 0, 4, 7],
] as const;

const EDGE_INDEXES = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
] as const;

type PolygonFaceElement = HTMLElement & {
  altitudeMode?: string;
  drawsOccludedSegments?: boolean;
  fillColor?: string;
  geodesic?: boolean;
  outerCoordinates?: Iterable<LatLngAltitude>;
  strokeColor?: string;
  strokeWidth?: number;
  zIndex?: number;
};

type PolylineElement = HTMLElement & {
  altitudeMode?: string;
  coordinates?: Iterable<LatLngAltitude>;
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

type LocationClickEvent = Event & {
  position?: LatLngAltitude;
};

interface BoxRenderMeta {
  boxId: string;
  edges: PolylineElement[];
  faces: PolygonFaceElement[];
}

interface BoxVisualStyle {
  edgeColor: string;
  edgeOutline: string;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  zIndex: number;
}

export interface SceneController {
  destroy: () => void;
  getBoxes: () => BoxConfig[];
  getCameraState: () => CameraState;
  setCameraState: (cameraState: CameraState) => void;
}

interface InitializeSceneOptions {
  initialCameraState?: CameraState;
  onCameraStateChange?: (cameraState: CameraState) => void;
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

function applyMapInteractionLock(
  map: Map3DElementInstance,
  blocked: boolean,
): void {
  map.gestureHandling = blocked ? 'NONE' : 'COOPERATIVE';
}

function shouldBlockMapInteraction(state: {
  placementMode: 'idle' | 'placing-space';
  selectedSpaceId: string | null;
  transformDragging: boolean;
}): boolean {
  return state.transformDragging;
}

function getBoxVisualStyle(
  boxId: string,
  selectedBoxId: string | null,
  hoveredBoxId: string | null,
): BoxVisualStyle {
  if (boxId === selectedBoxId) {
    return {
      edgeColor: 'rgba(250, 204, 21, 1)',
      edgeOutline: 'rgba(146, 64, 14, 0.95)',
      fillColor: 'rgba(250, 204, 21, 0.34)',
      strokeColor: 'rgba(254, 240, 138, 0.98)',
      strokeWidth: 3,
      zIndex: 24,
    };
  }

  if (!selectedBoxId && boxId === hoveredBoxId) {
    return {
      edgeColor: 'rgba(125, 211, 252, 1)',
      edgeOutline: 'rgba(30, 41, 59, 0.85)',
      fillColor: 'rgba(125, 211, 252, 0.26)',
      strokeColor: 'rgba(191, 219, 254, 0.95)',
      strokeWidth: 2.5,
      zIndex: 18,
    };
  }

  return {
    edgeColor: 'rgba(96, 165, 250, 0.92)',
    edgeOutline: 'rgba(15, 23, 42, 0.82)',
    fillColor: 'rgba(37, 99, 235, 0.18)',
    strokeColor: 'rgba(147, 197, 253, 0.7)',
    strokeWidth: 2,
    zIndex: 12,
  };
}

function toReversedCoordinates(
  coordinates: readonly LatLngAltitude[],
): LatLngAltitude[] {
  return [...coordinates].reverse();
}

export async function initializeGoogleMapsScene(
  container: HTMLElement,
  options: InitializeSceneOptions = {},
): Promise<SceneController> {
  const { Map3DElement, Polygon3DInteractiveElement, Polyline3DElement } =
    await loadGoogleMaps3D();

  let fixedCameraState = cloneCameraState(
    options.initialCameraState ?? getDefaultCameraState(),
  );
  let boxes = cloneBoxesConfig(editorStore.getState().boxes);
  let boxPlacementArmed = editorStore.getState().placementMode === 'placing-space';
  let cameraLocked = editorStore.getState().cameraLocked;
  let hoveredBoxId = editorStore.getState().hoveredSpaceId;
  let selectedBoxId = editorStore.getState().selectedSpaceId;
  let mapInteractionBlocked = shouldBlockMapInteraction(editorStore.getState());
  let enforcingCamera = false;
  let destroyed = false;

  const boxElements = new Map<string, BoxRenderMeta>();

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

  const syncCameraState = (): void => {
    options.onCameraStateChange?.(readCameraState(map, fixedCameraState));
  };

  const updateBoxStyles = (): void => {
    for (const meta of boxElements.values()) {
      const style = getBoxVisualStyle(meta.boxId, selectedBoxId, hoveredBoxId);

      for (const face of meta.faces) {
        face.drawsOccludedSegments = true;
        face.fillColor = style.fillColor;
        face.strokeColor = style.strokeColor;
        face.strokeWidth = style.strokeWidth;
        face.zIndex = style.zIndex;
      }

      for (const edge of meta.edges) {
        edge.drawsOccludedSegments = true;
        edge.outerColor = style.edgeOutline;
        edge.outerWidth = 1;
        edge.strokeColor = style.edgeColor;
        edge.strokeWidth = 2;
        edge.zIndex = style.zIndex + 1;
      }
    }
  };

  const setHoveredBox = (boxId: string | null, propagate: boolean): void => {
    if (hoveredBoxId === boxId) {
      return;
    }

    hoveredBoxId = boxId;

    if (propagate && editorStore.getState().hoveredSpaceId !== boxId) {
      editorStore.getState().setHoveredSpaceId(boxId);
    }

    updateBoxStyles();
  };

  const setSelectedBox = (boxId: string | null, propagate: boolean): void => {
    if (selectedBoxId === boxId) {
      return;
    }

    selectedBoxId = boxId;

    if (propagate && editorStore.getState().selectedSpaceId !== boxId) {
      editorStore.getState().selectSpace(boxId, 'scene');
    }

    updateBoxStyles();
    applyMapInteractionLock(
      map,
      shouldBlockMapInteraction({
        placementMode: boxPlacementArmed ? 'placing-space' : 'idle',
        selectedSpaceId: selectedBoxId,
        transformDragging: editorStore.getState().transformDragging,
      }),
    );
  };

  const createBoxAtPosition = (position: LatLngAltitude): void => {
    const nextBox: BoxConfig = {
      id: createBoxId(),
      name: createBoxName(boxes),
      position: {
        altitude: position.altitude,
        lat: position.lat,
        lng: position.lng,
      },
      rotation: {
        x: 0,
        y: 0,
        z: 0,
      },
      scale: { ...DEFAULT_BOX_SCALE },
    };

    editorStore.getState().addSpace(nextBox);
    editorStore.getState().selectSpace(nextBox.id, 'scene');
    editorStore.getState().clearPlacementMode();
  };

  const handleFaceClick = (boxId: string) => (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();

    const clickEvent = event as LocationClickEvent;

    if (boxPlacementArmed && clickEvent.position) {
      createBoxAtPosition(clickEvent.position);
      return;
    }

    setSelectedBox(boxId, true);
  };

  function renderBoxes(): void {
    for (const meta of boxElements.values()) {
      for (const face of meta.faces) {
        face.remove();
      }

      for (const edge of meta.edges) {
        edge.remove();
      }
    }

    boxElements.clear();

    for (const box of boxes) {
      const corners = getBoxWorldCorners(box);
      const meta: BoxRenderMeta = {
        boxId: box.id,
        edges: [],
        faces: [],
      };

      for (const [startIndex, endIndex] of EDGE_INDEXES) {
        const edge = new Polyline3DElement({
          altitudeMode: 'ABSOLUTE',
          coordinates: [corners[startIndex], corners[endIndex]],
          drawsOccludedSegments: true,
          geodesic: false,
          outerColor: 'rgba(15, 23, 42, 0.82)',
          outerWidth: 1,
          strokeColor: 'rgba(96, 165, 250, 0.92)',
          strokeWidth: 2,
          zIndex: 13,
        }) as PolylineElement;

        meta.edges.push(edge);
        map.append(edge);
      }

      for (const faceIndexes of FACE_INDEXES) {
        const faceCoordinates = faceIndexes.map((index) => corners[index]);

        for (const coordinates of [
          faceCoordinates,
          toReversedCoordinates(faceCoordinates),
        ]) {
          const face = new Polygon3DInteractiveElement({
            altitudeMode: 'ABSOLUTE',
            drawsOccludedSegments: true,
            fillColor: 'rgba(37, 99, 235, 0.18)',
            geodesic: false,
            outerCoordinates: coordinates,
            strokeColor: 'rgba(147, 197, 253, 0.7)',
            strokeWidth: 2,
            zIndex: 12,
          }) as PolygonFaceElement;

          face.addEventListener('gmp-click', handleFaceClick(box.id));

          meta.faces.push(face);
          map.append(face);
        }
      }

      boxElements.set(box.id, meta);
    }

    updateBoxStyles();
  }

  const handleMapClick = (event: Event): void => {
    if (editorStore.getState().consumeNextMapClickBlock()) {
      return;
    }

    const clickEvent = event as LocationClickEvent;

    if (boxPlacementArmed && clickEvent.position) {
      event.preventDefault();
      createBoxAtPosition(clickEvent.position);
      return;
    }

    setHoveredBox(null, true);
    setSelectedBox(null, true);
  };

  const handleCameraEvent = (): void => {
    if (!cameraLocked || enforcingCamera) {
      syncCameraState();
      return;
    }

    const currentState = readCameraState(map, fixedCameraState);
    const headingDiff = Math.abs(currentState.heading - fixedCameraState.heading);
    const tiltDiff = Math.abs(currentState.tilt - fixedCameraState.tilt);
    const rangeDiff = Math.abs(currentState.range - fixedCameraState.range);
    const latDiff = Math.abs(currentState.center.lat - fixedCameraState.center.lat);
    const lngDiff = Math.abs(currentState.center.lng - fixedCameraState.center.lng);

    if (
      headingDiff < CAMERA_EPSILON &&
      tiltDiff < CAMERA_EPSILON &&
      rangeDiff < CAMERA_EPSILON &&
      latDiff < CAMERA_EPSILON &&
      lngDiff < CAMERA_EPSILON
    ) {
      syncCameraState();
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

  const handleContainerPointerMove = (event: PointerEvent): void => {
    if (destroyed) {
      return;
    }

    const bounds = container.getBoundingClientRect();
    const nextHoveredBoxId = pickBoxAtScreenPoint(
      boxes,
      readCameraState(map, fixedCameraState),
      bounds.width,
      bounds.height,
      event.clientX - bounds.left,
      event.clientY - bounds.top,
    );

    setHoveredBox(nextHoveredBoxId, true);
  };

  const handleContainerPointerLeave = (): void => {
    if (!selectedBoxId) {
      setHoveredBox(null, true);
    }
  };

  const cameraEvents = [
    'gmp-camerapositionchange',
    'gmp-centerchange',
    'gmp-fovchange',
    'gmp-headingchange',
    'gmp-rangechange',
    'gmp-tiltchange',
  ] as const;

  for (const eventName of cameraEvents) {
    map.addEventListener(eventName, handleCameraEvent);
  }

  const unsubscribeBoxes = editorStore.subscribe(
    (state) => state.boxes,
    (nextBoxes) => {
      boxes = cloneBoxesConfig(nextBoxes);
      renderBoxes();
    },
  );
  const unsubscribeHoveredSpace = editorStore.subscribe(
    (state) => state.hoveredSpaceId,
    (nextHoveredSpaceId) => {
      setHoveredBox(nextHoveredSpaceId, false);
    },
  );
  const unsubscribePlacementMode = editorStore.subscribe(
    (state) => state.placementMode,
    (nextPlacementMode) => {
      boxPlacementArmed = nextPlacementMode === 'placing-space';
      mapInteractionBlocked = shouldBlockMapInteraction(editorStore.getState());
      applyMapInteractionLock(map, mapInteractionBlocked);
    },
  );
  const unsubscribeSelectedSpace = editorStore.subscribe(
    (state) => state.selectedSpaceId,
    (nextSelectedSpaceId) => {
      setSelectedBox(nextSelectedSpaceId, false);
    },
  );
  const unsubscribeCameraLocked = editorStore.subscribe(
    (state) => state.cameraLocked,
    (locked) => {
      cameraLocked = locked;
      applyCameraLock(map, fixedCameraState, locked);
      syncCameraState();
    },
  );
  const unsubscribeTransformDragging = editorStore.subscribe(
    (state) => state.transformDragging,
    (nextDragging) => {
      mapInteractionBlocked = shouldBlockMapInteraction({
        placementMode: boxPlacementArmed ? 'placing-space' : 'idle',
        selectedSpaceId: selectedBoxId,
        transformDragging: nextDragging,
      });
      applyMapInteractionLock(map, mapInteractionBlocked);
    },
  );

  map.addEventListener('gmp-click', handleMapClick);
  container.addEventListener('pointermove', handleContainerPointerMove);
  container.addEventListener('pointerleave', handleContainerPointerLeave);

  applyMapInteractionLock(map, mapInteractionBlocked);
  applyCameraLock(map, fixedCameraState, cameraLocked);
  renderBoxes();
  syncCameraState();

  return {
    destroy: () => {
      destroyed = true;

      for (const eventName of cameraEvents) {
        map.removeEventListener(eventName, handleCameraEvent);
      }

      unsubscribeBoxes();
      unsubscribeHoveredSpace();
      unsubscribePlacementMode();
      unsubscribeSelectedSpace();
      unsubscribeCameraLocked();
      unsubscribeTransformDragging();
      map.removeEventListener('gmp-click', handleMapClick);
      container.removeEventListener('pointermove', handleContainerPointerMove);
      container.removeEventListener('pointerleave', handleContainerPointerLeave);
      container.replaceChildren();
    },
    getBoxes: () => cloneBoxesConfig(boxes),
    getCameraState: () => readCameraState(map, fixedCameraState),
    setCameraState: (cameraState: CameraState) => {
      fixedCameraState = cloneCameraState(cameraState);
      applyCameraState(map, fixedCameraState);
      applyCameraLock(map, fixedCameraState, cameraLocked);
      syncCameraState();
      updateBoxStyles();
    },
  };
}
