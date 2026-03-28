import { useEffect, useRef, useState } from 'react';
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
  cloneBoxesConfig,
  getBoxById,
  initialBoxes,
  type BoxConfig,
} from './config';
import {
  initializeGoogleMapsScene,
  type SceneController,
} from './googleMapsScene';

type SceneStatus = 'loading' | 'ready' | 'error';
type EditTool = 'move' | 'scale';

interface LayoutSnapshot {
  boxes: BoxConfig[];
  cameraState: CameraState;
  exportedAt: string;
  version: 2;
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

function isBoxConfigArray(value: unknown): value is BoxConfig[] {
  return (
    Array.isArray(value) &&
    value.every((box) => {
      if (!box || typeof box !== 'object') {
        return false;
      }

      const candidate = box as Partial<BoxConfig>;
      return (
        typeof candidate.id === 'string' &&
        !!candidate.position &&
        typeof candidate.position === 'object' &&
        typeof candidate.position.lat === 'number' &&
        typeof candidate.position.lng === 'number' &&
        typeof candidate.position.altitude === 'number' &&
        !!candidate.scale &&
        typeof candidate.scale === 'object' &&
        typeof candidate.scale.x === 'number' &&
        typeof candidate.scale.y === 'number' &&
        typeof candidate.scale.z === 'number'
      );
    })
  );
}

export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sceneRef = useRef<SceneController | null>(null);
  const startupCameraState = parseCameraStateFromUrl() ?? getDefaultCameraState();
  const startupNoCache = parseNoCacheFromUrl();
  const [defaultCameraState, setDefaultCameraState] =
    useState<CameraState>(startupCameraState);
  const [boxes, setBoxes] = useState<BoxConfig[]>(() => cloneBoxesConfig(initialBoxes));
  const [editingBoxId, setEditingBoxId] = useState<string | null>(null);
  const [hoveredBoxId, setHoveredBoxId] = useState<string | null>(null);
  const [editTool, setEditTool] = useState<EditTool>('move');
  const [cameraLocked, setCameraLocked] = useState(false);
  const [noCache, setNoCache] = useState(startupNoCache);
  const [sceneStatus, setSceneStatus] = useState<SceneStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [interactionHint, setInteractionHint] = useState('');
  const [cameraUrl, setCameraUrl] = useState(() =>
    buildUrlWithNoCache(
      startupNoCache,
      buildUrlWithCameraState(startupCameraState),
    ),
  );
  const cameraStateRef = useRef(defaultCameraState);
  const boxesRef = useRef(boxes);
  const noCacheRef = useRef(noCache);
  const editToolRef = useRef<EditTool>(editTool);
  const hintTimeoutRef = useRef<number | null>(null);
  const cameraUrlFrameRef = useRef<number | null>(null);

  const editingBox = editingBoxId ? getBoxById(editingBoxId, boxes) : undefined;
  const hoveredBox = hoveredBoxId ? getBoxById(hoveredBoxId, boxes) : undefined;

  const syncUrl = (
    cameraState: CameraState = cameraStateRef.current,
    nextNoCache: boolean = noCacheRef.current,
  ): string => {
    let nextUrl = buildUrlWithCameraState(cameraState);
    nextUrl = buildUrlWithNoCache(nextNoCache, nextUrl);
    window.history.replaceState(window.history.state, '', nextUrl);
    setCameraUrl(nextUrl);
    return nextUrl;
  };

  useEffect(() => {
    syncUrl(defaultCameraState, startupNoCache);

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

    if (!container) {
      return;
    }

    let active = true;
    let controller: SceneController | null = null;

    const loadScene = async () => {
      try {
        setSceneStatus('loading');
        setErrorMessage('');

        controller = await initializeGoogleMapsScene(container, {
          initialBoxes: boxesRef.current,
          initialCameraState: defaultCameraState,
          onBoxesChange: (nextBoxes) => {
            boxesRef.current = nextBoxes;
            setBoxes(nextBoxes);
          },
          onCameraStateChange: (cameraState) => {
            cameraStateRef.current = cameraState;

            if (cameraUrlFrameRef.current !== null) {
              window.cancelAnimationFrame(cameraUrlFrameRef.current);
            }

            cameraUrlFrameRef.current = window.requestAnimationFrame(() => {
              syncUrl(cameraStateRef.current, noCacheRef.current);
              cameraUrlFrameRef.current = null;
            });
          },
          onEditingBoxChange: (boxId) => {
            setEditingBoxId(boxId);
          },
          onHoverBoxChange: (boxId) => {
            setHoveredBoxId(boxId);
          },
        });

        if (!active) {
          controller.destroy();
          return;
        }

        sceneRef.current = controller;
        controller.setEditTool(editToolRef.current);
        controller.setCameraLocked(cameraLocked);
        setSceneStatus('ready');
      } catch (error) {
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

  useEffect(() => {
    boxesRef.current = boxes;
  }, [boxes]);

  useEffect(() => {
    noCacheRef.current = noCache;
    syncUrl(cameraStateRef.current, noCache);
  }, [noCache]);

  useEffect(() => {
    editToolRef.current = editTool;
    sceneRef.current?.setEditTool(editTool);
  }, [editTool]);

  useEffect(() => {
    sceneRef.current?.setCameraLocked(cameraLocked);
  }, [cameraLocked]);

  useEffect(() => {
    sceneRef.current?.setEditingBox(editingBoxId);
  }, [editingBoxId]);

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

  const handleExportLayout = (): void => {
    const snapshot: LayoutSnapshot = {
      boxes: sceneRef.current?.getBoxes() ?? cloneBoxesConfig(boxes),
      cameraState: sceneRef.current?.getCameraState() ?? cameraStateRef.current,
      exportedAt: new Date().toISOString(),
      version: 2,
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
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await file.text()) as Partial<LayoutSnapshot>;

      if (!isBoxConfigArray(parsed.boxes)) {
        throw new Error('Arquivo sem lista válida de caixas.');
      }

      const nextBoxes = cloneBoxesConfig(parsed.boxes);
      setBoxes(nextBoxes);
      sceneRef.current?.setBoxes(nextBoxes);

      if (isCameraState(parsed.cameraState)) {
        setDefaultCameraState(parsed.cameraState);
        cameraStateRef.current = parsed.cameraState;
        sceneRef.current?.setCameraState(parsed.cameraState);
        syncUrl(parsed.cameraState, noCacheRef.current);
      }

      setEditingBoxId(null);
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

  return (
    <div className="layout">
      <aside className="panel">
        <h1>PUC-Rio 3D Overlay</h1>
        <p className="muted">
          Editor de caixas 3D sobre o Google Maps. Use <strong>Alt + clique
          esquerdo</strong> para inserir uma caixa. Use <strong>clique
          direito</strong> numa caixa para entrar em edição e clique direito em
          vazio para sair.
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
            Exportar caixas
          </button>
          <button onClick={() => fileInputRef.current?.click()} type="button">
            Importar caixas
          </button>
          <button
            onClick={() =>
              window.location.assign(
                buildNoCacheReloadUrl(noCacheRef.current, window.location.href),
              )
            }
            type="button"
          >
            Recarregar
          </button>
          <button
            disabled={!editingBoxId}
            onClick={() => {
              setEditingBoxId(null);
              sceneRef.current?.clearEditingBox();
            }}
            type="button"
          >
            Sair da edição
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
          <label htmlFor="boxSelect">Caixa</label>
          <select
            id="boxSelect"
            onChange={(event) =>
              setEditingBoxId(event.target.value ? event.target.value : null)
            }
            value={editingBoxId ?? ''}
          >
            <option value="">Nenhuma</option>
            {boxes.map((box) => (
              <option key={box.id} value={box.id}>
                {box.id}
              </option>
            ))}
          </select>
        </div>

        <div className="section">
          <label htmlFor="toolSelect">Ferramenta da edição</label>
          <select
            disabled={!editingBoxId}
            id="toolSelect"
            onChange={(event) => setEditTool(event.target.value as EditTool)}
            value={editTool}
          >
            <option value="move">Mover</option>
            <option value="scale">Escala</option>
          </select>
        </div>

        <div className="section legend">
          <div>
            <span className="dot selected" />
            Caixa em edição
          </div>
          <div>
            <span className="dot hover" />
            Hover da caixa
          </div>
          <div>
            <span className="dot axis-x" />
            Handle X
          </div>
          <div>
            <span className="dot axis-y" />
            Handle Y
          </div>
          <div>
            <span className="dot axis-z" />
            Handle Z
          </div>
        </div>

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
            <strong>Caixas</strong>
            <br />
            {boxes.length} caixa(s) inserida(s)
          </p>
          <p>
            <strong>Hover</strong>
            <br />
            {hoveredBox ? hoveredBox.id : 'Nenhuma'}
          </p>
          <p>
            <strong>Edição</strong>
            <br />
            {editingBox
              ? `${editingBox.id} | pos ${editingBox.position.lat.toFixed(6)}, ${editingBox.position.lng.toFixed(6)}, ${editingBox.position.altitude.toFixed(2)} | escala ${editingBox.scale.x.toFixed(2)} x ${editingBox.scale.y.toFixed(2)} x ${editingBox.scale.z.toFixed(2)}`
              : 'Clique direito em uma caixa para editar.'}
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
                ? 'Carregando mapa 3D e editor de caixas.'
                : errorMessage}
            </p>
          </div>
        ) : null}
      </aside>

      <main
        className="viewerShell"
        onWheelCapture={(event) => {
          if (!event.ctrlKey) {
            showHint('Use Ctrl + scroll para zoom no mapa 3D.');
          }
        }}
      >
        {interactionHint ? <div className="hintBubble">{interactionHint}</div> : null}
        <div id="mapContainer" ref={containerRef} />
      </main>
    </div>
  );
}
