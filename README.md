# PUC-Rio 3D Overlay

Protótipo em React + TypeScript para sobrepor salas interativas sobre o cenário 3D fotorealista do Google Maps.

## Stack

- React 19
- TypeScript
- Vite
- Google Maps JavaScript API
- Google Maps 3D (`Map3DElement`, canal `v=beta`)

## Pré-requisitos

1. Criar uma API key do Google Maps Platform.
2. Habilitar `Maps JavaScript API`.
3. Garantir acesso aos recursos 3D do Maps JavaScript API.
4. Restringir a chave por domínio/referrer.
5. Definir a variável `VITE_GOOGLE_MAPS_API_KEY`.

## Rodar localmente

```bash
pnpm install
cp .env.example .env.local
# defina VITE_GOOGLE_MAPS_API_KEY
pnpm dev
```

## O que existe agora

- Mapa 3D nativo do Google
- Câmera inicial baseada no link de referência
- Opção de travar a câmera para impedir drift
- Grade paramétrica de salas por prédio
- Seleção por clique
- Hover visual por tentativa de eventos do elemento 3D

## Onde calibrar

Ajuste o array `buildings` e a `initialView` em `src/config.ts`:

- `lat`, `lon`
- `baseHeight`
- `headingDeg`
- `offsetX`, `offsetY`, `offsetZ`
- `cellX`, `cellY`, `cellZ`
- `heading`, `tilt`, `range`, `fov`

## Limitação importante

Esta migração privilegia a câmera nativa do Google Maps 3D. O overlay atual usa polígonos 3D interativos com transparência e oclusão visível, não materiais tipo `depthTest = false` do Cesium.
