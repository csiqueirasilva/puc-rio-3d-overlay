import {
  createBoxId,
  createBoxName,
  cloneBoxesConfig,
  type BoxConfig,
} from './config';
import {
  getDefaultCameraState,
  type CameraState,
  type LatLngAltitude,
} from './cameraUrlState';
import { editorStore } from './editorStore';
import { loadGoogleMaps3D } from './googleMapsLoader';

const LOCK_BOUNDS_DELTA = 0.00008;
const CAMERA_EPSILON = 0.0001;
const DEFAULT_BOX_SCALE = {
  x: 6,
  y: 6,
  z: 4,
} as const;

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

export interface SceneController {
  destroy: () => void;
  getCameraState: () => CameraState;
  getBoxes: () => BoxConfig[];
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
  return (
    state.transformDragging ||
    (state.selectedSpaceId !== null && state.placementMode === 'idle')
  );
}

export async function initializeGoogleMapsScene(
  container: HTMLElement,
  options: InitializeSceneOptions = {},
): Promise<SceneController> {
  const { Map3DElement } = await loadGoogleMaps3D();

  let fixedCameraState = cloneCameraState(
    options.initialCameraState ?? getDefaultCameraState(),
  );
  let boxes = cloneBoxesConfig(editorStore.getState().boxes);
  let boxPlacementArmed = editorStore.getState().placementMode === 'placing-space';
  let cameraLocked = editorStore.getState().cameraLocked;
  let selectedSpaceId = editorStore.getState().selectedSpaceId;
  let mapInteractionBlocked = shouldBlockMapInteraction(editorStore.getState());
  let enforcingCamera = false;

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

  const setBoxPlacementArmed = (armed: boolean): void => {
    if (boxPlacementArmed === armed) {
      return;
    }

    boxPlacementArmed = armed;
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

    editorStore.getState().setHoveredSpaceId(null);
    editorStore.getState().selectSpace(null, 'scene');
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
    },
  );
  const unsubscribePlacementMode = editorStore.subscribe(
    (state) => state.placementMode,
    (nextPlacementMode) => {
      setBoxPlacementArmed(nextPlacementMode === 'placing-space');
      mapInteractionBlocked = shouldBlockMapInteraction(editorStore.getState());
      applyMapInteractionLock(map, mapInteractionBlocked);
    },
  );
  const unsubscribeSelectedSpace = editorStore.subscribe(
    (state) => state.selectedSpaceId,
    (nextSelectedSpaceId) => {
      selectedSpaceId = nextSelectedSpaceId;
      mapInteractionBlocked = shouldBlockMapInteraction(editorStore.getState());
      applyMapInteractionLock(map, mapInteractionBlocked);
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
        selectedSpaceId,
        transformDragging: nextDragging,
      });
      applyMapInteractionLock(map, mapInteractionBlocked);
    },
  );

  map.addEventListener('gmp-click', handleMapClick);

  applyMapInteractionLock(map, mapInteractionBlocked);
  applyCameraLock(map, fixedCameraState, cameraLocked);
  syncCameraState();

  return {
    destroy: () => {
      for (const eventName of cameraEvents) {
        map.removeEventListener(eventName, handleCameraEvent);
      }

      unsubscribeBoxes();
      unsubscribePlacementMode();
      unsubscribeSelectedSpace();
      unsubscribeCameraLocked();
      unsubscribeTransformDragging();
      map.removeEventListener('gmp-click', handleMapClick);
      container.replaceChildren();
    },
    getCameraState: () => readCameraState(map, fixedCameraState),
    getBoxes: () => cloneBoxesConfig(boxes),
    setCameraState: (cameraState: CameraState) => {
      fixedCameraState = cloneCameraState(cameraState);
      applyCameraState(map, fixedCameraState);
      mapInteractionBlocked = shouldBlockMapInteraction(editorStore.getState());
      applyMapInteractionLock(map, mapInteractionBlocked);
      applyCameraLock(map, fixedCameraState, cameraLocked);
      syncCameraState();
    },
  };
}
