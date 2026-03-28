export interface InitialView {
  lat: number;
  lon: number;
  centerAltitude: number;
  fov: number;
  heading: number;
  range: number;
  tilt: number;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface BoxConfig {
  id: string;
  position: {
    altitude: number;
    lat: number;
    lng: number;
  };
  rotation: Vector3;
  scale: Vector3;
}

export const initialView: InitialView = {
  lat: -22.9789793,
  lon: -43.2320437,
  centerAltitude: 46.19,
  fov: 35,
  heading: -135.91,
  range: 118.62,
  tilt: 72.07,
};

export const initialBoxes: BoxConfig[] = [];

export function createBoxId(): string {
  return `box-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
}

export function cloneBoxConfig(box: BoxConfig): BoxConfig {
  return {
    ...box,
    position: {
      ...box.position,
    },
    rotation: {
      ...box.rotation,
    },
    scale: {
      ...box.scale,
    },
  };
}

export function cloneBoxesConfig(
  sourceBoxes: BoxConfig[] = initialBoxes,
): BoxConfig[] {
  return sourceBoxes.map(cloneBoxConfig);
}

export function getBoxById(
  boxId: string,
  sourceBoxes: BoxConfig[] = initialBoxes,
): BoxConfig | undefined {
  return sourceBoxes.find((box) => box.id === boxId);
}
