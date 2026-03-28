import { useEffect, useRef, useState } from 'react';
import {
  buildUrlWithCameraState,
  getDefaultCameraState,
  parseCameraStateFromUrl,
  replaceUrlWithCameraState,
  type CameraState,
} from './cameraUrlState';
import {
  buildings,
  getBuildingIdFromRoomId,
  getRoomById,
  getRoomsForBuilding,
} from './config';
import {
  initializeGoogleMapsScene,
  type SceneController,
} from './googleMapsScene';

type SceneStatus = 'loading' | 'ready' | 'error';

export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneController | null>(null);
  const initialCameraStateRef = useRef<CameraState>(
    parseCameraStateFromUrl() ?? getDefaultCameraState(),
  );
  const [selectedBuildingId, setSelectedBuildingId] = useState(
    buildings[0]?.id ?? '',
  );
  const [selectedRoomId, setSelectedRoomId] = useState(
    () => getRoomsForBuilding(buildings[0]?.id ?? '')[0]?.id ?? '',
  );
  const [showRooms, setShowRooms] = useState(true);
  const [cameraLocked, setCameraLocked] = useState(true);
  const [hoveredRoomId, setHoveredRoomId] = useState<string | null>(null);
  const [sceneStatus, setSceneStatus] = useState<SceneStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [cameraUrl, setCameraUrl] = useState(() =>
    buildUrlWithCameraState(initialCameraStateRef.current),
  );
  const showRoomsRef = useRef(showRooms);
  const cameraLockedRef = useRef(cameraLocked);
  const selectedRoomRef = useRef(selectedRoomId);
  const cameraStateRef = useRef(initialCameraStateRef.current);
  const cameraUrlFrameRef = useRef<number | null>(null);

  const roomOptions = getRoomsForBuilding(selectedBuildingId);
  const hoveredRoom = hoveredRoomId ? getRoomById(hoveredRoomId) : undefined;
  const selectedRoom = selectedRoomId ? getRoomById(selectedRoomId) : undefined;

  useEffect(() => {
    const nextUrl = replaceUrlWithCameraState(initialCameraStateRef.current);
    setCameraUrl(nextUrl);

    return () => {
      if (cameraUrlFrameRef.current !== null) {
        window.cancelAnimationFrame(cameraUrlFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const nextRoomOptions = getRoomsForBuilding(selectedBuildingId);

    if (nextRoomOptions.length === 0) {
      if (selectedRoomId !== '') {
        setSelectedRoomId('');
      }

      return;
    }

    if (!nextRoomOptions.some((room) => room.id === selectedRoomId)) {
      setSelectedRoomId(nextRoomOptions[0].id);
    }
  }, [selectedBuildingId, selectedRoomId]);

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
          initialCameraState: initialCameraStateRef.current,
          onCameraStateChange: (cameraState) => {
            cameraStateRef.current = cameraState;

            if (cameraUrlFrameRef.current !== null) {
              window.cancelAnimationFrame(cameraUrlFrameRef.current);
            }

            cameraUrlFrameRef.current = window.requestAnimationFrame(() => {
              const nextUrl = replaceUrlWithCameraState(cameraStateRef.current);
              setCameraUrl(nextUrl);
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
    selectedRoomRef.current = selectedRoomId;
    sceneRef.current?.setSelectedRoom(selectedRoomId);
  }, [selectedRoomId]);

  return (
    <div className="layout">
      <aside className="panel">
        <h1>PUC-Rio 3D Overlay</h1>
        <p className="muted">
          Migração para o Google Maps 3D nativo, com a câmera travada no
          enquadramento de referência e salas interativas sobre o prédio.
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
            Travar câmera na vista do link
          </label>
        </div>

        <div className="section">
          <label htmlFor="buildingSelect">Bloco</label>
          <select
            id="buildingSelect"
            onChange={(event) => {
              const buildingId = event.target.value;
              const nextRooms = getRoomsForBuilding(buildingId);

              setSelectedBuildingId(buildingId);
              setSelectedRoomId(nextRooms[0]?.id ?? '');
            }}
            value={selectedBuildingId}
          >
            {buildings.map((building) => (
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
        </div>

        <div className="section small">
          <p>
            <strong>Vista inicial</strong>
            <br />
            Centro: {initialCameraStateRef.current.center.lat.toFixed(7)},{' '}
            {initialCameraStateRef.current.center.lng.toFixed(7)}
            <br />
            Altitude: {initialCameraStateRef.current.center.altitude.toFixed(2)}
            <br />
            Heading: {initialCameraStateRef.current.heading.toFixed(2)}
            <br />
            Tilt: {initialCameraStateRef.current.tilt.toFixed(2)}
            <br />
            Range: {initialCameraStateRef.current.range.toFixed(2)}
            <br />
            FOV: {initialCameraStateRef.current.fov.toFixed(2)}
          </p>
          <p>
            A grade continua calibrável em <code>src/config.ts</code> via
            heading, baseHeight e offsets em metros.
          </p>
        </div>

        <div className="section small">
          <p>
            <strong>URL da câmera</strong>
            <br />
            A URL abaixo recebe os parâmetros <code>camLat</code>,{' '}
            <code>camLng</code>, <code>camAlt</code>, <code>camHeading</code>,{' '}
            <code>camTilt</code>, <code>camRange</code> e <code>camFov</code>.
            Navegue, copie a URL e me cole depois.
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
                ? 'Carregando Map3DElement e overlays 3D interativos.'
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
