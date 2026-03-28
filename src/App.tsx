import { useEffect, useRef, useState } from 'react';
import {
  buildings,
  getBuildingIdFromRoomId,
  getRoomsForBuilding,
} from './config';
import { initializeCesiumScene, type SceneController } from './cesiumScene';

type SceneStatus = 'loading' | 'ready' | 'error';

export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneController | null>(null);
  const [selectedBuildingId, setSelectedBuildingId] = useState(
    buildings[0]?.id ?? '',
  );
  const [selectedRoomId, setSelectedRoomId] = useState(
    () => getRoomsForBuilding(buildings[0]?.id ?? '')[0]?.id ?? '',
  );
  const [showBoxes, setShowBoxes] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showTiles, setShowTiles] = useState(true);
  const [ghostMode, setGhostMode] = useState(false);
  const [sceneStatus, setSceneStatus] = useState<SceneStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const showBoxesRef = useRef(showBoxes);
  const showLabelsRef = useRef(showLabels);
  const showTilesRef = useRef(showTiles);
  const ghostModeRef = useRef(ghostMode);

  const roomOptions = getRoomsForBuilding(selectedBuildingId);

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

        controller = await initializeCesiumScene(container, {
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
        controller.setBoxesVisible(showBoxesRef.current);
        controller.setLabelsVisible(showLabelsRef.current);
        controller.setTilesVisible(showTilesRef.current);
        controller.setGhostMode(ghostModeRef.current);
        setSceneStatus('ready');
      } catch (error) {
        if (!active) {
          return;
        }

        setSceneStatus('error');
        setErrorMessage(
          error instanceof Error ? error.message : 'Falha ao inicializar a cena 3D.',
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
    showBoxesRef.current = showBoxes;
    sceneRef.current?.setBoxesVisible(showBoxes);
  }, [showBoxes]);

  useEffect(() => {
    showLabelsRef.current = showLabels;
    sceneRef.current?.setLabelsVisible(showLabels);
  }, [showLabels]);

  useEffect(() => {
    showTilesRef.current = showTiles;
    sceneRef.current?.setTilesVisible(showTiles);
  }, [showTiles]);

  useEffect(() => {
    ghostModeRef.current = ghostMode;
    sceneRef.current?.setGhostMode(ghostMode);
  }, [ghostMode]);

  return (
    <div className="layout">
      <aside className="panel">
        <h1>PUC-Rio 3D Overlay</h1>
        <p className="muted">
          Protótipo em React + TypeScript para empilhar cubos por sala/andar
          sobre o contexto 3D fotorealista do Google.
        </p>

        <div className="section">
          <label className="row">
            <input
              checked={showBoxes}
              onChange={(event) => setShowBoxes(event.target.checked)}
              type="checkbox"
            />
            Mostrar caixas
          </label>
          <label className="row">
            <input
              checked={showLabels}
              onChange={(event) => setShowLabels(event.target.checked)}
              type="checkbox"
            />
            Mostrar marcadores
          </label>
          <label className="row">
            <input
              checked={showTiles}
              onChange={(event) => setShowTiles(event.target.checked)}
              type="checkbox"
            />
            Mostrar Google 3D
          </label>
          <label className="row">
            <input
              checked={ghostMode}
              onChange={(event) => setGhostMode(event.target.checked)}
              type="checkbox"
            />
            Modo raio-X
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

        <div className="section actionGrid">
          <button
            disabled={sceneStatus !== 'ready' || !selectedBuildingId}
            onClick={() => sceneRef.current?.focusBuilding(selectedBuildingId)}
            type="button"
          >
            Focar bloco
          </button>
          <button
            disabled={sceneStatus !== 'ready' || !selectedRoomId}
            onClick={() => {
              if (!selectedRoomId) {
                return;
              }

              void sceneRef.current?.focusRoom(selectedRoomId);
            }}
            type="button"
          >
            Focar sala
          </button>
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
        </div>

        <div className="section small">
          <p>
            <strong>Ponto inicial</strong>
            <br />
            -22.9780191, -43.2316504
          </p>
          <p>
            Ajuste as definições em <code>src/config.ts</code> para alinhar os
            volumes ao prédio real.
          </p>
        </div>

        {sceneStatus !== 'ready' ? (
          <div className={`section statusCard ${sceneStatus}`}>
            <strong>
              {sceneStatus === 'loading'
                ? 'Inicializando cena 3D'
                : 'Erro ao carregar o mapa'}
            </strong>
            <p>
              {sceneStatus === 'loading'
                ? 'Carregando Cesium e o tileset fotorealista do Google.'
                : errorMessage}
            </p>
          </div>
        ) : null}
      </aside>

      <main className="viewerShell">
        <div id="cesiumContainer" ref={containerRef} />
      </main>
    </div>
  );
}
