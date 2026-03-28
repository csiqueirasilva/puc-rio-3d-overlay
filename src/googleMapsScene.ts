import {
  createBoxId,
  cloneBoxConfig,
  cloneBoxesConfig,
  getBoxById,
  type BoxConfig,
} from './config';
import {
  getDefaultCameraState,
  type CameraState,
  type LatLngAltitude,
} from './cameraUrlState';
import { loadGoogleMaps3D } from './googleMapsLoader';

const LOCK_BOUNDS_DELTA = 0.00008;
const CAMERA_EPSILON = 0.0001;
const DEFAULT_BOX_SCALE = {
  x: 6,
  y: 6,
  z: 4,
} as const;
const MODEL_DEFAULT_SRC = './models/box-default.glb';
const MODEL_EDIT_SRC = './models/box-editing.glb';

type AxisName = 'x' | 'y' | 'z';
type EditTool = 'move' | 'scale';

type Vector3Literal = {
  x: number;
  y: number;
  z: number;
};

type Orientation3DLiteral = {
  heading?: number;
  roll?: number;
  tilt?: number;
};

type LocationClickEvent = Event & {
  position?: LatLngAltitude;
};

type InteractiveMarkerElement = HTMLElement & {
  altitudeMode?: string;
  drawsWhenOccluded?: boolean;
  extruded?: boolean;
  label?: string;
  position?: LatLngAltitude;
  sizePreserved?: boolean;
  zIndex?: number;
};

type InteractiveModelElement = HTMLElement & {
  altitudeMode?: string;
  orientation?: Orientation3DLiteral;
  position?: LatLngAltitude;
  scale?: Vector3Literal;
  src?: string;
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

interface BoxMeta {
  box: BoxConfig;
  element: InteractiveModelElement;
}

interface DragState {
  axis: AxisName;
  boxId: string;
  pointerId: number;
  startX: number;
  startY: number;
  tool: EditTool;
}

export interface SceneController {
  clearEditingBox: () => void;
  destroy: () => void;
  getCameraState: () => CameraState;
  getBoxes: () => BoxConfig[];
  setBoxes: (boxes: BoxConfig[]) => void;
  setCameraLocked: (locked: boolean) => void;
  setCameraState: (cameraState: CameraState) => void;
  setEditTool: (tool: EditTool) => void;
  setEditingBox: (boxId: string | null) => void;
}

interface InitializeSceneOptions {
  initialBoxes?: BoxConfig[];
  initialCameraState?: CameraState;
  onCameraStateChange?: (cameraState: CameraState) => void;
  onBoxesChange?: (boxes: BoxConfig[]) => void;
  onEditingBoxChange?: (boxId: string | null) => void;
  onHoverBoxChange?: (boxId: string | null) => void;
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

function modelScaleFromBox(box: BoxConfig): Vector3Literal {
  return {
    x: box.scale.x,
    y: box.scale.z,
    z: box.scale.y,
  };
}

function getHandlePosition(box: BoxConfig, axis: AxisName): LatLngAltitude {
  if (axis === 'x') {
    return {
      altitude: box.position.altitude,
      lat: box.position.lat,
      lng: box.position.lng + box.scale.x * 0.0000036,
    };
  }

  if (axis === 'y') {
    return {
      altitude: box.position.altitude,
      lat: box.position.lat + box.scale.y * 0.0000036,
      lng: box.position.lng,
    };
  }

  return {
    altitude: box.position.altitude + box.scale.z * 0.7,
    lat: box.position.lat,
    lng: box.position.lng,
  };
}

function projectDrag(
  axis: AxisName,
  cameraHeading: number,
  dx: number,
  dy: number,
): number {
  if (axis === 'z') {
    return -dy;
  }

  const axisHeading = axis === 'x' ? 90 : 0;
  const angle = ((axisHeading - cameraHeading) * Math.PI) / 180;
  return dx * Math.cos(angle) - dy * Math.sin(angle);
}

function updateBoxElement(meta: BoxMeta, editingBoxId: string | null): void {
  meta.element.position = { ...meta.box.position };
  meta.element.scale = modelScaleFromBox(meta.box);
  meta.element.src = meta.box.id === editingBoxId ? MODEL_EDIT_SRC : MODEL_DEFAULT_SRC;
}

export async function initializeGoogleMapsScene(
  container: HTMLElement,
  options: InitializeSceneOptions = {},
): Promise<SceneController> {
  const { Map3DElement, Marker3DInteractiveElement, Model3DInteractiveElement } =
    await loadGoogleMaps3D();

  let fixedCameraState = cloneCameraState(
    options.initialCameraState ?? getDefaultCameraState(),
  );
  let boxes = cloneBoxesConfig(options.initialBoxes ?? []);
  let editTool: EditTool = 'move';
  let editingBoxId: string | null = null;
  let hoveredBoxId: string | null = null;
  let dragState: DragState | null = null;
  let cameraLocked = false;
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

  const boxElements = new Map<string, BoxMeta>();
  const axisHandles: Record<AxisName, InteractiveMarkerElement> = {
    x: new Marker3DInteractiveElement({
      altitudeMode: 'ABSOLUTE',
      drawsWhenOccluded: true,
      label: 'X',
      sizePreserved: true,
      zIndex: 999,
    }) as InteractiveMarkerElement,
    y: new Marker3DInteractiveElement({
      altitudeMode: 'ABSOLUTE',
      drawsWhenOccluded: true,
      label: 'Y',
      sizePreserved: true,
      zIndex: 999,
    }) as InteractiveMarkerElement,
    z: new Marker3DInteractiveElement({
      altitudeMode: 'ABSOLUTE',
      drawsWhenOccluded: true,
      label: 'Z',
      sizePreserved: true,
      zIndex: 999,
    }) as InteractiveMarkerElement,
  };

  container.replaceChildren();
  container.append(map);

  const syncCameraState = (): void => {
    options.onCameraStateChange?.(readCameraState(map, fixedCameraState));
  };

  const syncBoxes = (): void => {
    options.onBoxesChange?.(cloneBoxesConfig(boxes));
  };

  const setHoveredBox = (boxId: string | null): void => {
    if (hoveredBoxId === boxId) {
      return;
    }

    hoveredBoxId = boxId;
    options.onHoverBoxChange?.(boxId);
  };

  const refreshAxisHandles = (): void => {
    const editingBox = editingBoxId ? getBoxById(editingBoxId, boxes) : undefined;

    if (!editingBox) {
      for (const axis of Object.keys(axisHandles) as AxisName[]) {
        axisHandles[axis].hidden = true;
      }
      return;
    }

    for (const axis of Object.keys(axisHandles) as AxisName[]) {
      axisHandles[axis].position = getHandlePosition(editingBox, axis);
      axisHandles[axis].hidden = false;
    }
  };

  const renderBoxes = (): void => {
    if (editingBoxId && !getBoxById(editingBoxId, boxes)) {
      editingBoxId = null;
      options.onEditingBoxChange?.(null);
    }

    for (const meta of boxElements.values()) {
      meta.element.remove();
    }

    boxElements.clear();

    for (const box of boxes) {
      const element = new Model3DInteractiveElement({
        altitudeMode: 'ABSOLUTE',
        orientation: {
          heading: 0,
          roll: 0,
          tilt: 0,
        },
        position: { ...box.position },
        scale: modelScaleFromBox(box),
        src: box.id === editingBoxId ? MODEL_EDIT_SRC : MODEL_DEFAULT_SRC,
      }) as InteractiveModelElement;

      element.addEventListener('pointerdown', (event) => {
        if (event.button !== 2) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        editingBoxId = box.id;
        options.onEditingBoxChange?.(box.id);
        refreshAxisHandles();
        renderBoxes();
      });

      element.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        event.stopPropagation();
        editingBoxId = box.id;
        options.onEditingBoxChange?.(box.id);
        refreshAxisHandles();
        renderBoxes();
      });

      element.addEventListener('pointerenter', () => {
        setHoveredBox(box.id);
      });
      element.addEventListener('pointerleave', () => {
        setHoveredBox(null);
      });

      boxElements.set(box.id, {
        box,
        element,
      });
      map.append(element);
    }

    for (const axis of Object.keys(axisHandles) as AxisName[]) {
      map.append(axisHandles[axis]);
    }

    refreshAxisHandles();
  };

  const setEditingBox = (boxId: string | null): void => {
    editingBoxId = boxId;
    options.onEditingBoxChange?.(boxId);
    renderBoxes();
  };

  const upsertBox = (nextBox: BoxConfig): void => {
    boxes = boxes.some((box) => box.id === nextBox.id)
      ? boxes.map((box) => (box.id === nextBox.id ? cloneBoxConfig(nextBox) : box))
      : [...boxes, cloneBoxConfig(nextBox)];
    renderBoxes();
    syncBoxes();
  };

  const handleMapClick = (event: Event): void => {
    const clickEvent = event as LocationClickEvent;

    if (!clickEvent.position) {
      return;
    }

    if (!altPressedRef.current) {
      return;
    }

    event.preventDefault();

    const nextBox: BoxConfig = {
      id: createBoxId(),
      position: {
        altitude: clickEvent.position.altitude + DEFAULT_BOX_SCALE.z / 2,
        lat: clickEvent.position.lat,
        lng: clickEvent.position.lng,
      },
      scale: { ...DEFAULT_BOX_SCALE },
    };

    boxes = [...boxes, nextBox];
    editingBoxId = nextBox.id;
    renderBoxes();
    syncBoxes();
    options.onEditingBoxChange?.(nextBox.id);
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

  const altPressedRef = { current: false };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Alt') {
      altPressedRef.current = true;
    }
  };

  const handleKeyUp = (event: KeyboardEvent): void => {
    if (event.key === 'Alt') {
      altPressedRef.current = false;
    }
  };

  const handlePointerDown = (event: PointerEvent): void => {
    if (event.button === 2 && (event.target === map || event.target === container)) {
      event.preventDefault();
      setEditingBox(null);
    }
  };

  const handleContextMenu = (event: MouseEvent): void => {
    if (event.target === map || event.target === container) {
      event.preventDefault();
      setEditingBox(null);
    }
  };

  const handleAxisPointerDown = (axis: AxisName) => (event: PointerEvent): void => {
    if (!editingBoxId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragState = {
      axis,
      boxId: editingBoxId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      tool: editTool,
    };
    container.style.cursor = dragState.tool === 'scale' ? 'ew-resize' : 'grabbing';
  };

  const handlePointerMove = (event: PointerEvent): void => {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const box = getBoxById(dragState.boxId, boxes);

    if (!box) {
      return;
    }

    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    const cameraRange = map.range ?? fixedCameraState.range;
    const axisPixels = projectDrag(
      dragState.axis,
      map.heading ?? fixedCameraState.heading,
      dx,
      dy,
    );
    const horizontalDegrees = axisPixels * Math.max(cameraRange * 0.00000001, 0.00000015);
    const verticalMeters = -dy * Math.max(cameraRange / 220, 0.02);
    const scaleMeters = axisPixels * Math.max(cameraRange / 450, 0.04);
    const nextBox = cloneBoxConfig(box);

    if (dragState.tool === 'move') {
      if (dragState.axis === 'x') {
        nextBox.position.lng += horizontalDegrees;
      } else if (dragState.axis === 'y') {
        nextBox.position.lat += horizontalDegrees;
      } else {
        nextBox.position.altitude += verticalMeters;
      }
    } else if (dragState.axis === 'x') {
      nextBox.scale.x = Math.max(0.5, nextBox.scale.x + scaleMeters);
    } else if (dragState.axis === 'y') {
      nextBox.scale.y = Math.max(0.5, nextBox.scale.y + scaleMeters);
    } else {
      const bottomAltitude = nextBox.position.altitude - nextBox.scale.z / 2;
      nextBox.scale.z = Math.max(
        0.5,
        nextBox.scale.z + verticalMeters,
      );
      nextBox.position.altitude = bottomAltitude + nextBox.scale.z / 2;
    }

    upsertBox(nextBox);
  };

  const handlePointerUp = (event: PointerEvent): void => {
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    dragState = null;
    container.style.cursor = '';
  };

  for (const axis of Object.keys(axisHandles) as AxisName[]) {
    const handle = axisHandles[axis];
    handle.hidden = true;
    handle.addEventListener('pointerdown', handleAxisPointerDown(axis));
  }

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

  map.addEventListener('gmp-click', handleMapClick);
  container.addEventListener('pointerdown', handlePointerDown);
  container.addEventListener('contextmenu', handleContextMenu);
  container.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);

  applyCameraLock(map, fixedCameraState, cameraLocked);
  renderBoxes();
  syncCameraState();
  syncBoxes();

  return {
    clearEditingBox: () => {
      setEditingBox(null);
    },
    destroy: () => {
      for (const eventName of cameraEvents) {
        map.removeEventListener(eventName, handleCameraEvent);
      }

      map.removeEventListener('gmp-click', handleMapClick);
      container.removeEventListener('pointerdown', handlePointerDown);
      container.removeEventListener('contextmenu', handleContextMenu);
      container.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      container.replaceChildren();
    },
    getCameraState: () => readCameraState(map, fixedCameraState),
    getBoxes: () => cloneBoxesConfig(boxes),
    setBoxes: (nextBoxes: BoxConfig[]) => {
      boxes = cloneBoxesConfig(nextBoxes);
      renderBoxes();
      syncBoxes();
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
    setEditTool: (tool: EditTool) => {
      editTool = tool;
    },
    setEditingBox: (boxId: string | null) => {
      setEditingBox(boxId);
    },
  };
}
