import * as Cesium from 'cesium';
import './style.css';

const googleApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

if (!googleApiKey) {
  throw new Error('Defina VITE_GOOGLE_MAPS_API_KEY no ambiente antes de executar o projeto.');
}

const initialView = {
  lat: -22.9780191,
  lon: -43.2316504,
  altitude: 145,
  heading: 209.6,
  pitch: -26
};

const occupancyPalette = {
  free: Cesium.Color.LIME.withAlpha(0.18),
  busy: Cesium.Color.RED.withAlpha(0.28),
  blocked: Cesium.Color.ORANGE.withAlpha(0.3)
};

const buildings = [
  {
    id: 'leme-cce-demo',
    name: 'Bloco demo CCE / Biblioteca',
    lat: -22.9780191,
    lon: -43.2316504,
    baseHeight: 21,
    headingDeg: 118,
    grid: {
      cols: 10,
      rows: 4,
      floors: 8,
      cellX: 4.3,
      cellY: 5.6,
      cellZ: 3.2,
      padding: 0.88
    },
    statusPattern: ['free', 'busy', 'free', 'blocked']
  }
];

const viewer = new Cesium.Viewer('cesiumContainer', {
  globe: false,
  imageryProvider: false,
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
  shouldAnimate: false
});

viewer.scene.skyAtmosphere.show = false;
viewer.scene.skyBox.show = false;
viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#06101d');
viewer.scene.requestRenderMode = true;
if (viewer.scene.globe) {
  viewer.scene.globe.show = false;
}
viewer.cesiumWidget.creditContainer.style.display = 'block';

const googleTiles = await Cesium.Cesium3DTileset.fromUrl(
  `https://tile.googleapis.com/v1/3dtiles/root.json?key=${googleApiKey}`,
  {
    showCreditsOnScreen: true,
    maximumScreenSpaceError: 16
  }
);

viewer.scene.primitives.add(googleTiles);
// fromUrl ja retorna o tileset pronto para uso.

viewer.camera.flyTo({
  destination: Cesium.Cartesian3.fromDegrees(
    initialView.lon,
    initialView.lat,
    initialView.altitude
  ),
  orientation: {
    heading: Cesium.Math.toRadians(initialView.heading),
    pitch: Cesium.Math.toRadians(initialView.pitch),
    roll: 0
  },
  duration: 0
});

const buildingsSource = new Cesium.CustomDataSource('buildings');
const labelsSource = new Cesium.CustomDataSource('labels');
viewer.dataSources.add(buildingsSource);
viewer.dataSources.add(labelsSource);

function patternStatus(index, pattern) {
  return pattern[index % pattern.length];
}

function buildEntityId(buildingId, floor, row, col) {
  return `${buildingId}::F${String(floor + 1).padStart(2, '0')}::R${row + 1}::C${col + 1}`;
}

function createBuildingGrid(building) {
  const { cols, rows, floors, cellX, cellY, cellZ, padding } = building.grid;
  const origin = Cesium.Cartesian3.fromDegrees(building.lon, building.lat, building.baseHeight);
  const frame = Cesium.Transforms.headingPitchRollToFixedFrame(
    origin,
    Cesium.HeadingPitchRoll.fromDegrees(building.headingDeg, 0, 0)
  );

  const roomIds = [];

  for (let floor = 0; floor < floors; floor += 1) {
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const localPosition = new Cesium.Cartesian3(
          (col - (cols - 1) / 2) * cellX,
          (row - (rows - 1) / 2) * cellY,
          floor * cellZ + cellZ / 2
        );

        const worldPosition = Cesium.Matrix4.multiplyByPoint(
          frame,
          localPosition,
          new Cesium.Cartesian3()
        );

        const sequenceIndex = floor * rows * cols + row * cols + col;
        const status = patternStatus(sequenceIndex, building.statusPattern);
        const entityId = buildEntityId(building.id, floor, row, col);
        roomIds.push(entityId);

        buildingsSource.entities.add({
          id: entityId,
          name: `${building.name} - ${entityId.split('::').slice(1).join(' ')}`,
          buildingId: building.id,
          roomStatus: status,
          position: worldPosition,
          box: {
            dimensions: new Cesium.Cartesian3(cellX * padding, cellY * padding, cellZ * padding),
            material: occupancyPalette[status],
            outline: true,
            outlineColor: Cesium.Color.WHITE.withAlpha(0.24)
          },
          properties: {
            buildingId: building.id,
            floor: floor + 1,
            row: row + 1,
            col: col + 1,
            status
          }
        });

        labelsSource.entities.add({
          id: `${entityId}::marker`,
          parentRoom: entityId,
          position: worldPosition,
          point: {
            pixelSize: 6,
            color: status === 'busy' ? Cesium.Color.RED : status === 'blocked' ? Cesium.Color.ORANGE : Cesium.Color.LIME,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
          },
          label: {
            text: `${floor + 1}.${row + 1}.${col + 1}`,
            font: '12px sans-serif',
            fillColor: Cesium.Color.WHITE,
            pixelOffset: new Cesium.Cartesian2(0, -18),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            showBackground: true,
            backgroundColor: Cesium.Color.BLACK.withAlpha(0.55)
          }
        });
      }
    }
  }

  const centerPosition = Cesium.Matrix4.multiplyByPoint(
    frame,
    new Cesium.Cartesian3(0, 0, (floors * cellZ) / 2),
    new Cesium.Cartesian3()
  );

  return {
    roomIds,
    centerPosition,
    radius: Math.max(cols * cellX, rows * cellY, floors * cellZ) * 1.2
  };
}

const buildingMeta = new Map();
for (const building of buildings) {
  buildingMeta.set(building.id, createBuildingGrid(building));
}

const buildingSelect = document.getElementById('buildingSelect');
const roomSelect = document.getElementById('roomSelect');
const toggleBoxes = document.getElementById('toggleBoxes');
const toggleLabels = document.getElementById('toggleLabels');
const toggleTiles = document.getElementById('toggleTiles');
const toggleGhost = document.getElementById('toggleGhost');
const focusBuildingButton = document.getElementById('focusBuilding');
const focusRoomButton = document.getElementById('focusRoom');

for (const building of buildings) {
  const option = document.createElement('option');
  option.value = building.id;
  option.textContent = building.name;
  buildingSelect.appendChild(option);
}

function populateRooms(buildingId) {
  const meta = buildingMeta.get(buildingId);
  roomSelect.innerHTML = '';

  for (const roomId of meta.roomIds) {
    const entity = buildingsSource.entities.getById(roomId);
    const option = document.createElement('option');
    option.value = roomId;
    option.textContent = `${entity.properties.floor.getValue()}º andar - linha ${entity.properties.row.getValue()} - coluna ${entity.properties.col.getValue()} (${entity.properties.status.getValue()})`;
    roomSelect.appendChild(option);
  }
}

populateRooms(buildings[0].id);

function focusBuilding(buildingId) {
  const meta = buildingMeta.get(buildingId);
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      buildings.find((item) => item.id === buildingId).lon,
      buildings.find((item) => item.id === buildingId).lat,
      meta.radius * 4
    ),
    orientation: {
      heading: Cesium.Math.toRadians(initialView.heading),
      pitch: Cesium.Math.toRadians(-28),
      roll: 0
    },
    duration: 1.2
  });
}

async function focusRoom(roomId) {
  const entity = buildingsSource.entities.getById(roomId);
  if (!entity) return;

  await viewer.flyTo(entity, {
    duration: 1.2,
    offset: new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(214),
      Cesium.Math.toRadians(-0.42),
      26
    )
  });

  viewer.selectedEntity = entity;
}

buildingSelect.addEventListener('change', (event) => {
  populateRooms(event.target.value);
});

toggleBoxes.addEventListener('change', (event) => {
  buildingsSource.show = event.target.checked;
  viewer.scene.requestRender();
});

toggleLabels.addEventListener('change', (event) => {
  labelsSource.show = event.target.checked;
  viewer.scene.requestRender();
});

toggleTiles.addEventListener('change', (event) => {
  googleTiles.show = event.target.checked;
  viewer.scene.requestRender();
});

toggleGhost.addEventListener('change', (event) => {
  if (event.target.checked) {
    googleTiles.style = new Cesium.Cesium3DTileStyle({
      color: "color('white', 0.22)"
    });
  } else {
    googleTiles.style = undefined;
  }
  viewer.scene.requestRender();
});

focusBuildingButton.addEventListener('click', () => {
  focusBuilding(buildingSelect.value);
});

focusRoomButton.addEventListener('click', () => {
  focusRoom(roomSelect.value);
});

viewer.screenSpaceEventHandler.setInputAction((movement) => {
  const picked = viewer.scene.pick(movement.position);
  if (!Cesium.defined(picked) || !picked.id) return;

  const pickedId = picked.id.parentRoom ?? picked.id.id;
  const entity = buildingsSource.entities.getById(pickedId);
  if (!entity) return;

  roomSelect.value = pickedId;
  viewer.selectedEntity = entity;
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);
