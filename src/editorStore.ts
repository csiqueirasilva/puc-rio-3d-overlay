import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { parseNoCacheFromUrl } from './cameraUrlState';
import { cloneBoxConfig, cloneBoxesConfig, initialBoxes, type BoxConfig } from './config';

export type PlacementMode = 'idle' | 'placing-space';
export type SelectionSource = 'scene' | 'sidebar' | 'system';

export interface ContextMenuState {
  targetSpaceId: string | null;
  x: number;
  y: number;
}

interface EditorState {
  boxes: BoxConfig[];
  cameraLocked: boolean;
  contextMenu: ContextMenuState | null;
  followCameraWithSpace: boolean;
  focusRequestSpaceId: string | null;
  hoveredSpaceId: string | null;
  noCache: boolean;
  placementMode: PlacementMode;
  selectedSpaceId: string | null;
  addSpace: (box: BoxConfig) => void;
  armPlacementMode: () => void;
  clearFocusRequest: () => void;
  clearPlacementMode: () => void;
  closeContextMenu: () => void;
  openContextMenu: (contextMenu: ContextMenuState) => void;
  removeSpace: (boxId: string) => void;
  selectSpace: (boxId: string | null, source?: SelectionSource) => void;
  setBoxes: (boxes: BoxConfig[]) => void;
  setCameraLocked: (locked: boolean) => void;
  setFollowCameraWithSpace: (enabled: boolean) => void;
  setHoveredSpaceId: (boxId: string | null) => void;
  setNoCache: (enabled: boolean) => void;
  updateSpace: (
    boxId: string,
    updater: (box: BoxConfig) => BoxConfig,
  ) => void;
}

function normalizeBoxes(boxes: BoxConfig[]): BoxConfig[] {
  return cloneBoxesConfig(boxes).map((box) => ({
    ...cloneBoxConfig(box),
    name: box.name?.trim() ? box.name.trim() : box.id,
  }));
}

function createInitialState() {
  return {
    boxes: normalizeBoxes(initialBoxes),
    cameraLocked: false,
    contextMenu: null,
    followCameraWithSpace: false,
    focusRequestSpaceId: null,
    hoveredSpaceId: null,
    noCache: parseNoCacheFromUrl(),
    placementMode: 'idle' as PlacementMode,
    selectedSpaceId: null,
  };
}

export const useEditorStore = create<EditorState>()(
  subscribeWithSelector((set) => ({
    ...createInitialState(),
    addSpace: (box) =>
      set((state) => ({
        boxes: [...state.boxes, cloneBoxConfig(box)],
      })),
    armPlacementMode: () =>
      set(() => ({
        contextMenu: null,
        placementMode: 'placing-space',
      })),
    clearFocusRequest: () =>
      set(() => ({
        focusRequestSpaceId: null,
      })),
    clearPlacementMode: () =>
      set(() => ({
        placementMode: 'idle',
      })),
    closeContextMenu: () =>
      set(() => ({
        contextMenu: null,
      })),
    openContextMenu: (contextMenu) =>
      set(() => ({
        contextMenu,
      })),
    removeSpace: (boxId) =>
      set((state) => ({
        boxes: state.boxes.filter((box) => box.id !== boxId),
        contextMenu:
          state.contextMenu?.targetSpaceId === boxId ? null : state.contextMenu,
        focusRequestSpaceId:
          state.focusRequestSpaceId === boxId ? null : state.focusRequestSpaceId,
        hoveredSpaceId:
          state.hoveredSpaceId === boxId ? null : state.hoveredSpaceId,
        selectedSpaceId:
          state.selectedSpaceId === boxId ? null : state.selectedSpaceId,
      })),
    selectSpace: (boxId, source = 'scene') =>
      set(() => ({
        contextMenu: null,
        focusRequestSpaceId: source === 'sidebar' ? boxId : null,
        selectedSpaceId: boxId,
      })),
    setBoxes: (boxes) =>
      set((state) => {
        const normalizedBoxes = normalizeBoxes(boxes);
        const availableIds = new Set(normalizedBoxes.map((box) => box.id));

        return {
          boxes: normalizedBoxes,
          contextMenu:
            state.contextMenu && state.contextMenu.targetSpaceId
              ? availableIds.has(state.contextMenu.targetSpaceId)
                ? state.contextMenu
                : null
              : state.contextMenu,
          focusRequestSpaceId:
            state.focusRequestSpaceId && availableIds.has(state.focusRequestSpaceId)
              ? state.focusRequestSpaceId
              : null,
          hoveredSpaceId:
            state.hoveredSpaceId && availableIds.has(state.hoveredSpaceId)
              ? state.hoveredSpaceId
              : null,
          selectedSpaceId:
            state.selectedSpaceId && availableIds.has(state.selectedSpaceId)
              ? state.selectedSpaceId
              : null,
        };
      }),
    setCameraLocked: (locked) =>
      set(() => ({
        cameraLocked: locked,
      })),
    setFollowCameraWithSpace: (enabled) =>
      set(() => ({
        followCameraWithSpace: enabled,
      })),
    setHoveredSpaceId: (boxId) =>
      set(() => ({
        hoveredSpaceId: boxId,
      })),
    setNoCache: (enabled) =>
      set(() => ({
        noCache: enabled,
      })),
    updateSpace: (boxId, updater) =>
      set((state) => ({
        boxes: state.boxes.map((box) =>
          box.id === boxId ? updater(cloneBoxConfig(box)) : box,
        ),
      })),
  })),
);

export const editorStore = useEditorStore;
