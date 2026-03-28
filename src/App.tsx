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
  buildings,
  cloneBuildingsConfig,
  getBuildingIdFromRoomId,
  getRoomById,
  getRoomsForBuilding,
  type BuildingConfig,
} from './config';
import {
  initializeGoogleMapsScene,
  type SceneController,
} from './googleMapsScene';

type SceneStatus = 'loading' | 'ready' | 'error';

interface LayoutSnapshot {
  buildings: BuildingConfig[];
  cameraState: CameraState;
  exportedAt: string;
  version: 1;
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

function isBuildingConfigArray(value: unknown): value is BuildingConfig[] {
  return (
    Array.isArray(value) &&
    value.every((building) => {
      if (!building || typeof building !== 'object') {
        return false;
      }

      const candidate = building as Partial<BuildingConfig>;
      return (
        typeof candidate.id === 'string' &&
        typeof candidate.name === 'string' &&
        typeof candidate.lat === 'number' &&
        typeof candidate.lon === 'number' &&
        typeof candidate.baseHeight === 'number' &&
        typeof candidate.headingDeg === 'number' &&
        !!candidate.grid &&
        typeof candidate.grid === 'object' &&
        typeof candidate.grid.cols === 'number' &&
        typeof candidate.grid.rows === 'number' &&
        typeof candidate.grid.floors === 'number' &&
        typeof candidate.grid.cellX === 'number' &&
        typeof candidate.grid.cellY === 'number' &&
        typeof candidate.grid.cellZ === 'number' &&
        typeof candidate.grid.padding === 'number' &&
        Array.isArray(candidate.statusPattern)
      );
    })
  );
}

export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const startupCameraState = parseCameraStateFromUrl() ?? getDefaultCameraState();
  const startupNoCache = parseNoCacheFromUrl();
  const [defaultCameraState, setDefaultCameraState] =
    useState<CameraState>(startupCameraState);
  const [buildingConfigs, setBuildingConfigs] = useState<BuildingConfig[]>(
    () => cloneBuildingsConfig(buildings),
  );
  const [selectedBuildingId, setSelectedBuildingId] = useState(
    buildings[0]?.id ?? '',
  );
  const [selectedRoomId, setSelectedRoomId] = useState(
    () => getRoomsForBuilding(buildings[0]?.id ?? '', buildingConfigs)[0]?.id ?? '',
  );
  const [showRooms, setShowRooms] = useState(true);
  const [cameraLocked, setCameraLocked] = useState(true);
  const [noCache, setNoCache] = useState(startupNoCache);
  const [hoveredRoomId, setHoveredRoomId] = useState<string | null>(null);
  const [sceneStatus, setSceneStatus] = useState<SceneStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [cameraUrl, setCameraUrl] = useState(() =>
    buildUrlWithNoCache(
      startupNoCache,
      buildUrlWithCameraState(startupCameraState),
    ),
  );
  const showRoomsRef = useRef(showRooms);
  const cameraLockedRef = useRef(cameraLocked);
  const selectedRoomRef = useRef(selectedRoomId);
  const selectedBuildingRef = useRef(selectedBuildingId);
  const cameraStateRef = useRef(defaultCameraState);
  const noCacheRef = useRef(noCache);
  const cameraUrlFrameRef = useRef<number | null>(null);

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

  const roomOptions = getRoomsForBuilding(selectedBuildingId, buildingConfigs);
  const hoveredRoom = hoveredRoomId
    ? getRoomById(hoveredRoomId, buildingConfigs)
    : undefined;
  const selectedRoom = selectedRoomId
    ? getRoomById(selectedRoomId, buildingConfigs)
    : undefined;

  useEffect(() => {
    syncUrl(defaultCameraState, startupNoCache);

    return () => {
      if (cameraUrlFrameRef.current !== null) {
        window.cancelAnimationFrame(cameraUrlFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const nextRoomOptions = getRoomsForBuilding(selectedBuildingId, buildingConfigs);

    if (nextRoomOptions.length === 0) {
      if (selectedRoomId !== '') {
        setSelectedRoomId('');
      }

      return;
    }

    if (!nextRoomOptions.some((room) => room.id === selectedRoomId)) {
      setSelectedRoomId(nextRoomOptions[0].id);
    }
  }, [buildingConfigs, selectedBuildingId, selectedRoomId]);

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
          initialBuildings: buildingConfigs,
          initialCameraState: defaultCameraState,
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
          onRoomHovered: (roomId) => {
            setHoveredRoomId(roomId);
          },
          onRoomSelected: (roomId) => {
            setSelectedBuildingId(getBuildingIdFromRoomId(roomId));
            setSelectedRoomId(roomId);
          },
        });

        if (!active) {
          controller.destroy();
          return;
        }

        sceneRef.current = controller;
        controller.setRoomsVisible(showRoomsRef.current);
        controller.setCameraLocked(cameraLockedRef.current);
        controller.setSelectedBuilding(selectedBuildingRef.current);
        controller.setSelectedRoom(selectedRoomRef.current);
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
    showRoomsRef.current = showRooms;
    sceneRef.current?.setRoomsVisible(showRooms);
  }, [showRooms]);

  useEffect(() => {
    cameraLockedRef.current = cameraLocked;
    sceneRef.current?.setCameraLocked(cameraLocked);
  }, [cameraLocked]);

  useEffect(() => {
    noCacheRef.current = noCache;
    syncUrl(cameraStateRef.current, noCache);
  }, [noCache]);

  useEffect(() => {
    selectedBuildingRef.current = selectedBuildingId;
    sceneRef.current?.setSelectedBuilding(selectedBuildingId);
  }, [selectedBuildingId]);

  useEffect(() => {
    selectedRoomRef.current = selectedRoomId;
    sceneRef.current?.setSelectedRoom(selectedRoomId);
  }, [selectedRoomId]);

  const handleExportLayout = (): void => {
    const snapshot: LayoutSnapshot = {
      buildings:
        sceneRef.current?.getBuildingConfigs() ?? cloneBuildingsConfig(buildingConfigs),
      cameraState: sceneRef.current?.getCameraState() ?? cameraStateRef.current,
      exportedAt: new Date().toISOString(),
      version: 1,
    };
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = 'puc-rio-3d-overlay-layout.json';
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

      if (!isBuildingConfigArray(parsed.buildings)) {
        throw new Error('Arquivo sem lista válida de buildings.');
      }

      const nextBuildings = cloneBuildingsConfig(parsed.buildings);

      setBuildingConfigs(nextBuildings);
      sceneRef.current?.setBuildingConfigs(nextBuildings);

      if (isCameraState(parsed.cameraState)) {
        cameraStateRef.current = parsed.cameraState;
        setDefaultCameraState(parsed.cameraState);
        sceneRef.current?.setCameraState(parsed.cameraState);
        syncUrl(parsed.cameraState, noCacheRef.current);
      }
    } catch (error) {
      setSceneStatus('error');
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Falha ao importar o layout.',
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
          Google Maps 3D com câmera configurável por URL, blocos arrastáveis por
          eixo e export/import do layout.
        </p>

        <div className="section">
          <label className="row">
            <input
              checked={showRooms}
              onChange={(event) => setShowRooms(event.target.checked)}
              type="checkbox"
            />
            Mostrar salas
          </label>
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
            Exportar layout
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            Importar layout
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
          <label htmlFor="buildingSelect">Bloco</label>
          <select
            id="buildingSelect"
            onChange={(event) => {
              const buildingId = event.target.value;
              const nextRooms = getRoomsForBuilding(buildingId, buildingConfigs);

              setSelectedBuildingId(buildingId);
              setSelectedRoomId(nextRooms[0]?.id ?? '');
            }}
            value={selectedBuildingId}
          >
            {buildingConfigs.map((building) => (
              <option key={building.id} value={building.id}>
                {building.name}
              </option>
            ))}
          </select>
        </div>

        <div className="section">
          <label htmlFor="roomSelect">Sala</label>
          <select
            id="roomSelect"
            onChange={(event) => setSelectedRoomId(event.target.value)}
            value={selectedRoomId}
          >
            {roomOptions.map((room) => (
              <option key={room.id} value={room.id}>
                {room.label}
              </option>
            ))}
          </select>
        </div>

        <div className="section legend">
          <div>
            <span className="dot free" />
            Livre
          </div>
          <div>
            <span className="dot busy" />
            Ocupado
          </div>
          <div>
            <span className="dot blocked" />
            Bloqueado
          </div>
          <div>
            <span className="dot selected" />
            Sala selecionada
          </div>
          <div>
            <span className="dot hover" />
            Hover do mouse
          </div>
          <div>
            <span className="dot axis-x" />
            Eixo X
          </div>
          <div>
            <span className="dot axis-y" />
            Eixo Y
          </div>
          <div>
            <span className="dot axis-z" />
            Eixo Z
          </div>
        </div>

        <div className="section small">
          <p>
            <strong>Default de startup</strong>
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
            Para mover um bloco, selecione o prédio e arraste um dos eixos na
            cena. X e Y movem no plano; Z sobe/desce o bloco inteiro.
          </p>
        </div>

        <div className="section small">
          <p>
            <strong>URL da câmera</strong>
            <br />
            A URL abaixo recebe <code>camLat</code>, <code>camLng</code>,{' '}
            <code>camAlt</code>, <code>camHeading</code>, <code>camTilt</code>,{' '}
            <code>camRange</code>, <code>camFov</code> e preserva o{' '}
            <code>noCache</code>.
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
            <strong>Hover</strong>
            <br />
            {hoveredRoom
              ? hoveredRoom.label
              : 'Passe o mouse sobre uma sala para tentar realce interativo.'}
          </p>
          <p>
            <strong>Seleção</strong>
            <br />
            {selectedRoom
              ? selectedRoom.label
              : 'Selecione uma sala no painel ou clique sobre a projeção.'}
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
                ? 'Carregando Map3DElement, gizmo de eixo e overlays 3D interativos.'
                : errorMessage}
            </p>
          </div>
        ) : null}
      </aside>

      <main className="viewerShell">
        <div id="mapContainer" ref={containerRef} />
      </main>
    </div>
  );
}
