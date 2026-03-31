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
import {
  initializeThreeEditorOverlay,
  type ThreeEditorOverlayController,
} from './threeEditorOverlay';

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

interface AxisControlProps {
  axis: AxisName;
  displayValue: string;
  onDecrement: () => void;
  onIncrement: () => void;
}

function AxisControl({
  axis,
  displayValue,
  onDecrement,
  onIncrement,
}: AxisControlProps) {
  return (
    <div className="axisControl">
      <span className="axisLabel">{axis.toUpperCase()}</span>
      <button onClick={onDecrement} type="button">
        -
      </button>
      <code>{displayValue}</code>
      <button onClick={onIncrement} type="button">
        +
      </button>
    </div>
  );
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

function formatBoxSummary(box: BoxConfig): string {
  return `${box.name} | lat ${box.position.lat.toFixed(6)} | lng ${box.position.lng.toFixed(6)} | alt ${box.position.altitude.toFixed(2)}`;
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

export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const overlayContainerRef = useRef<HTMLDivElement | null>(null);
  const viewerShellRef = useRef<HTMLElement | null>(null);
  const sceneRef = useRef<SceneController | null>(null);
  const overlayRef = useRef<ThreeEditorOverlayController | null>(null);
  const startupCameraState = parseCameraStateFromUrl() ?? getDefaultCameraState();
  const [defaultCameraState, setDefaultCameraState] =
    useState<CameraState>(startupCameraState);
  const [sceneStatus, setSceneStatus] = useState<SceneStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [interactionHint, setInteractionHint] = useState('');
  const [isNameModalOpen, setIsNameModalOpen] = useState(false);
  const [pendingBoxName, setPendingBoxName] = useState('');
  const [hoverTooltipPosition, setHoverTooltipPosition] = useState({
    x: 18,
    y: 18,
  });
  const [cameraUrl, setCameraUrl] = useState(() =>
    buildUrlWithNoCache(parseNoCacheFromUrl(), buildUrlWithCameraState(startupCameraState)),
  );
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
  const transformSnapEnabled = useEditorStore(
    (state) => state.transformSnapEnabled,
  );
  const clearFocusRequest = useEditorStore((state) => state.clearFocusRequest);
  const closeContextMenu = useEditorStore((state) => state.closeContextMenu);
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
  const setTransformSnapEnabled = useEditorStore(
    (state) => state.setTransformSnapEnabled,
  );
  const updateSpace = useEditorStore((state) => state.updateSpace);
  const armPlacementMode = useEditorStore((state) => state.armPlacementMode);
  const openContextMenu = useEditorStore((state) => state.openContextMenu);
  const cameraStateRef = useRef(defaultCameraState);
  const hintTimeoutRef = useRef<number | null>(null);
  const cameraUrlFrameRef = useRef<number | null>(null);
  const previousTrackedBoxRef = useRef<BoxConfig | null>(null);

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

  const syncUrl = (
    cameraState: CameraState = cameraStateRef.current,
    nextNoCache: boolean = editorStore.getState().noCache,
  ): string => {
    let nextUrl = buildUrlWithCameraState(cameraState);
    nextUrl = buildUrlWithNoCache(nextNoCache, nextUrl);
    window.history.replaceState(window.history.state, '', nextUrl);
    setCameraUrl(nextUrl);
    return nextUrl;
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
    const overlayContainer = overlayContainerRef.current;
    const viewerElement = viewerShellRef.current;

    if (!container || !overlayContainer || !viewerElement) {
      return;
    }

    let active = true;
    let controller: SceneController | null = null;
    let overlayController: ThreeEditorOverlayController | null = null;

    const loadScene = async () => {
      try {
        setSceneStatus('loading');
        setErrorMessage('');

        controller = await initializeGoogleMapsScene(container, {
          initialCameraState: defaultCameraState,
          onCameraStateChange: (cameraState) => {
            cameraStateRef.current = cameraState;
            overlayRef.current?.setCameraState(cameraState);

            if (cameraUrlFrameRef.current !== null) {
              window.cancelAnimationFrame(cameraUrlFrameRef.current);
            }

            cameraUrlFrameRef.current = window.requestAnimationFrame(() => {
              syncUrl(cameraStateRef.current, editorStore.getState().noCache);
              cameraUrlFrameRef.current = null;
            });
          },
        });

        overlayController = initializeThreeEditorOverlay(overlayContainer, {
          initialCameraState: defaultCameraState,
          viewerElement,
        });

        if (!active) {
          controller.destroy();
          overlayController.destroy();
          return;
        }

        sceneRef.current = controller;
        overlayRef.current = overlayController;
        setSceneStatus('ready');
      } catch (error) {
        controller?.destroy();
        overlayController?.destroy();

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
      overlayController?.destroy();

      if (sceneRef.current === controller) {
        sceneRef.current = null;
      }

      if (overlayRef.current === overlayController) {
        overlayRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedBox) {
      setIsNameModalOpen(false);
      setPendingBoxName('');
      return;
    }

    setPendingBoxName(selectedBox.name);
  }, [selectedBox]);

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
    overlayRef.current?.setCameraState(defaultCameraState);
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
    if (!selectedBox) {
      previousTrackedBoxRef.current = null;
      return;
    }

    const previousTrackedBox = previousTrackedBoxRef.current;

    if (!previousTrackedBox || previousTrackedBox.id !== selectedBox.id) {
      previousTrackedBoxRef.current = cloneBoxConfig(selectedBox);
      return;
    }

    if (
      followCameraWithBox &&
      didBoxTransformChange(previousTrackedBox, selectedBox)
    ) {
      syncTrackedCameraForBoxChange(previousTrackedBox, selectedBox);
    }

    previousTrackedBoxRef.current = cloneBoxConfig(selectedBox);
  }, [followCameraWithBox, selectedBox]);

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

  const handleSelectedScaleFieldChange = (
    axis: AxisName,
    rawValue: string,
  ): void => {
    const nextValue = Number(rawValue);

    if (!Number.isFinite(nextValue)) {
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

  const handleDeleteSelectedBox = (): void => {
    if (!selectedBoxId) {
      return;
    }

    removeSpace(selectedBoxId);
  };

  const handleOpenNameModal = (): void => {
    if (!selectedBox) {
      return;
    }

    setPendingBoxName(selectedBox.name);
    setIsNameModalOpen(true);
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
      targetSpaceId: hoveredBoxId,
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

  const handleSaveBoxName = (): void => {
    const nextName = pendingBoxName.trim();

    if (!selectedBox || !nextName) {
      return;
    }

    updateSelectedBox((box) => {
      box.name = nextName;
      return box;
    });
    setIsNameModalOpen(false);
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

  return (
    <div className="layout">
      <aside className="panel">
        <h1>PUC-Rio 3D Overlay</h1>
        <p className="muted">
          Use <strong>clique direito</strong> no mapa para abrir o menu de
          contexto e escolher <strong>Adicionar espaço</strong>. Depois, use{' '}
          <strong>clique esquerdo</strong> para posicionar o espaço. Quando um
          espaço estiver selecionado, use o gizmo 3D para mover, rotacionar ou
          escalar diretamente sobre o mapa.
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
          <label className="row">
            <input
              checked={followCameraWithBox}
              disabled={!selectedBox}
              onChange={(event) => setFollowCameraWithBox(event.target.checked)}
              type="checkbox"
            />
            Acompanhar câmera com o espaço
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

        <div className="section">
          <p className="sectionTitle">Passos do editor</p>
          <div className="stepSelectorGrid">
            <label className="sliderControl">
              <span>Posição</span>
              <strong>{formatStepValue(positionStep, 'm')}</strong>
              <input
                max="10"
                min="0.05"
                onChange={(event) => setPositionStep(Number(event.target.value))}
                step="0.05"
                type="range"
                value={positionStep}
              />
            </label>
            <label className="sliderControl">
              <span>Rotação</span>
              <strong>{formatStepValue(rotationStep, 'deg')}</strong>
              <input
                max="45"
                min="0.5"
                onChange={(event) => setRotationStep(Number(event.target.value))}
                step="0.5"
                type="range"
                value={rotationStep}
              />
            </label>
            <label className="sliderControl">
              <span>Escala</span>
              <strong>{formatStepValue(scaleStep, 'm')}</strong>
              <input
                max="10"
                min="0.05"
                onChange={(event) => setScaleStep(Number(event.target.value))}
                step="0.05"
                type="range"
                value={scaleStep}
              />
            </label>
          </div>
          <label className="row rowCompact">
            <input
              checked={transformSnapEnabled}
              onChange={(event) => setTransformSnapEnabled(event.target.checked)}
              type="checkbox"
            />
            Snap do gizmo usando os passos acima
          </label>
        </div>

        {selectedBox ? (
          <div className="section">
            <div className="inlineActions">
              <p className="sectionTitle">Editar {selectedBox.name}</p>
              <button onClick={handleOpenNameModal} type="button">
                Editar nome
              </button>
            </div>
            <p className="small">
              Translação local do espaço: <code>X</code>, <code>Y</code> e{' '}
              <code>Z</code> seguem a rotação atual do próprio objeto. Os
              botões usam o passo em metros; o gizmo 3D também usa esse snap
              quando ativado.
            </p>

            <div className="editorGroup">
              <p className="groupLabel">Gizmo 3D</p>
              <div className="modeToggle">
                {([
                  ['translate', 'Mover'],
                  ['rotate', 'Rotacionar'],
                  ['scale', 'Escalar'],
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
            </div>

            <div className="editorGroup">
              <p className="groupLabel">Posição</p>
              <AxisControl
                axis="x"
                displayValue={`${selectedBox.position.lng.toFixed(7)} lng`}
                onDecrement={() => adjustSelectedPosition('x', -1)}
                onIncrement={() => adjustSelectedPosition('x', 1)}
              />
              <AxisControl
                axis="y"
                displayValue={`${selectedBox.position.lat.toFixed(7)} lat`}
                onDecrement={() => adjustSelectedPosition('y', -1)}
                onIncrement={() => adjustSelectedPosition('y', 1)}
              />
              <AxisControl
                axis="z"
                displayValue={`${selectedBox.position.altitude.toFixed(2)} m`}
                onDecrement={() => adjustSelectedPosition('z', -1)}
                onIncrement={() => adjustSelectedPosition('z', 1)}
              />
            </div>

            <div className="editorGroup">
              <p className="groupLabel">Rotação</p>
              <AxisControl
                axis="x"
                displayValue={`${selectedBox.rotation.x.toFixed(2)} deg`}
                onDecrement={() => adjustSelectedRotation('x', -1)}
                onIncrement={() => adjustSelectedRotation('x', 1)}
              />
              <AxisControl
                axis="y"
                displayValue={`${selectedBox.rotation.y.toFixed(2)} deg`}
                onDecrement={() => adjustSelectedRotation('y', -1)}
                onIncrement={() => adjustSelectedRotation('y', 1)}
              />
              <AxisControl
                axis="z"
                displayValue={`${selectedBox.rotation.z.toFixed(2)} deg`}
                onDecrement={() => adjustSelectedRotation('z', -1)}
                onIncrement={() => adjustSelectedRotation('z', 1)}
              />
            </div>

            <div className="editorGroup">
              <p className="groupLabel">Escala</p>
              <AxisControl
                axis="x"
                displayValue={`${selectedBox.scale.x.toFixed(2)} m`}
                onDecrement={() => adjustSelectedScale('x', -1)}
                onIncrement={() => adjustSelectedScale('x', 1)}
              />
              <AxisControl
                axis="y"
                displayValue={`${selectedBox.scale.y.toFixed(2)} m`}
                onDecrement={() => adjustSelectedScale('y', -1)}
                onIncrement={() => adjustSelectedScale('y', 1)}
              />
              <AxisControl
                axis="z"
                displayValue={`${selectedBox.scale.z.toFixed(2)} m`}
                onDecrement={() => adjustSelectedScale('z', -1)}
                onIncrement={() => adjustSelectedScale('z', 1)}
              />
            </div>

            <div className="editorGroup">
              <p className="groupLabel">Dimensões diretas</p>
              <div className="dimensionGrid">
                <label>
                  Largura (X)
                  <input
                    min="0.5"
                    onChange={(event) =>
                      handleSelectedScaleFieldChange('x', event.target.value)
                    }
                    step="0.1"
                    type="number"
                    value={selectedBox.scale.x}
                  />
                </label>
                <label>
                  Profundidade (Y)
                  <input
                    min="0.5"
                    onChange={(event) =>
                      handleSelectedScaleFieldChange('y', event.target.value)
                    }
                    step="0.1"
                    type="number"
                    value={selectedBox.scale.y}
                  />
                </label>
                <label>
                  Altura (Z)
                  <input
                    min="0.5"
                    onChange={(event) =>
                      handleSelectedScaleFieldChange('z', event.target.value)
                    }
                    step="0.1"
                    type="number"
                    value={selectedBox.scale.z}
                  />
                </label>
              </div>
            </div>

            <div className="metricList small">
              <p>
                Lat: {selectedBox.position.lat.toFixed(7)}
                <br />
                Lng: {selectedBox.position.lng.toFixed(7)}
                <br />
                Alt: {selectedBox.position.altitude.toFixed(2)}
              </p>
            </div>
          </div>
        ) : hoveredBox ? (
          <div className="section roomState">
            <p className="sectionTitle">Hover</p>
            <p>{formatBoxSummary(hoveredBox)}</p>
            <p>
              Id: {hoveredBox.id}
              <br />
              Rotação: {hoveredBox.rotation.x.toFixed(1)} /{' '}
              {hoveredBox.rotation.y.toFixed(1)} /{' '}
              {hoveredBox.rotation.z.toFixed(1)}
              <br />
              Escala: {hoveredBox.scale.x.toFixed(2)} x{' '}
              {hoveredBox.scale.y.toFixed(2)} x{' '}
              {hoveredBox.scale.z.toFixed(2)}
            </p>
          </div>
        ) : (
          <div className="section roomState">
            <p className="sectionTitle">Editor</p>
            <p>Selecione um espaço para editar ou passe o mouse por um espaço para inspecionar.</p>
          </div>
        )}

        <div className="section small">
          <p>
            <strong>Startup atual</strong>
            <br />
            Centro: {defaultCameraState.center.lat.toFixed(7)},{' '}
            {defaultCameraState.center.lng.toFixed(7)}
            <br />
            Altitude: {defaultCameraState.center.altitude.toFixed(2)}
            <br />
            Heading: {defaultCameraState.heading.toFixed(2)}
            <br />
            Tilt: {defaultCameraState.tilt.toFixed(2)}
            <br />
            Range: {defaultCameraState.range.toFixed(2)}
            <br />
            FOV: {defaultCameraState.fov.toFixed(2)}
          </p>
          <p>
            Zoom com roda do mouse: use <code>Ctrl</code> + scroll.
          </p>
        </div>

        <div className="section small">
          <p>
            <strong>URL da câmera</strong>
          </p>
          <textarea
            className="urlField"
            onFocus={(event) => event.currentTarget.select()}
            readOnly
            rows={4}
            value={cameraUrl}
          />
        </div>

        <div className="section small roomState">
          <p>
            <strong>Espaços</strong>
            <br />
            {boxes.length} espaço(s)
          </p>
          <p>
            <strong>Selecionada</strong>
            <br />
            {selectedBox ? selectedBox.name : 'Nenhuma'}
          </p>
          <p>
            <strong>Hover</strong>
            <br />
            {hoveredBox ? hoveredBox.name : 'Nenhuma'}
          </p>
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
            contextMenuRef.current?.contains(target)
          ) {
            return;
          }

          if (event.button === 0) {
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
        <div className="threeOverlayLayer" ref={overlayContainerRef} />
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
        {contextMenuState ? (
          <div
            className="contextMenu"
            onClick={(event) => event.stopPropagation()}
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
      {isNameModalOpen && selectedBox ? (
        <div
          className="modalBackdrop"
          onClick={() => setIsNameModalOpen(false)}
          role="presentation"
        >
          <div
            className="modalCard"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-box-name-title"
          >
            <h2 id="edit-box-name-title">Editar nome do espaço</h2>
            <p className="small">
              Id interno: <code>{selectedBox.id}</code>
            </p>
            <label className="modalField">
              Nome
              <input
                autoFocus
                onChange={(event) => setPendingBoxName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleSaveBoxName();
                  }

                  if (event.key === 'Escape') {
                    setIsNameModalOpen(false);
                  }
                }}
                type="text"
                value={pendingBoxName}
              />
            </label>
            <div className="modalActions">
              <button onClick={() => setIsNameModalOpen(false)} type="button">
                Cancelar
              </button>
              <button
                disabled={!pendingBoxName.trim()}
                onClick={handleSaveBoxName}
                type="button"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
