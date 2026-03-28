# PUC-Rio 3D Overlay

Protótipo estático em React + TypeScript para sobrepor caixas 3D representando salas/ocupação sobre o cenário fotorealista do Google em 3D.

## Stack

- React 19
- TypeScript
- Vite
- CesiumJS
- Google Photorealistic 3D Tiles
- GitHub Pages via GitHub Actions

## Pré-requisitos

1. Criar uma API key do Google Maps Platform com acesso à Map Tiles API / Photorealistic 3D Tiles.
2. Restringir a chave por domínio/referrer.
3. Definir a variável `VITE_GOOGLE_MAPS_API_KEY`.

## Rodar localmente

```bash
pnpm install
cp .env.example .env.local
# defina VITE_GOOGLE_MAPS_API_KEY
pnpm dev
```

Para desenvolvimento local, o projeto lê `VITE_GOOGLE_MAPS_API_KEY` de `.env.local`. O arquivo `.env.example` já está incluído como referência.

## Deploy no GitHub Pages

1. No repositório do GitHub, vá em `Settings > Pages`.
2. Em `Build and deployment > Source`, selecione `GitHub Actions`.
3. Garanta que exista o secret `VITE_GOOGLE_MAPS_API_KEY` em `Settings > Secrets and variables > Actions`.
4. Faça push para `main` ou `master`.
5. O workflow `.github/workflows/deploy.yml` vai publicar o conteúdo de `dist` no GitHub Pages.

Se a URL publicada estiver servindo um `index.html` com `<script type="module" src="/src/main.tsx">`, o GitHub Pages ainda está apontando para a raiz do repositório em vez do artifact gerado pelo workflow.

## Restrição da chave do Google

Mesmo usando secret no Actions, a chave fica embutida no bundle final do frontend. Portanto, trate essa chave como pública e restrinja por HTTP referrer no Google Cloud.

Referrers recomendados:

- `https://<seu-usuario>.github.io/*`
- `https://<seu-dominio-customizado>/*` se houver domínio próprio

## O que já existe

- Toggle de caixas
- Toggle de labels/marcadores
- Toggle do tileset do Google
- Modo “raio-X” por transparência no tileset
- Foco em bloco
- Foco em sala
- Grade paramétrica de cubos por prédio

## Onde calibrar

Ajuste o array `buildings` em `src/config.ts`:

- `lat`, `lon`
- `baseHeight`
- `headingDeg`
- `cols`, `rows`, `floors`
- `cellX`, `cellY`, `cellZ`

## Observação importante

Este projeto usa o Google 3D como contexto visual. Não trate a geometria do Google como um asset exportável próprio.
