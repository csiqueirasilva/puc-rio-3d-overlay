export type RoomStatus = 'free' | 'busy' | 'blocked';

export interface InitialView {
  lat: number;
  lon: number;
  centerAltitude: number;
  fov: number;
  heading: number;
  range: number;
  tilt: number;
}

export interface BuildingGridConfig {
  cols: number;
  rows: number;
  floors: number;
  cellX: number;
  cellY: number;
  cellZ: number;
  padding: number;
  offsetX?: number;
  offsetY?: number;
  offsetZ?: number;
}

export interface BuildingConfig {
  id: string;
  name: string;
  lat: number;
  lon: number;
  baseHeight: number;
  headingDeg: number;
  grid: BuildingGridConfig;
  statusPattern: RoomStatus[];
}

export interface RoomOption {
  id: string;
  buildingId: string;
  floor: number;
  row: number;
  col: number;
  status: RoomStatus;
  label: string;
}

const statusLabels: Record<RoomStatus, string> = {
  free: 'Livre',
  busy: 'Ocupado',
  blocked: 'Bloqueado',
};

export const initialView: InitialView = {
  lat: -22.9789793,
  lon: -43.2320437,
  centerAltitude: 46.19,
  fov: 35,
  heading: -135.91,
  range: 118.62,
  tilt: 72.07,
};

export const buildings: BuildingConfig[] = [
  {
    id: 'leme-cce-demo',
    name: 'Bloco demo CCE / Biblioteca',
    lat: -22.9779118,
    lon: -43.231122,
    baseHeight: 18,
    headingDeg: 118,
    grid: {
      cols: 10,
      rows: 4,
      floors: 8,
      cellX: 4.3,
      cellY: 5.6,
      cellZ: 3.2,
      padding: 0.88,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
    },
    statusPattern: ['free', 'busy', 'free', 'blocked'],
  },
];

export function cloneBuildingConfig(building: BuildingConfig): BuildingConfig {
  return {
    ...building,
    grid: {
      ...building.grid,
    },
    statusPattern: [...building.statusPattern],
  };
}

export function cloneBuildingsConfig(
  sourceBuildings: BuildingConfig[] = buildings,
): BuildingConfig[] {
  return sourceBuildings.map(cloneBuildingConfig);
}

export function patternStatus(index: number, pattern: RoomStatus[]): RoomStatus {
  return pattern[index % pattern.length] ?? 'free';
}

export function buildEntityId(
  buildingId: string,
  floor: number,
  row: number,
  col: number,
): string {
  return `${buildingId}::F${String(floor + 1).padStart(2, '0')}::R${row + 1}::C${col + 1}`;
}

export function getBuildingIdFromRoomId(roomId: string): string {
  return roomId.split('::')[0] ?? '';
}

export function getBuildingById(
  buildingId: string,
  sourceBuildings: BuildingConfig[] = buildings,
): BuildingConfig | undefined {
  return sourceBuildings.find((building) => building.id === buildingId);
}

export function getRoomsForBuilding(
  buildingId: string,
  sourceBuildings: BuildingConfig[] = buildings,
): RoomOption[] {
  const building = getBuildingById(buildingId, sourceBuildings);

  if (!building) {
    return [];
  }

  const { cols, rows, floors } = building.grid;
  const rooms: RoomOption[] = [];

  for (let floor = 0; floor < floors; floor += 1) {
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const sequenceIndex = floor * rows * cols + row * cols + col;
        const status = patternStatus(sequenceIndex, building.statusPattern);
        const id = buildEntityId(building.id, floor, row, col);

        rooms.push({
          id,
          buildingId: building.id,
          floor: floor + 1,
          row: row + 1,
          col: col + 1,
          status,
          label: `${floor + 1}º andar - linha ${row + 1} - coluna ${col + 1} (${statusLabels[status]})`,
        });
      }
    }
  }

  return rooms;
}

export function getRoomById(
  roomId: string,
  sourceBuildings: BuildingConfig[] = buildings,
): RoomOption | undefined {
  const buildingId = getBuildingIdFromRoomId(roomId);
  return getRoomsForBuilding(buildingId, sourceBuildings).find(
    (room) => room.id === roomId,
  );
}
