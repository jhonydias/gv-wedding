/**
 * Congela o catálogo de presentes vindo do Apps Script — task 10 §5.
 *
 *   node tools/catalogo.mjs
 *
 * Lê `?acao=catalogo` e grava `src/data/catalogo.json`, que é **versionado**.
 *
 * Por que congelar em vez de buscar no build:
 *   o build NÃO pode depender de rede. Se a planilha estiver fora do ar, ou o token
 *   expirar, ou o CI não tiver saída para a internet, o deploy tem que continuar
 *   funcionando com o último catálogo bom. Este script é rodado à mão quando o
 *   catálogo muda, e o resultado entra no commit.
 *
 * Rede só aqui, nunca em `astro build`.
 */
import fs from 'node:fs';
import path from 'node:path';

const DESTINO = 'src/data/catalogo.json';
const TIMEOUT_MS = 20000; // cold start do Apps Script chega a ~8s; folga generosa

function lerEnv() {
    // Sem dependência: lê o .env na unha.
    const arq = '.env';
    if (!fs.existsSync(arq)) return {};
    const out = {};
    for (const linha of fs.readFileSync(arq, 'utf8').split(/\r?\n/)) {
        const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (m) out[m[1]] = m[2].trim();
    }
    return out;
}

const env = { ...lerEnv(), ...process.env };
const base = env.PUBLIC_BACKEND_URL;

if (!base) {
    console.error('PUBLIC_BACKEND_URL não definido (.env ou ambiente). Ver README-backend.md.');
    process.exit(1);
}

const ctrl = new AbortController();
const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

let corpo;
try {
    const r = await fetch(`${base}?acao=catalogo`, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    corpo = await r.json();
} catch (err) {
    console.error(`Falha ao buscar o catálogo: ${err.message}`);
    console.error(
        fs.existsSync(DESTINO)
            ? `O ${DESTINO} atual foi mantido — o build segue com ele.`
            : `E não existe ${DESTINO} para usar. O site vai renderizar sem presentes.`,
    );
    process.exit(1);
} finally {
    clearTimeout(t);
}

if (!corpo.ok || !Array.isArray(corpo.presentes)) {
    console.error('Resposta inesperada:', JSON.stringify(corpo).slice(0, 200));
    process.exit(1);
}

// Valida item a item. Uma linha torta na planilha não pode virar card quebrado.
const FAIXAS = new Set(['lembranca', 'casa', 'grande', 'luademel']);
const problemas = [];
const presentes = corpo.presentes.filter((p, i) => {
    const erro =
        !p.id || typeof p.id !== 'string' ? 'id ausente'
        : !p.nome ? 'nome ausente'
        : !(Number(p.valor) > 0) ? 'valor inválido'
        : !FAIXAS.has(p.faixa) ? `faixa desconhecida: "${p.faixa}"`
        : null;
    if (erro) problemas.push(`  linha ${i + 2}: ${erro} (id: ${p.id || '?'})`);
    return !erro;
});

const ids = presentes.map((p) => p.id);
const duplicados = ids.filter((id, i) => ids.indexOf(id) !== i);
if (duplicados.length) {
    console.error(`ids duplicados: ${[...new Set(duplicados)].join(', ')}`);
    process.exit(1);
}

if (problemas.length) {
    console.warn(`${problemas.length} item(ns) descartado(s):\n${problemas.join('\n')}`);
}

/**
 * Normaliza travessão vindo da planilha — task 11 §3.5.
 *
 * `nome` e `descricao` são digitados à mão por quem edita a planilha, que não tem como
 * lembrar da regra de estilo do site. Sem esta normalização, um travessão novo entra no
 * catálogo congelado e só é pego pela trava de `tools/auditar.mjs`, que reprova o build
 * por um motivo que não está em nenhum arquivo do repositório.
 *
 * Avisa o que trocou, sempre: normalização silenciosa é como texto errado sobrevive.
 * O aviso existe para que alguém corrija na origem, que é a planilha.
 */
const normalizados = [];
for (const p of presentes) {
    for (const campo of ['nome', 'descricao']) {
        if (typeof p[campo] !== 'string' || !p[campo].includes('—')) continue;
        const antes = p[campo];
        // O `[\s:]+$` limpa o caso do travessão no fim do texto, que viraria um
        // dois-pontos solto pendurado no fim da frase.
        p[campo] = antes
            .replace(/\s*—\s*/g, ': ')
            .replace(/[\s:]+$/, '')
            .trim();
        normalizados.push(`  ${p.id}.${campo}: "${antes}" => "${p[campo]}"`);
    }
}

if (normalizados.length) {
    console.warn(
        `${normalizados.length} travessão(ões) normalizado(s). Corrija na planilha:\n` +
            normalizados.join('\n'),
    );
}

fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
fs.writeFileSync(DESTINO, `${JSON.stringify(presentes, null, 2)}\n`, 'utf8');

const porFaixa = presentes.reduce((a, p) => ((a[p.faixa] = (a[p.faixa] || 0) + 1), a), {});
console.log(`${presentes.length} presentes congelados em ${DESTINO}`);
console.log(
    Object.entries(porFaixa)
        .map(([f, n]) => `  ${f}: ${n}`)
        .join('\n') || '  (catálogo vazio)',
);
if (presentes.length === 0) {
    console.warn('\nCatálogo vazio: cadastre presentes na aba `Presentes` da planilha.');
    console.warn('No editor do Apps Script há `semearPresentes()` para popular com dados de teste.');
}
