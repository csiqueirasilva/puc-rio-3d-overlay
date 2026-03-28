import { initialView } from './config';

export interface LatLngAltitude {
  altitude: number;
  lat: number;
  lng: number;
}

export interface CameraState {
  center: LatLngAltitude;
  fov: number;
  heading: number;
  range: number;
  tilt: number;
}

const cameraParamKeys = {
  altitude: 'camAlt',
  fov: 'camFov',
  heading: 'camHeading',
  lat: 'camLat',
  lng: 'camLng',
  range: 'camRange',
  tilt: 'camTilt',
} as const;

export const noCacheParamKey = 'noCache';
export const cacheBustParamKey = '_ts';

function readNumber(searchParams: URLSearchParams, key: string): number | null {
  const value = searchParams.get(key);

  if (value === null) {
    return null;
  }

  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function formatNumber(value: number, fractionDigits: number): string {
  return value.toFixed(fractionDigits);
}

function getUrl(currentHref: string = window.location.href): URL {
  return new URL(currentHref, window.location.origin);
}

export function getDefaultCameraState(): CameraState {
  return {
    center: {
      lat: initialView.lat,
      lng: initialView.lon,
      altitude: initialView.centerAltitude,
    },
    fov: initialView.fov,
    heading: initialView.heading,
    range: initialView.range,
    tilt: initialView.tilt,
  };
}

export function parseCameraStateFromUrl(
  currentHref: string = window.location.href,
): CameraState | null {
  const url = getUrl(currentHref);
  const lat = readNumber(url.searchParams, cameraParamKeys.lat);
  const lng = readNumber(url.searchParams, cameraParamKeys.lng);
  const altitude = readNumber(url.searchParams, cameraParamKeys.altitude);
  const heading = readNumber(url.searchParams, cameraParamKeys.heading);
  const tilt = readNumber(url.searchParams, cameraParamKeys.tilt);
  const range = readNumber(url.searchParams, cameraParamKeys.range);
  const fov = readNumber(url.searchParams, cameraParamKeys.fov);

  if (
    lat === null ||
    lng === null ||
    altitude === null ||
    heading === null ||
    tilt === null ||
    range === null ||
    fov === null
  ) {
    return null;
  }

  return {
    center: {
      lat,
      lng,
      altitude,
    },
    fov,
    heading,
    range,
    tilt,
  };
}

export function parseNoCacheFromUrl(
  currentHref: string = window.location.href,
): boolean {
  return getUrl(currentHref).searchParams.get(noCacheParamKey) === '1';
}

export function buildUrlWithCameraState(
  cameraState: CameraState,
  currentHref: string = window.location.href,
): string {
  const url = getUrl(currentHref);

  url.searchParams.set(
    cameraParamKeys.lat,
    formatNumber(cameraState.center.lat, 7),
  );
  url.searchParams.set(
    cameraParamKeys.lng,
    formatNumber(cameraState.center.lng, 7),
  );
  url.searchParams.set(
    cameraParamKeys.altitude,
    formatNumber(cameraState.center.altitude, 2),
  );
  url.searchParams.set(
    cameraParamKeys.heading,
    formatNumber(cameraState.heading, 2),
  );
  url.searchParams.set(cameraParamKeys.tilt, formatNumber(cameraState.tilt, 2));
  url.searchParams.set(
    cameraParamKeys.range,
    formatNumber(cameraState.range, 2),
  );
  url.searchParams.set(cameraParamKeys.fov, formatNumber(cameraState.fov, 2));

  return url.toString();
}

export function buildUrlWithNoCache(
  enabled: boolean,
  currentHref: string = window.location.href,
): string {
  const url = getUrl(currentHref);

  if (enabled) {
    url.searchParams.set(noCacheParamKey, '1');
  } else {
    url.searchParams.delete(noCacheParamKey);
    url.searchParams.delete(cacheBustParamKey);
  }

  return url.toString();
}

export function buildNoCacheReloadUrl(
  enabled: boolean,
  currentHref: string = window.location.href,
): string {
  const url = new URL(buildUrlWithNoCache(enabled, currentHref));

  if (enabled) {
    url.searchParams.set(cacheBustParamKey, String(Date.now()));
  }

  return url.toString();
}

export function replaceUrlWithCameraState(cameraState: CameraState): string {
  const nextUrl = buildUrlWithCameraState(cameraState);
  window.history.replaceState(window.history.state, '', nextUrl);
  return nextUrl;
}
