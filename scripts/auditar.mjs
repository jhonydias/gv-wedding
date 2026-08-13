/**
 * Auditoria de orçamento — task 09 §2.
 *
 * Roda sobre `dist/` depois do build e SAI COM ERRO se algum teto for estourado.
 * Um número que não bloqueia nada é decoração.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DIST = 'dist';

const TETOS = {
    imagemKB: 250, // maior imagem servida
    htmlGzipKB: 60, // maior página, comprimida
    jsGzipKB: 40, // JS total da home, comprimido
};

const falhas = [];
const nota = [];

function listar(dir) {
    const saida = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) saida.push(...listar(p));
        else saida.push(p);
    }
    return saida;
}

if (!fs.existsSync(DIST)) {
    console.error(`Pasta ${DIST}/ não existe. Rode o build antes.`);
    process.exit(1);
}

const arquivos = listar(DIST);
const gzipKB = (p) => zlib.gzipSync(fs.readFileSync(p)).length / 1024;
const kb = (p) => fs.statSync(p).size / 1024;

// --- imagens ---
const imagens = arquivos.filter((f) => /\.(avif|webp|jpe?g|png)$/i.test(f));
const grandes = imagens
    .map((f) => ({ f, kb: kb(f) }))
    .filter((x) => x.kb > TETOS.imagemKB)
    .sort((a, b) => b.kb - a.kb);

if (grandes.length) {
    falhas.push(
        `${grandes.length} imagem(ns) acima de ${TETOS.imagemKB} KB:\n` +
            grandes
                .slice(0, 10)
                .map((x) => `    ${x.kb.toFixed(0)} KB  ${x.f}`)
                .join('\n'),
    );
}
const maiorImagem = imagens.reduce((m, f) => Math.max(m, kb(f)), 0);
nota.push(`imagens: ${imagens.length} arquivos, maior ${maiorImagem.toFixed(0)} KB`);

// --- html ---
const htmls = arquivos.filter((f) => f.endsWith('.html'));
for (const h of htmls) {
    const g = gzipKB(h);
    if (g > TETOS.htmlGzipKB) {
        falhas.push(`${h} tem ${g.toFixed(1)} KB gzip (teto ${TETOS.htmlGzipKB} KB)`);
    }
}
const maiorHtml = htmls.reduce((m, f) => Math.max(m, gzipKB(f)), 0);
nota.push(`html: ${htmls.length} páginas, maior ${maiorHtml.toFixed(1)} KB gzip`);

// --- js ---
const jsFiles = arquivos.filter((f) => f.endsWith('.js'));
const jsTotal = jsFiles.reduce((s, f) => s + gzipKB(f), 0);
if (jsTotal > TETOS.jsGzipKB) {
    falhas.push(`JS somado: ${jsTotal.toFixed(1)} KB gzip (teto ${TETOS.jsGzipKB} KB)`);
}
nota.push(`js: ${jsFiles.length} arquivos, ${jsTotal.toFixed(1)} KB gzip`);

// --- nomes de arquivo: o runner do CI é Linux e case-sensitive ---
const suspeitos = arquivos.filter((f) => /[^\x20-\x7E]/.test(path.basename(f)));
if (suspeitos.length) {
    falhas.push(
        `Arquivo com caractere não-ASCII no nome (quebra URL e build no CI):\n` +
            suspeitos.map((f) => `    ${f}`).join('\n'),
    );
}

// --- resultado ---
console.log('Auditoria de orçamento\n' + nota.map((n) => `  ${n}`).join('\n'));

if (falhas.length) {
    console.error('\nFALHOU:\n' + falhas.map((f) => `  - ${f}`).join('\n'));
    process.exit(1);
}
console.log('\nTodos os orçamentos respeitados.');
