/**
 * Gera a imagem de preview (og:image) a partir do `event.ts` — task 16 §2.3.
 *
 *   npm run og
 *
 * A data estava DESENHADA num PNG feito à mão, e quando o casamento mudou de dia a imagem
 * ficou para trás. Agora a data sai do mesmo `EVENTO.quando` que o resto do site.
 *
 * Como: monta um HTML 1200×630 (logo em path, data e local em Inter) e tira o screenshot
 * com o Chrome headless. Não usa `sharp` com SVG porque o librsvg ignora `@font-face` e a
 * linha da data sairia em fonte de sistema.
 *
 * O arquivo sai com a data no nome (`og-AAAA-MM-DD.png`): o WhatsApp guarda o preview pela
 * URL da imagem, e uma URL nova é o único jeito confiável de invalidar esse cache. O
 * `Base.astro` monta o mesmo nome a partir do `EVENTO.quando`. Rodar à mão quando a data,
 * o local ou a marca mudarem, e commitar o PNG. Não roda no CI.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { Launcher } from 'chrome-launcher';
import { EVENTO, dataSemDiaDaSemana, ogImagemArquivo } from '../src/data/event.ts';

const RAIZ = path.resolve(import.meta.dirname, '..');
const DESTINO = path.join(RAIZ, 'public', ogImagemArquivo());

const ESTADOS = { PA: 'Pará' };
const estado = ESTADOS[EVENTO.local.uf] ?? EVENTO.local.uf;

// Paleta da task 02. A linha do local é o creme a 75% sobre o oliva, como na imagem original.
const OLIVA = '#48492A';
const CREME = '#F7F1EB';
const LARANJA = '#F0994A';

const logo = fs
    .readFileSync(path.join(RAIZ, 'src/assets/marca/logo-reduzido.svg'), 'utf8')
    .replace('var(--logo-amp, #F0994A)', LARANJA)
    .replace('var(--logo-texto, #48492A)', CREME);

const inter = pathToFileURL(
    path.join(RAIZ, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'),
).href;

/*
 * Medidas tiradas da imagem original (task 02), para que a única diferença seja o texto:
 * logo em escala 0,856, com o canto em (340, 120); linha da data com a caixa-alta de 538 a
 * 559 px e a do local de 580 a 597 px, as duas centradas.
 */
const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<style>
    @font-face { font-family: Inter; src: url('${inter}') format('woff2'); font-weight: 100 900; }
    html, body { margin: 0; }
    body {
        position: relative; width: 1200px; height: 630px; overflow: hidden;
        background: ${OLIVA}; font-family: Inter, sans-serif; color: ${CREME};
    }
    .logo { position: absolute; left: 340.4px; top: 120.4px; width: 518.7px; }
    .logo svg { display: block; width: 100%; height: auto; }
    p {
        position: absolute; left: 0; right: 0; margin: 0; text-align: center;
        text-transform: uppercase; line-height: 1; white-space: pre;
    }
    .data { top: 535px; font-size: 29px; font-weight: 400; letter-spacing: 0.035em; }
    .local { top: 579px; font-size: 23px; font-weight: 400; letter-spacing: 0.035em; opacity: 0.75; }
</style></head>
<body>
    <div class="logo">${logo}</div>
    <p class="data">${dataSemDiaDaSemana()}</p>
    <p class="local">${EVENTO.local.nome}  ·  ${EVENTO.local.cidade}, ${estado}</p>
</body></html>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'og-'));
const pagina = path.join(tmp, 'og.html');
fs.writeFileSync(pagina, html);

const [chrome] = Launcher.getInstallations();
if (!chrome) {
    console.error('Chrome não encontrado. Instale o Google Chrome para gerar a imagem.');
    process.exit(1);
}

// `--virtual-time-budget` segura o screenshot até a fonte carregar.
execFileSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1200,630',
    '--virtual-time-budget=3000',
    `--screenshot=${DESTINO}`,
    pathToFileURL(pagina).href,
], { stdio: 'ignore' });

fs.rmSync(tmp, { recursive: true, force: true });

const kb = (fs.statSync(DESTINO).size / 1024).toFixed(1);
console.log(`${path.relative(RAIZ, DESTINO)}  ${kb} KB`);
