/**
 * Baixa as imagens dos presentes — task 10 §2.4.
 *
 *   node tools/imagens.mjs
 *
 * A coluna `imagem` da planilha é a ORIGEM, não o destino. As URLs apontam para
 * lojas (Amazon, Camicado, Tok&Stok…) e isso quebra sozinho: os links expiram, e a
 * task 02 proíbe domínio externo no caminho crítico. Foi exatamente o que aconteceu na
 * planilha herdada do wedding-web, cheia de URLs de marketplace.
 *
 * Aqui cada URL é baixada UMA vez, gravada em `src/assets/fotos/presentes/` e otimizada
 * depois pelo <Image> do Astro (task 05).
 *
 * Falha de download NÃO gera <img> quebrada: o presente cai para um placeholder da
 * marca e o build avisa.
 *
 * Rede só aqui, nunca em `astro build`.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const CATALOGO = 'src/data/catalogo.json';
const DESTINO = 'src/assets/fotos/presentes';
const MANIFESTO = 'src/data/imagens.json';
const TIMEOUT_MS = 20000;
const TAMANHO_MAX = 8 * 1024 * 1024;

/** Assinaturas de arquivo. Content-Type mente; magic bytes não. */
const TIPOS = [
    { ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
    { ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
    { ext: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] },
    { ext: 'webp', bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF; confere 'WEBP' no offset 8
];

function detectarTipo(buf) {
    for (const t of TIPOS) {
        if (t.bytes.every((b, i) => buf[i] === b)) {
            if (t.ext === 'webp' && buf.subarray(8, 12).toString('ascii') !== 'WEBP') continue;
            return t.ext;
        }
    }
    return null;
}

if (!fs.existsSync(CATALOGO)) {
    console.error(`${CATALOGO} não existe. Rode \`npm run catalogo\` antes.`);
    process.exit(1);
}

const catalogo = JSON.parse(fs.readFileSync(CATALOGO, 'utf8'));
fs.mkdirSync(DESTINO, { recursive: true });

const manifesto = fs.existsSync(MANIFESTO) ? JSON.parse(fs.readFileSync(MANIFESTO, 'utf8')) : {};

// URLs iguais são baixadas uma vez só. No catálogo atual as 20 linhas apontam para a
// mesma imagem — sem isso seriam 20 downloads e 20 arquivos idênticos no repositório.
const porUrl = new Map();
for (const p of catalogo) {
    const url = (p.imagem || '').trim();
    if (!url) continue;
    if (!porUrl.has(url)) porUrl.set(url, []);
    porUrl.get(url).push(p.id);
}

const semImagem = catalogo.filter((p) => !(p.imagem || '').trim()).map((p) => p.id);
const falhas = [];
let baixadas = 0;
let reaproveitadas = 0;

for (const [url, slugs] of porUrl) {
    // O nome vem do hash da URL: mesma origem, mesmo arquivo, e trocar a URL na
    // planilha gera um arquivo novo em vez de servir o antigo do cache.
    const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 12);
    const existente = fs.readdirSync(DESTINO).find((f) => f.startsWith(hash));

    if (existente) {
        for (const s of slugs) manifesto[s] = existente;
        reaproveitadas++;
        continue;
    }

    let buf;
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        const r = await fetch(url, {
            signal: ctrl.signal,
            // Alguns marketplaces recusam requisição sem user-agent de browser.
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; gv-wedding-build/1.0)' },
        });
        clearTimeout(t);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        buf = Buffer.from(await r.arrayBuffer());
    } catch (err) {
        falhas.push({ url, slugs, motivo: err.message });
        continue;
    }

    if (buf.length > TAMANHO_MAX) {
        falhas.push({ url, slugs, motivo: `${(buf.length / 1e6).toFixed(1)} MB — acima do teto` });
        continue;
    }

    const ext = detectarTipo(buf);
    if (!ext) {
        falhas.push({ url, slugs, motivo: 'não é imagem (assinatura desconhecida)' });
        continue;
    }

    const arquivo = `${hash}.${ext}`;
    fs.writeFileSync(path.join(DESTINO, arquivo), buf);
    for (const s of slugs) manifesto[s] = arquivo;
    baixadas++;
    console.log(`  ${arquivo}  ${(buf.length / 1024).toFixed(0)} KB  ← ${slugs.length} presente(s)`);
}

// Slug sem imagem baixada sai do manifesto: o componente cai para o placeholder.
for (const slug of Object.keys(manifesto)) {
    const p = catalogo.find((x) => x.id === slug);
    const temArquivo = fs.existsSync(path.join(DESTINO, manifesto[slug]));
    if (!p || !(p.imagem || '').trim() || !temArquivo) delete manifesto[slug];
}

fs.writeFileSync(MANIFESTO, `${JSON.stringify(manifesto, null, 2)}\n`, 'utf8');

// Remove arquivos que nenhum presente referencia mais.
const emUso = new Set(Object.values(manifesto));
let orfaos = 0;
for (const f of fs.readdirSync(DESTINO)) {
    if (!emUso.has(f)) {
        fs.unlinkSync(path.join(DESTINO, f));
        orfaos++;
    }
}

console.log(
    `\n${Object.keys(manifesto).length} de ${catalogo.length} presentes com imagem local` +
        ` · ${baixadas} baixada(s), ${reaproveitadas} reaproveitada(s)` +
        (orfaos ? `, ${orfaos} órfã(s) removida(s)` : ''),
);

if (semImagem.length) {
    console.warn(`\n${semImagem.length} sem URL na planilha (usarão placeholder da marca):`);
    console.warn(`  ${semImagem.join(', ')}`);
}

if (falhas.length) {
    console.warn(`\n${falhas.length} download(s) falharam — estes presentes usarão o placeholder:`);
    for (const f of falhas) {
        console.warn(`  ${f.slugs.join(', ')}: ${f.motivo}`);
        console.warn(`    ${f.url}`);
    }
    // Aviso, não erro: um link quebrado na planilha não pode travar o deploy.
}
