import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  buildNoCacheReloadUrl,
  buildUrlWithCameraState,
  buildUrlWithNoCache,
  getDefaultCameraState,
  parseCameraStateFromUrl,
  parseNoCacheFromUrl,
  type CameraState,
} from './cameraUrlState';
import {
  cloneBoxConfig,
  cloneBoxesConfig,
  createBoxId,
  createBoxName,
  getBoxById,
  type BoxConfig,
} from './config';
import {
  clampScaleValue,
  getCameraPositionFromState,
  getCameraStateFromCenterAndPosition,
  getBoxCentroid,
  getOffsetFromPosition,
  inverseRotateLocalPoint,
  normalizeDegrees,
  rotateLocalPoint,
  translatePosition,
} from './boxMath';
import {
  initializeGoogleMapsScene,
  type SceneController,
} from './googleMapsScene';
import { editorStore, useEditorStore } from './editorStore';

type SceneStatus = 'loading' | 'ready' | 'error';
type AxisName = 'x' | 'y' | 'z';

const MIN_FOCUS_RANGE = 22;
const MAX_FOCUS_RANGE = 70;
const FOCUS_RANGE_MULTIPLIER = 4.5;
const FOCUS_RANGE_DISTANCE_MULTIPLIER = 3;

interface LayoutSnapshot {
  boxes: BoxConfig[];
  cameraState: CameraState;
  exportedAt: string;
  version: 3;
}

interface FloatingEditorPosition {
  x: number;
  y: number;
}

type FloatingEditorMode = 'translate' | 'rotate' | 'scale';
type SimpleEditorMode = 'position' | 'size';

interface FloatingEditorDrafts {
  rotate: Record<AxisName, string>;
  scale: Record<AxisName, string>;
  translate: Record<AxisName, string>;
}

function isCameraState(value: unknown): value is CameraState {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const cameraState = value as Partial<CameraState>;
  return (
    !!cameraState.center &&
    typeof cameraState.center === 'object' &&
    typeof cameraState.center.lat === 'number' &&
    typeof cameraState.center.lng === 'number' &&
    typeof cameraState.center.altitude === 'number' &&
    typeof cameraState.heading === 'number' &&
    typeof cameraState.tilt === 'number' &&
    typeof cameraState.range === 'number' &&
    typeof cameraState.fov === 'number'
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function parseBoxConfigArray(value: unknown): BoxConfig[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const parsedBoxes: BoxConfig[] = [];

  for (const candidate of value) {
    if (!isPlainObject(candidate)) {
      return null;
    }

    const position = candidate.position;
    const scale = candidate.scale;
    const rotation = candidate.rotation;

    if (
      typeof candidate.id !== 'string' ||
      !isPlainObject(position) ||
      typeof position.lat !== 'number' ||
      typeof position.lng !== 'number' ||
      typeof position.altitude !== 'number' ||
      !isPlainObject(scale) ||
      typeof scale.x !== 'number' ||
      typeof scale.y !== 'number' ||
      typeof scale.z !== 'number'
    ) {
      return null;
    }

    parsedBoxes.push({
      id: candidate.id,
      name:
        typeof candidate.name === 'string' && candidate.name.trim()
          ? candidate.name.trim()
          : candidate.id,
      position: {
        altitude: position.altitude,
        lat: position.lat,
        lng: position.lng,
      },
      rotation:
        isPlainObject(rotation) &&
        typeof rotation.x === 'number' &&
        typeof rotation.y === 'number' &&
        typeof rotation.z === 'number'
          ? {
              x: rotation.x,
              y: rotation.y,
              z: rotation.z,
            }
          : {
              x: 0,
              y: 0,
              z: 0,
            },
      scale: {
        x: clampScaleValue(scale.x),
        y: clampScaleValue(scale.y),
        z: clampScaleValue(scale.z),
      },
    });
  }

  return parsedBoxes;
}

function formatStepValue(value: number, unit: string): string {
  return `${value.toFixed(value < 1 ? 2 : 1)} ${unit}`;
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

function getSuggestedFocusRange(box: BoxConfig, currentRange: number): number {
  const largestDimension = Math.max(box.scale.x, box.scale.y, box.scale.z);
  const targetRange = Math.min(
    MAX_FOCUS_RANGE * FOCUS_RANGE_DISTANCE_MULTIPLIER,
    Math.max(
      MIN_FOCUS_RANGE * FOCUS_RANGE_DISTANCE_MULTIPLIER,
      largestDimension *
        FOCUS_RANGE_MULTIPLIER *
        FOCUS_RANGE_DISTANCE_MULTIPLIER,
    ),
  );

  return Math.min(currentRange, targetRange);
}

const FLOATING_EDITOR_WIDTH = 392;
const FLOATING_EDITOR_HEIGHT = 420;
const FLOATING_EDITOR_MARGIN = 14;

function createFloatingEditorDrafts(box: BoxConfig): FloatingEditorDrafts {
  return {
    rotate: {
      x: box.rotation.x.toFixed(2),
      y: box.rotation.y.toFixed(2),
      z: box.rotation.z.toFixed(2),
    },
    scale: {
      x: box.scale.x.toFixed(2),
      y: box.scale.y.toFixed(2),
      z: box.scale.z.toFixed(2),
    },
    translate: {
      x: box.position.lng.toFixed(7),
      y: box.position.lat.toFixed(7),
      z: box.position.altitude.toFixed(2),
    },
  };
}

function getBoxFieldValue(
  box: BoxConfig,
  mode: FloatingEditorMode,
  axis: AxisName,
): number {
  if (mode === 'translate') {
    if (axis === 'x') {
      return box.position.lng;
    }

    if (axis === 'y') {
      return box.position.lat;
    }

    return box.position.altitude;
  }

  if (mode === 'rotate') {
    return box.rotation[axis];
  }

  return box.scale[axis];
}

function formatBoxFieldValue(
  box: BoxConfig,
  mode: FloatingEditorMode,
  axis: AxisName,
): string {
  const value = getBoxFieldValue(box, mode, axis);

  if (mode === 'translate' && axis !== 'z') {
    return value.toFixed(7);
  }

  return value.toFixed(2);
}

function getTransformStepValue(
  mode: FloatingEditorMode,
  positionStep: number,
  rotationStep: number,
  scaleStep: number,
): number {
  if (mode === 'translate') {
    return positionStep;
  }

  if (mode === 'rotate') {
    return rotationStep;
  }

  return scaleStep;
}

function formatTransformStepDraft(
  mode: FloatingEditorMode,
  positionStep: number,
  rotationStep: number,
  scaleStep: number,
): string {
  const value = getTransformStepValue(mode, positionStep, rotationStep, scaleStep);
  return value.toFixed(mode === 'rotate' ? 1 : 2);
}

function clampTransformStep(mode: FloatingEditorMode, value: number): number {
  if (mode === 'rotate') {
    return Math.min(45, Math.max(0.5, value));
  }

  return Math.min(10, Math.max(0.05, value));
}

function getTransformStepAdjustment(mode: FloatingEditorMode): number {
  return mode === 'rotate' ? 0.5 : 0.05;
}

function getQuickStepMode(
  isAdvancedEditor: boolean,
  transformMode: FloatingEditorMode,
  simpleEditorMode: SimpleEditorMode,
): FloatingEditorMode {
  if (isAdvancedEditor) {
    return transformMode;
  }

  return simpleEditorMode === 'position' ? 'translate' : 'scale';
}

export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const floatingEditorRef = useRef<HTMLDivElement | null>(null);
  const lastViewerPrimaryPointerRef = useRef<{
    timestamp: number;
    x: number;
    y: number;
  } | null>(null);
  const previousSelectedBoxIdRef = useRef<string | null>(null);
  const viewerShellRef = useRef<HTMLElement | null>(null);
  const sceneRef = useRef<SceneController | null>(null);
  const startupCameraState = parseCameraStateFromUrl() ?? getDefaultCameraState();
  const [defaultCameraState, setDefaultCameraState] =
    useState<CameraState>(startupCameraState);
  const [sceneStatus, setSceneStatus] = useState<SceneStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [interactionHint, setInteractionHint] = useState('');
  const [hoverTooltipPosition, setHoverTooltipPosition] = useState({
    x: 18,
    y: 18,
  });
  const [floatingEditorPosition, setFloatingEditorPosition] =
    useState<FloatingEditorPosition | null>(null);
  const [floatingEditorDrafts, setFloatingEditorDrafts] =
    useState<FloatingEditorDrafts | null>(null);
  const [floatingNameDraft, setFloatingNameDraft] = useState('');
  const [isFloatingNameEditing, setIsFloatingNameEditing] = useState(false);
  const [quickStepDraft, setQuickStepDraft] = useState('');
  const [isQuickStepEditing, setIsQuickStepEditing] = useState(false);
  const [isAdvancedEditor, setIsAdvancedEditor] = useState(false);
  const [simpleEditorMode, setSimpleEditorMode] =
    useState<SimpleEditorMode>('position');
  const boxes = useEditorStore((state) => state.boxes);
  const cameraLocked = useEditorStore((state) => state.cameraLocked);
  const contextMenuState = useEditorStore((state) => state.contextMenu);
  const followCameraWithBox = useEditorStore(
    (state) => state.followCameraWithSpace,
  );
  const hoveredBoxId = useEditorStore((state) => state.hoveredSpaceId);
  const isBoxPlacementArmed =
    useEditorStore((state) => state.placementMode) === 'placing-space';
  const noCache = useEditorStore((state) => state.noCache);
  const pendingFocusBoxId = useEditorStore((state) => state.focusRequestSpaceId);
  const positionStep = useEditorStore((state) => state.positionStep);
  const rotationStep = useEditorStore((state) => state.rotationStep);
  const scaleStep = useEditorStore((state) => state.scaleStep);
  const selectedBoxId = useEditorStore((state) => state.selectedSpaceId);
  const transformMode = useEditorStore((state) => state.transformMode);
  const clearFocusRequest = useEditorStore((state) => state.clearFocusRequest);
  const closeContextMenu = useEditorStore((state) => state.closeContextMenu);
  const addSpace = useEditorStore((state) => state.addSpace);
  const removeSpace = useEditorStore((state) => state.removeSpace);
  const selectSpace = useEditorStore((state) => state.selectSpace);
  const setBoxes = useEditorStore((state) => state.setBoxes);
  const setCameraLocked = useEditorStore((state) => state.setCameraLocked);
  const setFollowCameraWithBox = useEditorStore(
    (state) => state.setFollowCameraWithSpace,
  );
  const setHoveredBoxId = useEditorStore((state) => state.setHoveredSpaceId);
  const setNoCache = useEditorStore((state) => state.setNoCache);
  const setPositionStep = useEditorStore((state) => state.setPositionStep);
  const setRotationStep = useEditorStore((state) => state.setRotationStep);
  const setScaleStep = useEditorStore((state) => state.setScaleStep);
  const setTransformMode = useEditorStore((state) => state.setTransformMode);
  const updateSpace = useEditorStore((state) => state.updateSpace);
  const armPlacementMode = useEditorStore((state) => state.armPlacementMode);
  const openContextMenu = useEditorStore((state) => state.openContextMenu);
  const cameraStateRef = useRef(defaultCameraState);
  const hintTimeoutRef = useRef<number | null>(null);
  const cameraUrlFrameRef = useRef<number | null>(null);

  const selectedBox = selectedBoxId ? getBoxById(selectedBoxId, boxes) : undefined;
  const hoveredBox = hoveredBoxId ? getBoxById(hoveredBoxId, boxes) : undefined;
  const contextMenuTargetBox = contextMenuState?.targetSpaceId
    ? getBoxById(contextMenuState.targetSpaceId, boxes)
    : undefined;
  const sortedBoxes = [...boxes].sort((leftBox, rightBox) =>
    leftBox.name.localeCompare(rightBox.name, 'pt-BR', {
      sensitivity: 'base',
    }),
  );
  const quickStepMode = getQuickStepMode(
    isAdvancedEditor,
    transformMode,
    simpleEditorMode,
  );

  const syncUrl = (
    cameraState: CameraState = cameraStateRef.current,
    nextNoCache: boolean = editorStore.getState().noCache,
  ): void => {
    let nextUrl = buildUrlWithCameraState(cameraState);
    nextUrl = buildUrlWithNoCache(nextNoCache, nextUrl);
    window.history.replaceState(window.history.state, '', nextUrl);
  };

  useEffect(() => {
    syncUrl(defaultCameraState, noCache);

    return () => {
      if (cameraUrlFrameRef.current !== null) {
        window.cancelAnimationFrame(cameraUrlFrameRef.current);
      }

      if (hintTimeoutRef.current !== null) {
        window.clearTimeout(hintTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const viewerElement = viewerShellRef.current;

    if (!container || !viewerElement) {
      return;
    }

    let active = true;
    let controller: SceneController | null = null;

    const loadScene = async () => {
      try {
        setSceneStatus('loading');
        setErrorMessage('');

        controller = await initializeGoogleMapsScene(container, {
          initialCameraState: defaultCameraState,
          onCameraStateChange: (cameraState) => {
            cameraStateRef.current = cameraState;

            if (cameraUrlFrameRef.current !== null) {
              window.cancelAnimationFrame(cameraUrlFrameRef.current);
            }

            cameraUrlFrameRef.current = window.requestAnimationFrame(() => {
              syncUrl(cameraStateRef.current, editorStore.getState().noCache);
              cameraUrlFrameRef.current = null;
            });
          },
        });

        if (!active) {
          controller.destroy();
          return;
        }

        sceneRef.current = controller;
        setSceneStatus('ready');
      } catch (error) {
        controller?.destroy();

        if (!active) {
          return;
        }

        setSceneStatus('error');
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Falha ao inicializar o mapa 3D do Google.',
        );
      }
    };

    void loadScene();

    return () => {
      active = false;
      controller?.destroy();

      if (sceneRef.current === controller) {
        sceneRef.current = null;
      }
    };
  }, []);

  const placeFloatingEditor = (x: number, y: number): void => {
    const viewerElement = viewerShellRef.current;

    if (!viewerElement) {
      return;
    }

    const bounds = viewerElement.getBoundingClientRect();

    setFloatingEditorPosition({
      x: Math.min(
        Math.max(x + 12, FLOATING_EDITOR_MARGIN),
        Math.max(
          FLOATING_EDITOR_MARGIN,
          bounds.width - FLOATING_EDITOR_WIDTH - FLOATING_EDITOR_MARGIN,
        ),
      ),
      y: Math.min(
        Math.max(y + 12, FLOATING_EDITOR_MARGIN),
        Math.max(
          FLOATING_EDITOR_MARGIN,
          bounds.height - FLOATING_EDITOR_HEIGHT - FLOATING_EDITOR_MARGIN,
        ),
      ),
    });
  };

  useEffect(() => {
    if (!selectedBox) {
      setFloatingEditorDrafts(null);
      setFloatingNameDraft('');
      setIsFloatingNameEditing(false);
      setQuickStepDraft('');
      setIsQuickStepEditing(false);
      return;
    }

    setFloatingEditorDrafts(createFloatingEditorDrafts(selectedBox));
    if (!isFloatingNameEditing) {
      setFloatingNameDraft(selectedBox.name);
    }
  }, [isFloatingNameEditing, selectedBox]);

  useEffect(() => {
    if (!selectedBox || isQuickStepEditing) {
      return;
    }

    setQuickStepDraft(
      formatTransformStepDraft(
        quickStepMode,
        positionStep,
        rotationStep,
        scaleStep,
      ),
    );
  }, [
    isQuickStepEditing,
    positionStep,
    quickStepMode,
    rotationStep,
    scaleStep,
    selectedBox,
  ]);

  useEffect(() => {
    const previousSelectedBoxId = previousSelectedBoxIdRef.current;
    previousSelectedBoxIdRef.current = selectedBoxId;

    if (!selectedBoxId) {
      setFloatingEditorPosition(null);
      return;
    }

    if (previousSelectedBoxId === selectedBoxId) {
      return;
    }

    const lastPointer = lastViewerPrimaryPointerRef.current;

    if (lastPointer && Date.now() - lastPointer.timestamp < 1200) {
      placeFloatingEditor(lastPointer.x, lastPointer.y);
      return;
    }

    const viewerElement = viewerShellRef.current;

    if (!viewerElement) {
      setFloatingEditorPosition(null);
      return;
    }

    const bounds = viewerElement.getBoundingClientRect();

    setFloatingEditorPosition({
      x: Math.max(
        FLOATING_EDITOR_MARGIN,
        bounds.width - FLOATING_EDITOR_WIDTH - FLOATING_EDITOR_MARGIN,
      ),
      y: FLOATING_EDITOR_MARGIN,
    });
  }, [selectedBoxId]);

  useEffect(() => {
    if (!selectedBoxId || sceneStatus !== 'ready') {
      return;
    }

    if (pendingFocusBoxId !== selectedBoxId) {
      return;
    }

    const selectedBoxFromState = getBoxById(selectedBoxId, boxes);

    if (!selectedBoxFromState) {
      clearFocusRequest();
      return;
    }

    const nextCameraState: CameraState = {
      ...(sceneRef.current?.getCameraState() ?? cameraStateRef.current),
      center: getBoxCentroid(selectedBoxFromState),
      range: getSuggestedFocusRange(
        selectedBoxFromState,
        (sceneRef.current?.getCameraState() ?? cameraStateRef.current).range,
      ),
    };

    clearFocusRequest();
    cameraStateRef.current = nextCameraState;
    setDefaultCameraState(nextCameraState);
    sceneRef.current?.setCameraState(nextCameraState);
    syncUrl(nextCameraState, editorStore.getState().noCache);
  }, [boxes, clearFocusRequest, pendingFocusBoxId, sceneStatus, selectedBoxId]);

  useEffect(() => {
    syncUrl(cameraStateRef.current, noCache);
  }, [noCache]);

  useEffect(() => {
    sceneRef.current?.setCameraState(defaultCameraState);
  }, [defaultCameraState]);

  const showHint = (message: string): void => {
    setInteractionHint(message);

    if (hintTimeoutRef.current !== null) {
      window.clearTimeout(hintTimeoutRef.current);
    }

    hintTimeoutRef.current = window.setTimeout(() => {
      setInteractionHint('');
      hintTimeoutRef.current = null;
    }, 1800);
  };

  const syncTrackedCameraForBoxChange = (
    previousBox: BoxConfig,
    nextBox: BoxConfig,
  ): void => {
    const currentCameraState = sceneRef.current?.getCameraState() ?? cameraStateRef.current;
    const previousBoxCenter = getBoxCentroid(previousBox);
    const nextBoxCenter = getBoxCentroid(nextBox);
    const currentCameraPosition = getCameraPositionFromState(currentCameraState);
    const centerOffsetLocal = inverseRotateLocalPoint(
      getOffsetFromPosition(previousBoxCenter, currentCameraState.center),
      previousBox.rotation,
    );
    const cameraOffsetLocal = inverseRotateLocalPoint(
      getOffsetFromPosition(previousBoxCenter, currentCameraPosition),
      previousBox.rotation,
    );
    const nextCenterOffset = rotateLocalPoint(centerOffsetLocal, nextBox.rotation);
    const nextCameraOffset = rotateLocalPoint(cameraOffsetLocal, nextBox.rotation);
    const nextCameraCenter = translatePosition(
      nextBoxCenter,
      nextCenterOffset.x,
      nextCenterOffset.y,
      nextCenterOffset.z,
    );
    const nextCameraPosition = translatePosition(
      nextBoxCenter,
      nextCameraOffset.x,
      nextCameraOffset.y,
      nextCameraOffset.z,
    );
    const nextCameraState = getCameraStateFromCenterAndPosition(
      nextCameraCenter,
      nextCameraPosition,
      currentCameraState,
    );

    cameraStateRef.current = nextCameraState;
    setDefaultCameraState(nextCameraState);
    sceneRef.current?.setCameraState(nextCameraState);
    syncUrl(nextCameraState, editorStore.getState().noCache);
  };

  useEffect(() => {
    return editorStore.subscribe(
      (state) => {
        const selectedSpaceId = state.selectedSpaceId;

        if (!selectedSpaceId) {
          return null;
        }

        const selectedSpace = getBoxById(selectedSpaceId, state.boxes);

        return selectedSpace ? cloneBoxConfig(selectedSpace) : null;
      },
      (nextSelectedBox, previousSelectedBox) => {
        if (
          !nextSelectedBox ||
          !previousSelectedBox ||
          nextSelectedBox.id !== previousSelectedBox.id
        ) {
          return;
        }

        if (!editorStore.getState().followCameraWithSpace) {
          return;
        }

        if (!didBoxTransformChange(previousSelectedBox, nextSelectedBox)) {
          return;
        }

        syncTrackedCameraForBoxChange(previousSelectedBox, nextSelectedBox);
      },
    );
  }, []);

  const updateSelectedBox = (updater: (box: BoxConfig) => BoxConfig): void => {
    if (!selectedBoxId || !selectedBox) {
      return;
    }

    const nextBox = updater(cloneBoxConfig(selectedBox));
    updateSpace(selectedBoxId, () => nextBox);
  };

  const adjustSelectedPosition = (
    axis: AxisName,
    direction: -1 | 1,
  ): void => {
    const delta = positionStep * direction;

    updateSelectedBox((box) => {
      const localOffset = rotateLocalPoint(
        {
          x: axis === 'x' ? delta : 0,
          y: axis === 'y' ? delta : 0,
          z: axis === 'z' ? delta : 0,
        },
        box.rotation,
      );

      box.position = translatePosition(
        box.position,
        localOffset.x,
        localOffset.y,
        localOffset.z,
      );

      return box;
    });
  };

  const handleFloatingTransformAction = (
    axis: AxisName,
    direction: -1 | 1,
  ): void => {
    if (transformMode === 'translate') {
      adjustSelectedPosition(axis, direction);
      return;
    }

    if (transformMode === 'rotate') {
      adjustSelectedRotation(axis, direction);
      return;
    }

    adjustSelectedScale(axis, direction);
  };

  const handleFloatingDraftChange = (
    mode: FloatingEditorMode,
    axis: AxisName,
    rawValue: string,
  ): void => {
    setFloatingEditorDrafts((currentDrafts) => {
      if (!currentDrafts) {
        return currentDrafts;
      }

      return {
        ...currentDrafts,
        [mode]: {
          ...currentDrafts[mode],
          [axis]: rawValue,
        },
      };
    });
  };

  const resetFloatingDraft = (
    mode: FloatingEditorMode,
    axis: AxisName,
  ): void => {
    if (!selectedBox) {
      return;
    }

    setFloatingEditorDrafts((currentDrafts) => {
      if (!currentDrafts) {
        return currentDrafts;
      }

      return {
        ...currentDrafts,
        [mode]: {
          ...currentDrafts[mode],
          [axis]: formatBoxFieldValue(selectedBox, mode, axis),
        },
      };
    });
  };

  const commitFloatingDraft = (
    mode: FloatingEditorMode,
    axis: AxisName,
  ): void => {
    if (!selectedBox || !floatingEditorDrafts) {
      return;
    }

    const rawValue = floatingEditorDrafts[mode][axis].trim();
    const nextValue = Number(rawValue);

    if (!Number.isFinite(nextValue)) {
      resetFloatingDraft(mode, axis);
      return;
    }

    if (mode === 'translate') {
      updateSelectedBox((box) => {
        if (axis === 'x') {
          box.position.lng = nextValue;
        } else if (axis === 'y') {
          box.position.lat = nextValue;
        } else {
          box.position.altitude = nextValue;
        }

        return box;
      });
      return;
    }

    if (mode === 'rotate') {
      updateSelectedBox((box) => {
        box.rotation = {
          ...box.rotation,
          [axis]: normalizeDegrees(nextValue),
        };
        return box;
      });
      return;
    }

    updateSelectedBox((box) => {
      box.scale = {
        ...box.scale,
        [axis]: clampScaleValue(nextValue),
      };
      return box;
    });
  };

  const adjustSelectedRotation = (
    axis: AxisName,
    direction: -1 | 1,
  ): void => {
    updateSelectedBox((box) => {
      box.rotation = {
        ...box.rotation,
        [axis]: normalizeDegrees(box.rotation[axis] + rotationStep * direction),
      };
      return box;
    });
  };

  const adjustSelectedScale = (
    axis: AxisName,
    direction: -1 | 1,
  ): void => {
    updateSelectedBox((box) => {
      box.scale = {
        ...box.scale,
        [axis]: clampScaleValue(box.scale[axis] + scaleStep * direction),
      };
      return box;
    });
  };

  const cancelFloatingNameEdit = (): void => {
    setIsFloatingNameEditing(false);

    if (selectedBox) {
      setFloatingNameDraft(selectedBox.name);
    }
  };

  const commitFloatingNameEdit = (): void => {
    if (!selectedBox) {
      return;
    }

    const nextName = floatingNameDraft.trim();

    if (!nextName) {
      cancelFloatingNameEdit();
      return;
    }

    updateSelectedBox((box) => {
      box.name = nextName;
      return box;
    });
    setIsFloatingNameEditing(false);
  };

  const applyTransformStepValue = (
    mode: FloatingEditorMode,
    value: number,
  ): void => {
    const nextValue = clampTransformStep(mode, value);

    if (mode === 'translate') {
      setPositionStep(nextValue);
      return;
    }

    if (mode === 'rotate') {
      setRotationStep(nextValue);
      return;
    }

    setScaleStep(nextValue);
  };

  const adjustQuickStep = (direction: -1 | 1): void => {
    applyTransformStepValue(
      quickStepMode,
      getTransformStepValue(quickStepMode, positionStep, rotationStep, scaleStep) +
        getTransformStepAdjustment(quickStepMode) * direction,
    );
  };

  const cancelQuickStepEdit = (): void => {
    setIsQuickStepEditing(false);
    setQuickStepDraft(
      formatTransformStepDraft(
        quickStepMode,
        positionStep,
        rotationStep,
        scaleStep,
      ),
    );
  };

  const commitQuickStepEdit = (): void => {
    const nextValue = Number(quickStepDraft.trim());

    if (!Number.isFinite(nextValue)) {
      cancelQuickStepEdit();
      return;
    }

    applyTransformStepValue(quickStepMode, nextValue);
    setIsQuickStepEditing(false);
  };

  const handleDeleteSelectedBox = (): void => {
    if (!selectedBoxId) {
      return;
    }

    removeSpace(selectedBoxId);
  };

  const handleOpenContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
  ): void => {
    event.preventDefault();

    const viewerElement = viewerShellRef.current;

    if (!viewerElement) {
      return;
    }

    const bounds = viewerElement.getBoundingClientRect();

    openContextMenu({
      targetSpaceId: selectedBoxId ?? hoveredBoxId,
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
  };

  const handleArmBoxPlacement = (): void => {
    armPlacementMode();
    showHint('Clique esquerdo no mapa para posicionar o novo espaço.');
  };

  const handleRemoveContextTargetBox = (): void => {
    const targetBoxId = contextMenuState?.targetSpaceId;

    if (!targetBoxId) {
      return;
    }

    removeSpace(targetBoxId);
    closeContextMenu();
  };

  const handleDuplicateContextTargetBox = (): void => {
    const targetBoxId = contextMenuState?.targetSpaceId;

    if (!targetBoxId) {
      return;
    }

    const targetBox = getBoxById(targetBoxId, boxes);

    if (!targetBox) {
      return;
    }

    const nextBox = cloneBoxConfig(targetBox);
    const localOffset = rotateLocalPoint(
      {
        x: Math.max(positionStep, 0.5),
        y: 0,
        z: 0,
      },
      targetBox.rotation,
    );

    nextBox.id = createBoxId();
    nextBox.name = createBoxName(boxes);
    nextBox.position = translatePosition(
      targetBox.position,
      localOffset.x,
      localOffset.y,
      localOffset.z,
    );

    addSpace(nextBox);
    selectSpace(nextBox.id, 'system');
    closeContextMenu();
  };

  const handleExportLayout = (): void => {
    const snapshot: LayoutSnapshot = {
      boxes: sceneRef.current?.getBoxes() ?? cloneBoxesConfig(boxes),
      cameraState: sceneRef.current?.getCameraState() ?? cameraStateRef.current,
      exportedAt: new Date().toISOString(),
      version: 3,
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'puc-rio-3d-overlay-boxes.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportLayout = async (
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await file.text()) as Partial<LayoutSnapshot>;
      const nextBoxes = parseBoxConfigArray(parsed.boxes);

      if (!nextBoxes) {
        throw new Error('Arquivo sem lista válida de espaços.');
      }

      setBoxes(cloneBoxesConfig(nextBoxes));
      selectSpace(null, 'system');
      setHoveredBoxId(null);
      closeContextMenu();

      if (isCameraState(parsed.cameraState)) {
        setDefaultCameraState(parsed.cameraState);
        cameraStateRef.current = parsed.cameraState;
        sceneRef.current?.setCameraState(parsed.cameraState);
        syncUrl(parsed.cameraState, editorStore.getState().noCache);
      }

      setSceneStatus('ready');
      setErrorMessage('');
    } catch (error) {
      setSceneStatus('error');
      setErrorMessage(
        error instanceof Error ? error.message : 'Falha ao importar o layout.',
      );
    } finally {
      event.target.value = '';
    }
  };

  const handleViewerPointerMove = (
    event: ReactPointerEvent<HTMLElement>,
  ): void => {
    const viewerElement = viewerShellRef.current;

    if (!viewerElement) {
      return;
    }

    const bounds = viewerElement.getBoundingClientRect();

    setHoverTooltipPosition({
      x: event.clientX - bounds.left + 14,
      y: event.clientY - bounds.top + 14,
    });
  };

  const renderFloatingAxisRow = (
    label: string,
    value: string,
    onAdjust: (direction: -1 | 1) => void,
    onChange: (rawValue: string) => void,
    onCommit: () => void,
    onReset: () => void,
  ) => (
    <div className="floatingAxisRow" key={label}>
      <span>{label}</span>
      <button aria-label={`${label} negativo`} onClick={() => onAdjust(-1)} type="button">
        -
      </button>
      <input
        inputMode="decimal"
        onBlur={onReset}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            onCommit();
          }

          if (event.key === 'Escape') {
            onReset();
          }
        }}
        type="text"
        value={value}
      />
      <button aria-label={`${label} positivo`} onClick={() => onAdjust(1)} type="button">
        +
      </button>
    </div>
  );

  const quickStepValue = getTransformStepValue(
    quickStepMode,
    positionStep,
    rotationStep,
    scaleStep,
  );
  const quickStepUnit = quickStepMode === 'rotate' ? 'deg' : 'm';
  const selectedArea = selectedBox
    ? (selectedBox.scale.x * selectedBox.scale.y).toFixed(2)
    : '0.00';
  return (
    <div className="layout">
      <aside className="panel">
        <h1>PUC-Rio 3D Overlay</h1>
        <p className="muted">
          Use <strong>clique direito</strong> no mapa para abrir o menu de
          contexto e escolher <strong>Adicionar espaço</strong>. Depois, use{' '}
          <strong>clique esquerdo</strong> para posicionar o espaço. Quando um
          espaço estiver selecionado pelo mapa, abre um menu flutuante perto do
          clique para editar. No modo básico, o editor mostra só{' '}
          <strong>Posição</strong> e <strong>Tamanho</strong>; no modo{' '}
          <strong>Avançado</strong>, ele separa translação, rotação e escala.
        </p>

        <div className="section">
          <label className="row">
            <input
              checked={cameraLocked}
              onChange={(event) => setCameraLocked(event.target.checked)}
              type="checkbox"
            />
            Travar câmera no default
          </label>
          <label className="row">
            <input
              checked={noCache}
              onChange={(event) => setNoCache(event.target.checked)}
              type="checkbox"
            />
            No cache no próximo reload
          </label>
        </div>

        <div className="section actionGrid">
          <button onClick={handleExportLayout} type="button">
            Exportar espaços
          </button>
          <button onClick={() => fileInputRef.current?.click()} type="button">
            Importar espaços
          </button>
          <button
            onClick={() =>
              window.location.assign(
                buildNoCacheReloadUrl(noCache, window.location.href),
              )
            }
            type="button"
          >
            Recarregar
          </button>
          <button
            disabled={!selectedBox}
            onClick={handleDeleteSelectedBox}
            type="button"
          >
            Remover espaço selecionado
          </button>
        </div>

        <input
          accept="application/json"
          className="hiddenInput"
          onChange={(event) => {
            void handleImportLayout(event);
          }}
          ref={fileInputRef}
          type="file"
        />

        <div className="section">
          <label htmlFor="boxSelect">Espaço selecionado</label>
          <div className="inlineActions">
            <select
              id="boxSelect"
              onChange={(event) => {
                const nextBoxId = event.target.value ? event.target.value : null;
                selectSpace(nextBoxId, 'sidebar');
              }}
              value={selectedBoxId ?? ''}
            >
              <option value="">Nenhuma</option>
              {sortedBoxes.map((box) => (
                <option key={box.id} value={box.id}>
                  {box.name}
                </option>
              ))}
            </select>
            <button
              disabled={!selectedBoxId}
              onClick={() => selectSpace(null, 'system')}
              type="button"
            >
              Limpar
            </button>
          </div>
        </div>

        {sceneStatus !== 'ready' ? (
          <div className={`section statusCard ${sceneStatus}`}>
            <strong>
              {sceneStatus === 'loading'
                ? 'Inicializando Google Maps 3D'
                : 'Erro ao carregar o mapa'}
            </strong>
            <p>
              {sceneStatus === 'loading'
                ? 'Carregando mapa 3D e editor de espaços.'
                : errorMessage}
            </p>
          </div>
        ) : null}
      </aside>

      <main
        className="viewerShell"
        onContextMenu={handleOpenContextMenu}
        onPointerDownCapture={(event) => {
          const target = event.target;

          if (
            target instanceof HTMLElement &&
            (contextMenuRef.current?.contains(target) ||
              floatingEditorRef.current?.contains(target))
          ) {
            return;
          }

          if (event.button === 0) {
            const viewerElement = viewerShellRef.current;

            if (viewerElement) {
              const bounds = viewerElement.getBoundingClientRect();
              lastViewerPrimaryPointerRef.current = {
                timestamp: Date.now(),
                x: event.clientX - bounds.left,
                y: event.clientY - bounds.top,
              };
            }

            closeContextMenu();
          }
        }}
        onPointerMove={handleViewerPointerMove}
        onPointerLeave={() => setHoveredBoxId(null)}
        onWheelCapture={(event) => {
          if (!event.ctrlKey) {
            showHint('Use Ctrl + scroll para zoom no mapa 3D.');
          }
        }}
        ref={viewerShellRef}
      >
        {interactionHint ? <div className="hintBubble">{interactionHint}</div> : null}
        {isBoxPlacementArmed ? (
          <div className="placementBadge">Adicionar espaço: clique no mapa</div>
        ) : null}
        {!selectedBox && hoveredBox ? (
          <div
            className="hoverTooltip"
            style={{
              left: `${hoverTooltipPosition.x}px`,
              top: `${hoverTooltipPosition.y}px`,
            }}
          >
            {hoveredBox.name}
          </div>
        ) : null}
        {selectedBox && floatingEditorPosition && floatingEditorDrafts ? (
          <div
            className="floatingEditor"
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            ref={floatingEditorRef}
            style={{
              left: `${floatingEditorPosition.x}px`,
              top: `${floatingEditorPosition.y}px`,
            }}
          >
            <div className="floatingEditorHeader">
              <div className="floatingEditorName">
                {isFloatingNameEditing ? (
                  <input
                    autoFocus
                    onBlur={cancelFloatingNameEdit}
                    onChange={(event) => setFloatingNameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        commitFloatingNameEdit();
                      }

                      if (event.key === 'Escape') {
                        cancelFloatingNameEdit();
                      }
                    }}
                    type="text"
                    value={floatingNameDraft}
                  />
                ) : (
                  <button
                    className="floatingNameButton"
                    onClick={() => setIsFloatingNameEditing(true)}
                    type="button"
                  >
                    {selectedBox.name}
                  </button>
                )}
              </div>
              <div className="floatingHeaderActions">
                <button
                  aria-label="Acompanhar câmera com o espaço"
                  className={`iconToggleButton ${followCameraWithBox ? 'isActive' : ''}`}
                  onClick={() => setFollowCameraWithBox(!followCameraWithBox)}
                  title={
                    followCameraWithBox
                      ? 'Destravar acompanhamento da câmera'
                      : 'Travar acompanhamento da câmera'
                  }
                  type="button"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M12 4a8 8 0 0 0-8 8h3a5 5 0 1 1 10 0h3a8 8 0 0 0-8-8Z" />
                    <path d="M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6Z" />
                    <path d="M12 1v2M12 21v2M1 12h2M21 12h2" />
                  </svg>
                </button>
                <button
                  className={`floatingModeButton ${isAdvancedEditor ? 'isActive' : ''}`}
                  onClick={() => setIsAdvancedEditor((current) => !current)}
                  type="button"
                >
                  Avançado
                </button>
                <div className="floatingHeaderStep">
                  <button onClick={() => adjustQuickStep(-1)} type="button">
                    -
                  </button>
                  {isQuickStepEditing ? (
                    <input
                      autoFocus
                      inputMode="decimal"
                      onBlur={cancelQuickStepEdit}
                      onChange={(event) => setQuickStepDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          commitQuickStepEdit();
                        }

                        if (event.key === 'Escape') {
                          cancelQuickStepEdit();
                        }
                      }}
                      type="text"
                      value={quickStepDraft}
                    />
                  ) : (
                    <button
                      className="floatingStepValue"
                      onClick={() => setIsQuickStepEditing(true)}
                      type="button"
                    >
                      {formatStepValue(quickStepValue, quickStepUnit)}
                    </button>
                  )}
                  <button onClick={() => adjustQuickStep(1)} type="button">
                    +
                  </button>
                </div>
              </div>
            </div>
            {isAdvancedEditor ? (
              <>
                <div className="floatingEditorTabs modeToggle modeToggleAdvanced">
                  {([
                    ['translate', 'Translação'],
                    ['rotate', 'Rotação'],
                    ['scale', 'Escala'],
                  ] as const).map(([mode, label]) => (
                    <button
                      className={mode === transformMode ? 'isActive' : ''}
                      key={mode}
                      onClick={() => setTransformMode(mode)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="floatingAxisGrid">
                  {([
                    ['x', 'X'],
                    ['y', 'Y'],
                    ['z', 'Z'],
                  ] as const).map(([axis, label]) =>
                    renderFloatingAxisRow(
                      label,
                      floatingEditorDrafts[transformMode][axis],
                      (direction) => handleFloatingTransformAction(axis, direction),
                      (rawValue) =>
                        handleFloatingDraftChange(transformMode, axis, rawValue),
                      () => commitFloatingDraft(transformMode, axis),
                      () => resetFloatingDraft(transformMode, axis),
                    ),
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="floatingEditorTabs modeToggle modeToggleSimple">
                  {([
                    ['position', 'Posição'],
                    ['size', 'Tamanho'],
                  ] as const).map(([mode, label]) => (
                    <button
                      className={mode === simpleEditorMode ? 'isActive' : ''}
                      key={mode}
                      onClick={() => setSimpleEditorMode(mode)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {simpleEditorMode === 'position' ? (
                  <div className="floatingAxisGrid">
                    {renderFloatingAxisRow(
                      'X',
                      floatingEditorDrafts.translate.x,
                      (direction) => adjustSelectedPosition('x', direction),
                      (rawValue) =>
                        handleFloatingDraftChange('translate', 'x', rawValue),
                      () => commitFloatingDraft('translate', 'x'),
                      () => resetFloatingDraft('translate', 'x'),
                    )}
                    {renderFloatingAxisRow(
                      'Y',
                      floatingEditorDrafts.translate.y,
                      (direction) => adjustSelectedPosition('y', direction),
                      (rawValue) =>
                        handleFloatingDraftChange('translate', 'y', rawValue),
                      () => commitFloatingDraft('translate', 'y'),
                      () => resetFloatingDraft('translate', 'y'),
                    )}
                    {renderFloatingAxisRow(
                      'Z',
                      floatingEditorDrafts.translate.z,
                      (direction) => adjustSelectedPosition('z', direction),
                      (rawValue) =>
                        handleFloatingDraftChange('translate', 'z', rawValue),
                      () => commitFloatingDraft('translate', 'z'),
                      () => resetFloatingDraft('translate', 'z'),
                    )}
                    {renderFloatingAxisRow(
                      'Rotação',
                      floatingEditorDrafts.rotate.z,
                      (direction) => adjustSelectedRotation('z', direction),
                      (rawValue) =>
                        handleFloatingDraftChange('rotate', 'z', rawValue),
                      () => commitFloatingDraft('rotate', 'z'),
                      () => resetFloatingDraft('rotate', 'z'),
                    )}
                    <p className="floatingMetaText">
                      Passo de rotação: {formatStepValue(rotationStep, 'deg')}
                    </p>
                  </div>
                ) : (
                  <div className="floatingAxisGrid">
                    {renderFloatingAxisRow(
                      'Pé direito',
                      floatingEditorDrafts.scale.z,
                      (direction) => adjustSelectedScale('z', direction),
                      (rawValue) =>
                        handleFloatingDraftChange('scale', 'z', rawValue),
                      () => commitFloatingDraft('scale', 'z'),
                      () => resetFloatingDraft('scale', 'z'),
                    )}
                    {renderFloatingAxisRow(
                      'Largura',
                      floatingEditorDrafts.scale.x,
                      (direction) => adjustSelectedScale('x', direction),
                      (rawValue) =>
                        handleFloatingDraftChange('scale', 'x', rawValue),
                      () => commitFloatingDraft('scale', 'x'),
                      () => resetFloatingDraft('scale', 'x'),
                    )}
                    {renderFloatingAxisRow(
                      'Profundidade',
                      floatingEditorDrafts.scale.y,
                      (direction) => adjustSelectedScale('y', direction),
                      (rawValue) =>
                        handleFloatingDraftChange('scale', 'y', rawValue),
                      () => commitFloatingDraft('scale', 'y'),
                      () => resetFloatingDraft('scale', 'y'),
                    )}
                    <div className="floatingMetricsCard">
                      <span>Área</span>
                      <strong>{selectedArea} m²</strong>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : null}
        {contextMenuState ? (
          <div
            className="contextMenu"
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            ref={contextMenuRef}
            style={{
              left: `${contextMenuState.x}px`,
              top: `${contextMenuState.y}px`,
            }}
          >
            <button
              className="contextMenuItem"
              onClick={handleArmBoxPlacement}
              type="button"
            >
              Adicionar espaço
            </button>
            {contextMenuTargetBox ? (
              <button
                className="contextMenuItem"
                onClick={handleDuplicateContextTargetBox}
                type="button"
              >
                Duplicar {contextMenuTargetBox.name}
              </button>
            ) : null}
            {contextMenuTargetBox ? (
              <button
                className="contextMenuItem danger"
                onClick={handleRemoveContextTargetBox}
                type="button"
              >
                Remover {contextMenuTargetBox.name}
              </button>
            ) : null}
          </div>
        ) : null}
        <div id="mapContainer" ref={containerRef} />
      </main>
    </div>
  );
}
