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
  free: Cesium.Color.LIME.withAlpha(0.18),
  busy: Cesium.Color.RED.withAlpha(0.28),
  blocked: Cesium.Color.ORANGE.withAlpha(0.3),
};

interface BuildingMeta {
  radius: number;
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
  setTilesVisible: (visible: boolean) => void;
}

interface InitializeSceneOptions {
  onRoomSelected?: (roomId: string) => void;
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
    selectionIndicator: true,
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

  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#06101d');
  viewer.scene.requestRenderMode = true;

  if (viewer.scene.globe) {
    viewer.scene.globe.show = false;
  }

  (viewer.cesiumWidget.creditContainer as HTMLElement).style.display = 'block';
}

function createBuildingGrid(
  building: BuildingConfig,
  buildingsSource: Cesium.CustomDataSource,
  labelsSource: Cesium.CustomDataSource,
): BuildingMeta {
  const { cols, rows, floors, cellX, cellY, cellZ, padding } = building.grid;
  const origin = Cesium.Cartesian3.fromDegrees(
    building.lon,
    building.lat,
    building.baseHeight,
  );
  const frame = Cesium.Transforms.headingPitchRollToFixedFrame(
    origin,
    Cesium.HeadingPitchRoll.fromDegrees(building.headingDeg, 0, 0),
  );

  for (let floor = 0; floor < floors; floor += 1) {
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const localPosition = new Cesium.Cartesian3(
          (col - (cols - 1) / 2) * cellX,
          (row - (rows - 1) / 2) * cellY,
          floor * cellZ + cellZ / 2,
        );

        const worldPosition = Cesium.Matrix4.multiplyByPoint(
          frame,
          localPosition,
          new Cesium.Cartesian3(),
        );

        const sequenceIndex = floor * rows * cols + row * cols + col;
        const status = patternStatus(sequenceIndex, building.statusPattern);
        const entityId = buildEntityId(building.id, floor, row, col);

        buildingsSource.entities.add({
          id: entityId,
          name: `${building.name} - ${entityId.split('::').slice(1).join(' ')}`,
          position: worldPosition,
          box: {
            dimensions: new Cesium.Cartesian3(
              cellX * padding,
              cellY * padding,
              cellZ * padding,
            ),
            material: occupancyPalette[status],
            outline: true,
            outlineColor: Cesium.Color.WHITE.withAlpha(0.24),
          },
          properties: {
            buildingId: building.id,
            floor: floor + 1,
            row: row + 1,
            col: col + 1,
            status,
          },
        });

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
            font: '12px sans-serif',
            fillColor: Cesium.Color.WHITE,
            pixelOffset: new Cesium.Cartesian2(0, -18),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            showBackground: true,
            backgroundColor: Cesium.Color.BLACK.withAlpha(0.55),
          },
        });

        (markerEntity as PickableEntity).parentRoom = entityId;
      }
    }
  }

  return {
    radius: Math.max(cols * cellX, rows * cellY, floors * cellZ) * 1.2,
  };
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

    viewer.scene.primitives.add(googleTiles);

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        initialView.lon,
        initialView.lat,
        initialView.altitude,
      ),
      orientation: {
        heading: Cesium.Math.toRadians(initialView.heading),
        pitch: Cesium.Math.toRadians(initialView.pitch),
        roll: 0,
      },
      duration: 0,
    });

    const buildingsSource = new Cesium.CustomDataSource('buildings');
    const labelsSource = new Cesium.CustomDataSource('labels');
    viewer.dataSources.add(buildingsSource);
    viewer.dataSources.add(labelsSource);

    const buildingMeta = new Map<string, BuildingMeta>();

    for (const building of buildings) {
      buildingMeta.set(
        building.id,
        createBuildingGrid(building, buildingsSource, labelsSource),
      );
    }

    const focusBuilding = (buildingId: string): void => {
      const building = getBuildingById(buildingId);
      const meta = buildingMeta.get(buildingId);

      if (!building || !meta) {
        return;
      }

      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          building.lon,
          building.lat,
          meta.radius * 4,
        ),
        orientation: {
          heading: Cesium.Math.toRadians(initialView.heading),
          pitch: Cesium.Math.toRadians(-28),
          roll: 0,
        },
        duration: 1.2,
      });
    };

    const focusRoom = async (roomId: string): Promise<void> => {
      const entity = buildingsSource.entities.getById(roomId);

      if (!entity) {
        return;
      }

      await viewer.flyTo(entity, {
        duration: 1.2,
        offset: new Cesium.HeadingPitchRange(
          Cesium.Math.toRadians(214),
          Cesium.Math.toRadians(-0.42),
          26,
        ),
      });

      viewer.selectedEntity = entity;
    };

    viewer.screenSpaceEventHandler.setInputAction((movement: {
      position: Cesium.Cartesian2;
    }) => {
      const picked = viewer.scene.pick(movement.position);

      if (!Cesium.defined(picked) || !picked?.id) {
        return;
      }

      const pickedEntity = picked.id as PickableEntity;
      const pickedId = pickedEntity.parentRoom ?? String(pickedEntity.id ?? '');
      const entity = buildingsSource.entities.getById(pickedId);

      if (!entity) {
        return;
      }

      viewer.selectedEntity = entity;
      options.onRoomSelected?.(pickedId);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    return {
      destroy: () => {
        viewer.destroy();
      },
      focusBuilding,
      focusRoom,
      setBoxesVisible: (visible: boolean) => {
        buildingsSource.show = visible;
        viewer.scene.requestRender();
      },
      setGhostMode: (enabled: boolean) => {
        googleTiles.style = enabled
          ? new Cesium.Cesium3DTileStyle({
              color: "color('white', 0.22)",
            })
          : undefined;
        viewer.scene.requestRender();
      },
      setLabelsVisible: (visible: boolean) => {
        labelsSource.show = visible;
        viewer.scene.requestRender();
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
