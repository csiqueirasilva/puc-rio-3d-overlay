import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { TransformControlsEventMap } from 'three/examples/jsm/controls/TransformControls.js';
import type { CameraState, LatLngAltitude } from './cameraUrlState';
import {
  clampScaleValue,
  getCameraPositionFromState,
  getOffsetFromPosition,
  normalizeDegrees,
  translatePosition,
} from './boxMath';
import {
  cloneBoxConfig,
  cloneBoxesConfig,
  getBoxById,
  type BoxConfig,
} from './config';
import { editorStore, type TransformMode } from './editorStore';

const BOX_FILL_COLOR = 0x2563eb;
const BOX_FILL_OPACITY = 0.18;
const BOX_HOVER_COLOR = 0x7dd3fc;
const BOX_HOVER_OPACITY = 0.24;
const BOX_SELECTED_COLOR = 0xfacc15;
const BOX_SELECTED_OPACITY = 0.3;
const EDGE_COLOR = 0x60a5fa;
const EDGE_HOVER_COLOR = 0x7dd3fc;
const EDGE_SELECTED_COLOR = 0xfacc15;

interface BoxObjectMeta {
  boxId: string;
  edges: THREE.LineSegments;
  group: THREE.Group;
  mesh: THREE.Mesh;
}

export interface ThreeEditorOverlayController {
  destroy: () => void;
  setCameraState: (cameraState: CameraState) => void;
}

interface InitializeThreeEditorOverlayOptions {
  initialCameraState: CameraState;
  viewerElement: HTMLElement;
}

type TransformPointer = NonNullable<Parameters<TransformControls['pointerMove']>[0]>;

function createUnitBoxGeometry(): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 1);

  geometry.translate(0, 0, 0.5);
  return geometry;
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

function latLngAltitudeToVector3(
  anchor: LatLngAltitude,
  position: LatLngAltitude,
): THREE.Vector3 {
  const offset = getOffsetFromPosition(anchor, position);

  return new THREE.Vector3(offset.x, offset.y, offset.z);
}

function vector3ToLatLngAltitude(
  anchor: LatLngAltitude,
  vector: THREE.Vector3,
): LatLngAltitude {
  return translatePosition(anchor, vector.x, vector.y, vector.z);
}

function updateObjectMaterialStyles(
  meta: BoxObjectMeta,
  selectedBoxId: string | null,
  hoveredBoxId: string | null,
): void {
  const meshMaterial = meta.mesh.material as THREE.MeshBasicMaterial;
  const edgeMaterial = meta.edges.material as THREE.LineBasicMaterial;

  if (meta.boxId === selectedBoxId) {
    meshMaterial.color.setHex(BOX_SELECTED_COLOR);
    meshMaterial.opacity = BOX_SELECTED_OPACITY;
    edgeMaterial.color.setHex(EDGE_SELECTED_COLOR);
    edgeMaterial.opacity = 1;
    return;
  }

  if (!selectedBoxId && meta.boxId === hoveredBoxId) {
    meshMaterial.color.setHex(BOX_HOVER_COLOR);
    meshMaterial.opacity = BOX_HOVER_OPACITY;
    edgeMaterial.color.setHex(EDGE_HOVER_COLOR);
    edgeMaterial.opacity = 1;
    return;
  }

  meshMaterial.color.setHex(BOX_FILL_COLOR);
  meshMaterial.opacity = BOX_FILL_OPACITY;
  edgeMaterial.color.setHex(EDGE_COLOR);
  edgeMaterial.opacity = 0.95;
}

function didBoxTransformChange(leftBox: BoxConfig, rightBox: BoxConfig): boolean {
  return (
    leftBox.position.lat !== rightBox.position.lat ||
    leftBox.position.lng !== rightBox.position.lng ||
    leftBox.position.altitude !== rightBox.position.altitude ||
    leftBox.rotation.x !== rightBox.rotation.x ||
    leftBox.rotation.y !== rightBox.rotation.y ||
    leftBox.rotation.z !== rightBox.rotation.z ||
    leftBox.scale.x !== rightBox.scale.x ||
    leftBox.scale.y !== rightBox.scale.y ||
    leftBox.scale.z !== rightBox.scale.z
  );
}

export function initializeThreeEditorOverlay(
  container: HTMLElement,
  options: InitializeThreeEditorOverlayOptions,
): ThreeEditorOverlayController {
  const anchor = {
    ...options.initialCameraState.center,
  };
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
  });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    options.initialCameraState.fov,
    1,
    0.1,
    8000,
  );
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const boxObjects = new Map<string, BoxObjectMeta>();
  const sharedGeometry = createUnitBoxGeometry();
  const sharedEdgesGeometry = new THREE.EdgesGeometry(sharedGeometry);
  const transformControls = new TransformControls(camera);
  const transformHelper = transformControls.getHelper();

  let boxes = cloneBoxesConfig(editorStore.getState().boxes);
  let selectedBoxId = editorStore.getState().selectedSpaceId;
  let hoveredBoxId = editorStore.getState().hoveredSpaceId;
  let placementMode = editorStore.getState().placementMode;
  let positionStep = editorStore.getState().positionStep;
  let rotationStep = editorStore.getState().rotationStep;
  let scaleStep = editorStore.getState().scaleStep;
  let transformMode = editorStore.getState().transformMode;
  let transformSnapEnabled = editorStore.getState().transformSnapEnabled;
  let transformDragging = editorStore.getState().transformDragging;
  let cameraState = cloneCameraState(options.initialCameraState);
  let syncingFromStore = false;
  let activeTransformPointerId: number | null = null;
  let renderFrameId: number | null = null;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = 'threeOverlayCanvas';
  renderer.domElement.style.pointerEvents = 'none';
  container.replaceChildren();
  container.append(renderer.domElement);

  scene.add(transformHelper);

  const scheduleRender = (): void => {
    if (renderFrameId !== null) {
      return;
    }

    renderFrameId = window.requestAnimationFrame(() => {
      renderFrameId = null;
      renderer.render(scene, camera);
    });
  };

  const syncCamera = (): void => {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    const centerVector = latLngAltitudeToVector3(anchor, cameraState.center);
    const cameraVector = latLngAltitudeToVector3(
      anchor,
      getCameraPositionFromState(cameraState),
    );

    camera.aspect = width / height;
    camera.fov = cameraState.fov;
    camera.position.copy(cameraVector);
    camera.near = 0.1;
    camera.far = Math.max(3000, cameraState.range * 100);
    camera.up.set(0, 0, 1);
    camera.lookAt(centerVector);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  };

  const updateRendererSize = (): void => {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);

    renderer.setSize(width, height, false);
    syncCamera();
    scheduleRender();
  };

  const updatePointerFromEvent = (event: PointerEvent): boolean => {
    const bounds = container.getBoundingClientRect();

    if (bounds.width <= 0 || bounds.height <= 0) {
      return false;
    }

    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    return true;
  };

  const createTransformPointer = (
    event: PointerEvent,
  ): TransformPointer | null => {
    const bounds = container.getBoundingClientRect();

    if (bounds.width <= 0 || bounds.height <= 0) {
      return null;
    }

    return {
      button: event.button,
      x: ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      y: -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    } as unknown as TransformPointer;
  };

  const isSceneSurfaceEventTarget = (target: EventTarget | null): boolean =>
    target instanceof Node && container.contains(target);

  const pickBoxIdAtPointer = (): string | null => {
    const meshes = [...boxObjects.values()].map((meta) => meta.mesh);

    raycaster.setFromCamera(pointer, camera);

    const intersections = raycaster.intersectObjects(meshes, false);
    const hit = intersections.find((candidate: THREE.Intersection<THREE.Object3D>) => {
      const boxId = candidate.object.userData.boxId;
      return typeof boxId === 'string' && boxId.length > 0;
    });

    if (!hit) {
      return null;
    }

    return hit.object.userData.boxId as string;
  };

  const isTransformHandleHit = (): boolean => {
    raycaster.setFromCamera(pointer, camera);
    return (
      transformControls.getRaycaster().intersectObject(transformHelper, true)
        .length > 0
    );
  };

  const createBoxObject = (box: BoxConfig): BoxObjectMeta => {
    const material = new THREE.MeshBasicMaterial({
      color: BOX_FILL_COLOR,
      depthTest: false,
      depthWrite: false,
      opacity: BOX_FILL_OPACITY,
      transparent: true,
    });
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: EDGE_COLOR,
      depthTest: false,
      depthWrite: false,
      opacity: 0.95,
      transparent: true,
    });
    const mesh = new THREE.Mesh(sharedGeometry, material);
    const edges = new THREE.LineSegments(sharedEdgesGeometry, edgeMaterial);
    const group = new THREE.Group();

    group.userData.boxId = box.id;
    mesh.userData.boxId = box.id;
    edges.userData.boxId = box.id;
    group.rotation.order = 'XYZ';
    group.add(mesh);
    group.add(edges);
    scene.add(group);

    return {
      boxId: box.id,
      edges,
      group,
      mesh,
    };
  };

  const syncBoxObjectTransform = (box: BoxConfig, meta: BoxObjectMeta): void => {
    syncingFromStore = true;
    meta.group.position.copy(latLngAltitudeToVector3(anchor, box.position));
    meta.group.rotation.set(
      THREE.MathUtils.degToRad(box.rotation.x),
      THREE.MathUtils.degToRad(box.rotation.y),
      THREE.MathUtils.degToRad(box.rotation.z),
      'XYZ',
    );
    meta.group.scale.set(box.scale.x, box.scale.y, box.scale.z);
    syncingFromStore = false;
  };

  const syncObjects = (nextBoxes: BoxConfig[]): void => {
    const nextIds = new Set(nextBoxes.map((box) => box.id));

    for (const [boxId, meta] of boxObjects.entries()) {
      if (nextIds.has(boxId)) {
        continue;
      }

      if (transformControls.object === meta.group) {
        transformControls.detach();
      }

      scene.remove(meta.group);
      (meta.mesh.material as THREE.Material).dispose();
      (meta.edges.material as THREE.Material).dispose();
      boxObjects.delete(boxId);
    }

    for (const box of nextBoxes) {
      const meta = boxObjects.get(box.id) ?? createBoxObject(box);

      if (!boxObjects.has(box.id)) {
        boxObjects.set(box.id, meta);
      }

      syncBoxObjectTransform(box, meta);
    }

    boxes = cloneBoxesConfig(nextBoxes);
    scheduleRender();
  };

  const syncSelection = (): void => {
    const selectedMeta = selectedBoxId ? boxObjects.get(selectedBoxId) : undefined;

    if (selectedMeta && placementMode === 'idle') {
      transformControls.attach(selectedMeta.group);
      transformHelper.visible = true;
    } else {
      transformControls.detach();
      transformHelper.visible = false;
    }

    for (const meta of boxObjects.values()) {
      updateObjectMaterialStyles(meta, selectedBoxId, hoveredBoxId);
    }

    scheduleRender();
  };

  const syncTransformControlConfig = (): void => {
    transformControls.setMode(transformMode);
    transformControls.setSpace('local');
    transformControls.enabled = placementMode === 'idle';

    if (transformSnapEnabled) {
      transformControls.setTranslationSnap(
        transformMode === 'translate' ? positionStep : null,
      );
      transformControls.setRotationSnap(
        transformMode === 'rotate'
          ? THREE.MathUtils.degToRad(rotationStep)
          : null,
      );
      transformControls.setScaleSnap(
        transformMode === 'scale' ? scaleStep : null,
      );
    } else {
      transformControls.setTranslationSnap(null);
      transformControls.setRotationSnap(null);
      transformControls.setScaleSnap(null);
    }

    scheduleRender();
  };

  const handleTransformObjectChange = (): void => {
    if (syncingFromStore || !(transformControls.object instanceof THREE.Group)) {
      return;
    }

    const boxId = transformControls.object.userData.boxId;

    if (typeof boxId !== 'string') {
      return;
    }

    const currentBox = getBoxById(boxId, editorStore.getState().boxes);

    if (!currentBox) {
      return;
    }

    const nextScale = {
      x: clampScaleValue(Math.abs(transformControls.object.scale.x)),
      y: clampScaleValue(Math.abs(transformControls.object.scale.y)),
      z: clampScaleValue(Math.abs(transformControls.object.scale.z)),
    };

    transformControls.object.scale.set(nextScale.x, nextScale.y, nextScale.z);

    const nextBox = cloneBoxConfig(currentBox);

    nextBox.position = vector3ToLatLngAltitude(
      anchor,
      transformControls.object.position,
    );
    nextBox.rotation = {
      x: normalizeDegrees(
        THREE.MathUtils.radToDeg(transformControls.object.rotation.x),
      ),
      y: normalizeDegrees(
        THREE.MathUtils.radToDeg(transformControls.object.rotation.y),
      ),
      z: normalizeDegrees(
        THREE.MathUtils.radToDeg(transformControls.object.rotation.z),
      ),
    };
    nextBox.scale = nextScale;

    if (!didBoxTransformChange(currentBox, nextBox)) {
      return;
    }

    editorStore.getState().updateSpace(boxId, () => nextBox);
  };

  const finishTransformInteraction = (pointer: TransformPointer | null): void => {
    if (activeTransformPointerId === null && !transformControls.dragging) {
      return;
    }

    activeTransformPointerId = null;
    transformControls.pointerUp(pointer);
    scheduleRender();
  };

  const handleViewerPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || placementMode !== 'idle') {
      return;
    }

    if (!isSceneSurfaceEventTarget(event.target)) {
      return;
    }

    if (!updatePointerFromEvent(event)) {
      return;
    }

    const transformPointer = createTransformPointer(event);

    if (!transformPointer) {
      return;
    }

    transformControls.pointerHover(transformPointer);

    if (isTransformHandleHit() || transformControls.axis !== null) {
      activeTransformPointerId = event.pointerId;
      editorStore.getState().blockNextMapClick();
      transformControls.pointerDown(transformPointer);
      scheduleRender();
      return;
    }

    const hitBoxId = pickBoxIdAtPointer();

    if (!hitBoxId) {
      return;
    }

    editorStore.getState().blockNextMapClick();
    editorStore.getState().selectSpace(hitBoxId, 'scene');
  };

  const handleViewerPointerMove = (event: PointerEvent): void => {
    if (activeTransformPointerId !== null) {
      return;
    }

    if (!isSceneSurfaceEventTarget(event.target) || !updatePointerFromEvent(event)) {
      return;
    }

    const transformPointer = createTransformPointer(event);

    if (transformPointer) {
      transformControls.pointerHover(transformPointer);
    }

    const nextHoveredBoxId = pickBoxIdAtPointer();

    if (editorStore.getState().hoveredSpaceId === nextHoveredBoxId) {
      return;
    }

    editorStore.getState().setHoveredSpaceId(nextHoveredBoxId);
  };

  const handleGlobalPointerMove = (event: PointerEvent): void => {
    if (
      activeTransformPointerId === null ||
      event.pointerId !== activeTransformPointerId
    ) {
      return;
    }

    const transformPointer = createTransformPointer(event);

    if (!transformPointer) {
      return;
    }

    transformControls.pointerMove(transformPointer);
    scheduleRender();
  };

  const handleGlobalPointerUp = (event: PointerEvent): void => {
    if (
      activeTransformPointerId === null ||
      event.pointerId !== activeTransformPointerId
    ) {
      return;
    }

    finishTransformInteraction(createTransformPointer(event));
  };

  const handleGlobalPointerCancel = (event: PointerEvent): void => {
    if (
      activeTransformPointerId === null ||
      event.pointerId !== activeTransformPointerId
    ) {
      return;
    }

    finishTransformInteraction(createTransformPointer(event));
  };

  const handleVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      finishTransformInteraction(null);
    }
  };

  const handleWindowBlur = (): void => {
    finishTransformInteraction(null);
  };

  const handleWindowKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      finishTransformInteraction(null);
    }
  };

  const handleViewerPointerLeave = (): void => {
    if (activeTransformPointerId !== null || editorStore.getState().transformDragging) {
      return;
    }

    transformControls.axis = null;
    editorStore.getState().setHoveredSpaceId(null);
    scheduleRender();
  };

  transformControls.addEventListener('change', scheduleRender);
  transformControls.addEventListener('objectChange', handleTransformObjectChange);
  transformControls.addEventListener(
    'dragging-changed',
    (event: TransformControlsEventMap['dragging-changed']) => {
      const nextDragging = Boolean(event.value);

      transformDragging = nextDragging;
      editorStore.getState().setTransformDragging(nextDragging);
      scheduleRender();
    },
  );

  options.viewerElement.addEventListener('pointerdown', handleViewerPointerDown);
  options.viewerElement.addEventListener('pointermove', handleViewerPointerMove);
  options.viewerElement.addEventListener('pointerleave', handleViewerPointerLeave);
  window.addEventListener('pointermove', handleGlobalPointerMove);
  window.addEventListener('pointerup', handleGlobalPointerUp);
  window.addEventListener('pointercancel', handleGlobalPointerCancel);
  window.addEventListener('blur', handleWindowBlur);
  window.addEventListener('keydown', handleWindowKeyDown);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  const resizeObserver = new ResizeObserver(() => {
    updateRendererSize();
  });

  resizeObserver.observe(container);

  const unsubscribeBoxes = editorStore.subscribe(
    (state) => state.boxes,
    (nextBoxes) => {
      syncObjects(nextBoxes);
    },
  );
  const unsubscribeSelectedSpace = editorStore.subscribe(
    (state) => state.selectedSpaceId,
    (nextSelectedBoxId) => {
      selectedBoxId = nextSelectedBoxId;
      syncSelection();
    },
  );
  const unsubscribeHoveredSpace = editorStore.subscribe(
    (state) => state.hoveredSpaceId,
    (nextHoveredBoxId) => {
      hoveredBoxId = nextHoveredBoxId;
      syncSelection();
    },
  );
  const unsubscribePlacementMode = editorStore.subscribe(
    (state) => state.placementMode,
    (nextPlacementMode) => {
      placementMode = nextPlacementMode;
      syncSelection();
      syncTransformControlConfig();
    },
  );
  const unsubscribeTransformMode = editorStore.subscribe(
    (state) => state.transformMode,
    (nextTransformMode) => {
      transformMode = nextTransformMode;
      syncTransformControlConfig();
    },
  );
  const unsubscribeTransformSnapEnabled = editorStore.subscribe(
    (state) => state.transformSnapEnabled,
    (nextSnapEnabled) => {
      transformSnapEnabled = nextSnapEnabled;
      syncTransformControlConfig();
    },
  );
  const unsubscribePositionStep = editorStore.subscribe(
    (state) => state.positionStep,
    (nextPositionStep) => {
      positionStep = nextPositionStep;
      syncTransformControlConfig();
    },
  );
  const unsubscribeRotationStep = editorStore.subscribe(
    (state) => state.rotationStep,
    (nextRotationStep) => {
      rotationStep = nextRotationStep;
      syncTransformControlConfig();
    },
  );
  const unsubscribeScaleStep = editorStore.subscribe(
    (state) => state.scaleStep,
    (nextScaleStep) => {
      scaleStep = nextScaleStep;
      syncTransformControlConfig();
    },
  );

  syncObjects(boxes);
  syncCamera();
  syncSelection();
  syncTransformControlConfig();
  updateRendererSize();

  return {
    destroy: () => {
      if (renderFrameId !== null) {
        window.cancelAnimationFrame(renderFrameId);
      }

      unsubscribeBoxes();
      unsubscribeSelectedSpace();
      unsubscribeHoveredSpace();
      unsubscribePlacementMode();
      unsubscribeTransformMode();
      unsubscribeTransformSnapEnabled();
      unsubscribePositionStep();
      unsubscribeRotationStep();
      unsubscribeScaleStep();
      resizeObserver.disconnect();
      options.viewerElement.removeEventListener('pointerdown', handleViewerPointerDown);
      options.viewerElement.removeEventListener('pointermove', handleViewerPointerMove);
      options.viewerElement.removeEventListener('pointerleave', handleViewerPointerLeave);
      window.removeEventListener('pointermove', handleGlobalPointerMove);
      window.removeEventListener('pointerup', handleGlobalPointerUp);
      window.removeEventListener('pointercancel', handleGlobalPointerCancel);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('keydown', handleWindowKeyDown);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      transformControls.dispose();
      sharedEdgesGeometry.dispose();
      sharedGeometry.dispose();
      renderer.dispose();
      container.replaceChildren();
    },
    setCameraState: (nextCameraState: CameraState) => {
      cameraState = cloneCameraState(nextCameraState);
      syncCamera();
      scheduleRender();
    },
  };
}
