export type RoomStatus = 'free' | 'busy' | 'blocked';

export interface InitialView {
  lat: number;
  lon: number;
  targetHeight: number;
  range: number;
  heading: number;
  pitch: number;
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
  lat: -22.9779118,
  lon: -43.231122,
  targetHeight: 24,
  range: 96,
  heading: 217.91,
  pitch: -21.75,
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

export function getBuildingById(buildingId: string): BuildingConfig | undefined {
  return buildings.find((building) => building.id === buildingId);
}

export function getRoomsForBuilding(buildingId: string): RoomOption[] {
  const building = getBuildingById(buildingId);

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

export function getRoomById(roomId: string): RoomOption | undefined {
  const buildingId = getBuildingIdFromRoomId(roomId);
  return getRoomsForBuilding(buildingId).find((room) => room.id === roomId);
}
