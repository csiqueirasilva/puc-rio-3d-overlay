import { parseNoCacheFromUrl } from './cameraUrlState';

declare global {
  interface Window {
    __initGoogleMaps3D?: () => void;
    google?: {
      maps?: {
        importLibrary?: (libraryName: string) => Promise<unknown>;
      };
    };
  }
}

type GoogleMaps3DLibrary = {
  Map3DElement: new (options?: Record<string, unknown>) => HTMLElement;
  Polygon3DInteractiveElement: new (
    options?: Record<string, unknown>,
  ) => HTMLElement;
  Polyline3DInteractiveElement: new (
    options?: Record<string, unknown>,
  ) => HTMLElement;
};

let googleMapsLoadPromise: Promise<GoogleMaps3DLibrary> | null = null;

function ensureGoogleMapsScript(apiKey: string): Promise<void> {
  if (window.google?.maps?.importLibrary) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-google-maps-3d-loader="true"]',
    );

    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener(
        'error',
        () => reject(new Error('Falha ao carregar o Google Maps JavaScript API.')),
        { once: true },
      );
      return;
    }

    const script = document.createElement('script');
    const params = new URLSearchParams({
      key: apiKey,
      v: 'beta',
      loading: 'async',
      libraries: 'maps3d',
      callback: '__initGoogleMaps3D',
      language: 'pt-BR',
      region: 'BR',
    });

    if (parseNoCacheFromUrl()) {
      params.set('cacheBust', String(Date.now()));
    }

    script.async = true;
    script.defer = true;
    script.dataset.googleMaps3dLoader = 'true';
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.onerror = () => {
      reject(new Error('Falha ao carregar o Google Maps JavaScript API.'));
    };

    window.__initGoogleMaps3D = () => {
      resolve();
      delete window.__initGoogleMaps3D;
    };

    document.head.append(script);
  });
}

export async function loadGoogleMaps3D(): Promise<GoogleMaps3DLibrary> {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    throw new Error(
      'Defina VITE_GOOGLE_MAPS_API_KEY com acesso ao Maps JavaScript API 3D antes de executar o projeto.',
    );
  }

  if (!googleMapsLoadPromise) {
    googleMapsLoadPromise = ensureGoogleMapsScript(apiKey).then(async () => {
      const mapsImportLibrary = window.google?.maps?.importLibrary;

      if (!mapsImportLibrary) {
        throw new Error(
          'O carregador do Google Maps foi inicializado sem importLibrary.',
        );
      }

      return (await mapsImportLibrary('maps3d')) as GoogleMaps3DLibrary;
    });
  }

  return googleMapsLoadPromise;
}
