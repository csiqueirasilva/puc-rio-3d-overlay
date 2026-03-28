# PUC-Rio 3D Overlay

Protótipo estático para sobrepor caixas 3D representando salas/ocupação sobre o cenário fotorealista do Google em 3D.

## Stack

- Vite
- CesiumJS
- Google Photorealistic 3D Tiles
- Deploy estático em Netlify

## Pré-requisitos

1. Criar uma API key do Google Maps Platform com acesso à Map Tiles API / Photorealistic 3D Tiles.
2. Restringir a chave por domínio/referrer.
3. Definir a variável `VITE_GOOGLE_MAPS_API_KEY`.

## Rodar localmente

```bash
npm install
cp .env.example .env
# editar .env
npm run dev
```

## Deploy no Netlify

1. Envie esta pasta para um repositório Git.
2. No Netlify, crie um novo site a partir do repositório.
3. Defina a variável de ambiente `VITE_GOOGLE_MAPS_API_KEY`.
4. Build command: `npm run build`
5. Publish directory: `dist`

O arquivo `netlify.toml` já está pronto.

## O que já existe

- Toggle de caixas
- Toggle de labels/marcadores
- Toggle do tileset do Google
- Modo “raio-X” por transparência no tileset
- Foco em bloco
- Foco em sala
- Grade paramétrica de cubos por prédio

## Onde calibrar

Ajuste o array `buildings` em `src/main.js`:

- `lat`, `lon`
- `baseHeight`
- `headingDeg`
- `cols`, `rows`, `floors`
- `cellX`, `cellY`, `cellZ`

## Observação importante

Este projeto usa o Google 3D como contexto visual. Não trate a geometria do Google como um asset exportável próprio.
