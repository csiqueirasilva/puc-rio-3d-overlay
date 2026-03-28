import * as Cesium from 'cesium';
import {
  buildEntityId,
  buildings,
  getBuildingById,
  initialView,
  patternStatus,
  type BuildingConfig,
  type RoomStatus,
} from './config';

const occupancyPalette: Record<RoomStatus, Cesium.Color> = {
  free: Cesium.Color.fromCssColorString('#22c55e').withAlpha(0.22),
  busy: Cesium.Color.fromCssColorString('#ef4444').withAlpha(0.3),
  blocked: Cesium.Color.fromCssColorString('#f59e0b').withAlpha(0.34),
};

const baseOutlineColor = Cesium.Color.WHITE.withAlpha(0.22);
const selectedFillColor = Cesium.Color.fromCssColorString('#f8fafc').withAlpha(0.94);
const selectedOutlineColor = Cesium.Color.WHITE.withAlpha(1);
const hoverFillColor = Cesium.Color.fromCssColorString('#facc15').withAlpha(0.9);
const hoverOutlineColor = Cesium.Color.fromCssColorString('#fde047').withAlpha(1);

interface BuildingMeta {
  boundingSphere: Cesium.BoundingSphere;
  radius: number;
}

interface RoomMeta {
  baseFillColor: Cesium.Color;
  boundingSphere: Cesium.BoundingSphere;
  buildingId: string;
  id: string;
}

interface PickableEntity extends Cesium.Entity {
  parentRoom?: string;
}

export interface SceneController {
  destroy: () => void;
  focusBuilding: (buildingId: string) => void;
  focusRoom: (roomId: string) => Promise<void>;
  setBoxesVisible: (visible: boolean) => void;
  setGhostMode: (enabled: boolean) => void;
  setLabelsVisible: (visible: boolean) => void;
  setSelectedRoom: (roomId: string) => void;
  setTilesVisible: (visible: boolean) => void;
}

interface InitializeSceneOptions {
  onRoomHovered?: (roomId: string | null) => void;
  onRoomSelected?: (roomId: string) => void;
}

interface BuildingGridResult {
  buildingMeta: BuildingMeta;
  fillInstances: Cesium.GeometryInstance[];
  outlineInstances: Cesium.GeometryInstance[];
  rooms: RoomMeta[];
}

function createViewer(container: HTMLElement): Cesium.Viewer {
  return new Cesium.Viewer(container, {
    globe: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    animation: false,
    timeline: false,
    navigationHelpButton: false,
    infoBox: false,
    selectionIndicator: false,
    requestRenderMode: true,
    shouldAnimate: false,
  });
}

function styleViewer(viewer: Cesium.Viewer): void {
  if (viewer.scene.skyAtmosphere) {
    viewer.scene.skyAtmosphere.show = false;
  }

  if (viewer.scene.skyBox) {
    viewer.scene.skyBox.show = false;
  }

  if (viewer.scene.sun) {
    viewer.scene.sun.show = false;
  }

  if (viewer.scene.moon) {
    viewer.scene.moon.show = false;
  }

  if (viewer.scene.fog) {
    viewer.scene.fog.enabled = false;
  }

  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#06101d');
  viewer.scene.requestRenderMode = true;

  if (viewer.scene.globe) {
    viewer.scene.globe.show = false;
  }

  const cameraController = viewer.scene.screenSpaceCameraController;
  cameraController.inertiaSpin = 0;
  cameraController.inertiaTranslate = 0;
  cameraController.inertiaZoom = 0;
  cameraController.enableCollisionDetection = false;
  cameraController.maximumTiltAngle = Cesium.Math.toRadians(88);
  cameraController.minimumZoomDistance = 6;
  cameraController.maximumZoomDistance = 1200;

  (viewer.cesiumWidget.creditContainer as HTMLElement).style.display = 'block';
}

function createHeadingPitchRange(
  heading: number,
  pitch: number,
  range: number,
): Cesium.HeadingPitchRange {
  return new Cesium.HeadingPitchRange(
    Cesium.Math.toRadians(heading),
    Cesium.Math.toRadians(pitch),
    range,
  );
}

function applyInitialView(viewer: Cesium.Viewer): void {
  const target = Cesium.Cartesian3.fromDegrees(
    initialView.lon,
    initialView.lat,
    initialView.targetHeight,
  );

  viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 18), {
    duration: 0,
    offset: createHeadingPitchRange(
      initialView.heading,
      initialView.pitch,
      initialView.range,
    ),
  });
}

function createPrimitiveAppearance(): Cesium.PerInstanceColorAppearance {
  return new Cesium.PerInstanceColorAppearance({
    flat: true,
    translucent: true,
    closed: false,
    renderState: {
      depthTest: {
        enabled: false,
      },
      depthMask: false,
      blending: Cesium.BlendingState.ALPHA_BLEND,
    },
  });
}

function createBuildingGrid(
  building: BuildingConfig,
  labelsSource: Cesium.CustomDataSource,
): BuildingGridResult {
  const { cols, rows, floors, cellX, cellY, cellZ, padding } = building.grid;
  const offsetX = building.grid.offsetX ?? 0;
  const offsetY = building.grid.offsetY ?? 0;
  const offsetZ = building.grid.offsetZ ?? 0;
  const origin = Cesium.Cartesian3.fromDegrees(
    building.lon,
    building.lat,
    building.baseHeight,
  );
  const frame = Cesium.Transforms.headingPitchRollToFixedFrame(
    origin,
    Cesium.HeadingPitchRoll.fromDegrees(building.headingDeg, 0, 0),
  );
  const dimensions = new Cesium.Cartesian3(
    cellX * padding,
    cellY * padding,
    cellZ * padding,
  );
  const outlineDimensions = new Cesium.Cartesian3(
    dimensions.x * 1.02,
    dimensions.y * 1.02,
    dimensions.z * 1.02,
  );
  const fillGeometry = Cesium.BoxGeometry.fromDimensions({
    dimensions,
    vertexFormat: Cesium.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
  });
  const outlineGeometry = Cesium.BoxOutlineGeometry.fromDimensions({
    dimensions: outlineDimensions,
  });
  const fillInstances: Cesium.GeometryInstance[] = [];
  const outlineInstances: Cesium.GeometryInstance[] = [];
  const roomPositions: Cesium.Cartesian3[] = [];
  const rooms: RoomMeta[] = [];
  const boxRadius = Cesium.Cartesian3.magnitude(dimensions) / 2;

  for (let floor = 0; floor < floors; floor += 1) {
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const localPosition = new Cesium.Cartesian3(
          offsetX + (col - (cols - 1) / 2) * cellX,
          offsetY + (row - (rows - 1) / 2) * cellY,
          offsetZ + floor * cellZ + cellZ / 2,
        );
        const worldPosition = Cesium.Matrix4.multiplyByPoint(
          frame,
          localPosition,
          new Cesium.Cartesian3(),
        );
        const modelMatrix = Cesium.Matrix4.multiplyByTranslation(
          frame,
          localPosition,
          new Cesium.Matrix4(),
        );
        const sequenceIndex = floor * rows * cols + row * cols + col;
        const status = patternStatus(sequenceIndex, building.statusPattern);
        const entityId = buildEntityId(building.id, floor, row, col);

        fillInstances.push(
          new Cesium.GeometryInstance({
            id: entityId,
            geometry: fillGeometry,
            modelMatrix,
            attributes: {
              color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                occupancyPalette[status],
              ),
            },
          }),
        );

        outlineInstances.push(
          new Cesium.GeometryInstance({
            id: entityId,
            geometry: outlineGeometry,
            modelMatrix,
            attributes: {
              color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                baseOutlineColor,
              ),
            },
          }),
        );

        const markerEntity = labelsSource.entities.add({
          id: `${entityId}::marker`,
          position: worldPosition,
          point: {
            pixelSize: 6,
            color:
              status === 'busy'
                ? Cesium.Color.RED
                : status === 'blocked'
                  ? Cesium.Color.ORANGE
                  : Cesium.Color.LIME,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: `${floor + 1}.${row + 1}.${col + 1}`,
            font: '12px IBM Plex Sans, sans-serif',
            fillColor: Cesium.Color.WHITE,
            pixelOffset: new Cesium.Cartesian2(0, -18),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            showBackground: true,
            backgroundColor: Cesium.Color.BLACK.withAlpha(0.55),
          },
        });

        (markerEntity as PickableEntity).parentRoom = entityId;

        roomPositions.push(worldPosition);
        rooms.push({
          id: entityId,
          buildingId: building.id,
          baseFillColor: occupancyPalette[status],
          boundingSphere: new Cesium.BoundingSphere(worldPosition, boxRadius),
        });
      }
    }
  }

  const buildingBoundingSphere = Cesium.BoundingSphere.fromPoints(roomPositions);
  buildingBoundingSphere.radius += boxRadius;

  return {
    buildingMeta: {
      boundingSphere: buildingBoundingSphere,
      radius: buildingBoundingSphere.radius,
    },
    fillInstances,
    outlineInstances,
    rooms,
  };
}

function resolveRoomIdFromPick(picked: unknown): string | null {
  if (!picked || typeof picked !== 'object' || !('id' in picked)) {
    return null;
  }

  const pickId = (picked as { id?: unknown }).id;

  if (typeof pickId === 'string') {
    return pickId;
  }

  if (pickId && typeof pickId === 'object') {
    const entity = pickId as PickableEntity;

    if (typeof entity.parentRoom === 'string') {
      return entity.parentRoom;
    }

    if (typeof entity.id === 'string') {
      return entity.id;
    }
  }

  return null;
}

export async function initializeCesiumScene(
  container: HTMLElement,
  options: InitializeSceneOptions = {},
): Promise<SceneController> {
  const googleApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  if (!googleApiKey) {
    throw new Error(
      'Defina VITE_GOOGLE_MAPS_API_KEY antes de executar o projeto ou de publicar o build.',
    );
  }

  const viewer = createViewer(container);
  styleViewer(viewer);

  try {
    const googleTiles = await Cesium.Cesium3DTileset.fromUrl(
      `https://tile.googleapis.com/v1/3dtiles/root.json?key=${googleApiKey}`,
      {
        showCreditsOnScreen: true,
        maximumScreenSpaceError: 16,
      },
    );

    googleTiles.enableCollision = false;
    viewer.scene.primitives.add(googleTiles);

    applyInitialView(viewer);

    const labelsSource = new Cesium.CustomDataSource('labels');
    viewer.dataSources.add(labelsSource);

    const roomMeta = new Map<string, RoomMeta>();
    const buildingMeta = new Map<string, BuildingMeta>();
    const fillInstances: Cesium.GeometryInstance[] = [];
    const outlineInstances: Cesium.GeometryInstance[] = [];

    for (const building of buildings) {
      const grid = createBuildingGrid(building, labelsSource);

      buildingMeta.set(building.id, grid.buildingMeta);
      fillInstances.push(...grid.fillInstances);
      outlineInstances.push(...grid.outlineInstances);

      for (const room of grid.rooms) {
        roomMeta.set(room.id, room);
      }
    }

    const fillPrimitive = viewer.scene.primitives.add(
      new Cesium.Primitive({
        geometryInstances: fillInstances,
        appearance: createPrimitiveAppearance(),
        asynchronous: false,
        allowPicking: true,
        releaseGeometryInstances: false,
      }),
    );

    const outlinePrimitive = viewer.scene.primitives.add(
      new Cesium.Primitive({
        geometryInstances: outlineInstances,
        appearance: createPrimitiveAppearance(),
        asynchronous: false,
        allowPicking: true,
        releaseGeometryInstances: false,
      }),
    );

    let hoveredRoomId: string | null = null;
    let selectedRoomId: string | null = null;

    const getFillColor = (roomId: string): Cesium.Color => {
      if (roomId === hoveredRoomId) {
        return hoverFillColor;
      }

      if (roomId === selectedRoomId) {
        return selectedFillColor;
      }

      return roomMeta.get(roomId)?.baseFillColor ?? Cesium.Color.WHITE;
    };

    const getOutlineColor = (roomId: string): Cesium.Color => {
      if (roomId === hoveredRoomId) {
        return hoverOutlineColor;
      }

      if (roomId === selectedRoomId) {
        return selectedOutlineColor;
      }

      return baseOutlineColor;
    };

    const applyRoomVisualState = (roomId: string): void => {
      if (!fillPrimitive.ready || !outlinePrimitive.ready) {
        return;
      }

      const fillAttributes = fillPrimitive.getGeometryInstanceAttributes(roomId) as
        | { color?: Uint8Array }
        | undefined;
      const outlineAttributes = outlinePrimitive.getGeometryInstanceAttributes(
        roomId,
      ) as
        | { color?: Uint8Array }
        | undefined;

      if (fillAttributes?.color) {
        fillAttributes.color = Cesium.ColorGeometryInstanceAttribute.toValue(
          getFillColor(roomId),
          fillAttributes.color,
        );
      }

      if (outlineAttributes?.color) {
        outlineAttributes.color = Cesium.ColorGeometryInstanceAttribute.toValue(
          getOutlineColor(roomId),
          outlineAttributes.color,
        );
      }
    };

    const refreshAllRooms = (): void => {
      for (const roomId of roomMeta.keys()) {
        applyRoomVisualState(roomId);
      }

      viewer.scene.requestRender();
    };

    const removeReadyListener = viewer.scene.postRender.addEventListener(() => {
      if (!fillPrimitive.ready || !outlinePrimitive.ready) {
        return;
      }

      refreshAllRooms();
      removeReadyListener();
    });

    const setHoveredRoom = (roomId: string | null): void => {
      if (hoveredRoomId === roomId) {
        return;
      }

      const previousHoveredRoomId = hoveredRoomId;
      hoveredRoomId = roomId;

      if (previousHoveredRoomId) {
        applyRoomVisualState(previousHoveredRoomId);
      }

      if (hoveredRoomId) {
        applyRoomVisualState(hoveredRoomId);
      }

      options.onRoomHovered?.(hoveredRoomId);
      viewer.scene.requestRender();
    };

    const setSelectedRoom = (roomId: string | null): void => {
      if (selectedRoomId === roomId) {
        return;
      }

      const previousSelectedRoomId = selectedRoomId;
      selectedRoomId = roomId;

      if (previousSelectedRoomId) {
        applyRoomVisualState(previousSelectedRoomId);
      }

      if (selectedRoomId) {
        applyRoomVisualState(selectedRoomId);
      }

      viewer.scene.requestRender();
    };

    const pickRoomId = (position: Cesium.Cartesian2): string | null => {
      const picked = viewer.scene.pick(position);
      return resolveRoomIdFromPick(picked);
    };

    viewer.screenSpaceEventHandler.setInputAction((movement: {
      position: Cesium.Cartesian2;
    }) => {
      const roomId = pickRoomId(movement.position);

      if (!roomId) {
        return;
      }

      setSelectedRoom(roomId);
      options.onRoomSelected?.(roomId);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    viewer.screenSpaceEventHandler.setInputAction((movement: {
      endPosition: Cesium.Cartesian2;
    }) => {
      const roomId = pickRoomId(movement.endPosition);
      setHoveredRoom(roomId);
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    const handleMouseLeave = (): void => {
      setHoveredRoom(null);
    };

    container.addEventListener('mouseleave', handleMouseLeave);

    const focusBuilding = (buildingId: string): void => {
      const building = getBuildingById(buildingId);
      const meta = buildingMeta.get(buildingId);

      if (!building || !meta) {
        return;
      }

      viewer.camera.flyToBoundingSphere(meta.boundingSphere, {
        duration: 1.15,
        offset: createHeadingPitchRange(
          initialView.heading,
          initialView.pitch,
          Math.max(meta.radius * 2.2, initialView.range),
        ),
      });
    };

    const focusRoom = async (roomId: string): Promise<void> => {
      const room = roomMeta.get(roomId);

      if (!room) {
        return;
      }

      setSelectedRoom(room.id);

      viewer.camera.flyToBoundingSphere(room.boundingSphere, {
        duration: 1.05,
        offset: createHeadingPitchRange(
          initialView.heading,
          -18,
          Math.max(room.boundingSphere.radius * 6, 18),
        ),
      });
    };

    return {
      destroy: () => {
        container.removeEventListener('mouseleave', handleMouseLeave);
        viewer.destroy();
      },
      focusBuilding,
      focusRoom,
      setBoxesVisible: (visible: boolean) => {
        fillPrimitive.show = visible;
        outlinePrimitive.show = visible;
        viewer.scene.requestRender();
      },
      setGhostMode: (enabled: boolean) => {
        googleTiles.style = enabled
          ? new Cesium.Cesium3DTileStyle({
              color: "color('white', 0.18)",
            })
          : undefined;
        viewer.scene.requestRender();
      },
      setLabelsVisible: (visible: boolean) => {
        labelsSource.show = visible;
        viewer.scene.requestRender();
      },
      setSelectedRoom: (roomId: string) => {
        setSelectedRoom(roomId || null);
      },
      setTilesVisible: (visible: boolean) => {
        googleTiles.show = visible;
        viewer.scene.requestRender();
      },
    };
  } catch (error) {
    viewer.destroy();
    throw error;
  }
}
