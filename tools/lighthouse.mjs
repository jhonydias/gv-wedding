/**
 * Lighthouse mobile nas páginas do site — task 09 §5.1.
 *
 * Sobe o preview, roda o Lighthouse em cada rota e imprime uma tabela.
 * Sai com erro se alguma métrica ficar abaixo do teto.
 *
 *   node scripts/lighthouse.mjs [--url http://localhost:4321/gv-wedding]
 */
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';

const BASE =
    process.argv.includes('--url')
        ? process.argv[process.argv.indexOf('--url') + 1]
        : 'http://localhost:4321/gv-wedding';

const ROTAS = ['/', '/historia', '/galeria', '/confirmar', '/presentes', '/informacoes'];

/** Páginas com `noindex` intencional — a nota de SEO não se aplica a elas. */
const NOINDEX = ['/historia', '/confirmar'];

const TETOS = {
    performance: 0.95,
    accessibility: 1.0,
    'best-practices': 0.95,
    seo: 0.95,
};

const chrome = await launch({
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
});

const linhas = [];
const falhas = [];

try {
    for (const rota of ROTAS) {
        const url = `${BASE}${rota}`;
        const r = await lighthouse(
            url,
            { port: chrome.port, output: 'json', logLevel: 'error' },
            // Preset mobile é o padrão: 4G simulado, CPU 4x mais lenta.
            undefined,
        );
        const lhr = r.lhr;
        const cat = (id) => Math.round((lhr.categories[id]?.score ?? 0) * 100);
        const aud = (id) => lhr.audits[id]?.numericValue ?? null;

        const linha = {
            rota,
            perf: cat('performance'),
            a11y: cat('accessibility'),
            bp: cat('best-practices'),
            seo: cat('seo'),
            LCP_s: aud('largest-contentful-paint') ? (aud('largest-contentful-paint') / 1000).toFixed(2) : '—',
            CLS: aud('cumulative-layout-shift')?.toFixed(3) ?? '—',
            TBT_ms: aud('total-blocking-time')?.toFixed(0) ?? '—',
        };
        linhas.push(linha);

        for (const [id, teto] of Object.entries(TETOS)) {
            const s = lhr.categories[id]?.score ?? 0;
            if (s >= teto) continue;
            // /historia e /confirmar mandam `noindex` de propósito, e o Lighthouse
            // desconta a categoria SEO inteira por isso (`is-crawlable`). Não é defeito.
            if (id === 'seo' && NOINDEX.includes(rota)) {
                console.log(`  (${rota}: SEO ${Math.round(s * 100)} — esperado, a página é noindex)`);
                continue;
            }
            falhas.push(`${rota} · ${id}: ${Math.round(s * 100)} (teto ${Math.round(teto * 100)})`);
        }

        // Detalha o que reprovou em acessibilidade — é o teto mais rígido.
        const a11yRuins = Object.values(lhr.audits).filter(
            (a) =>
                lhr.categories.accessibility.auditRefs.some((ref) => ref.id === a.id) &&
                a.score !== null &&
                a.score < 1,
        );
        // Detalha SEO e os elementos que causaram deslocamento de layout.
        for (const catId of ['seo', 'performance']) {
            const ruins = lhr.categories[catId].auditRefs
                .map((ref) => lhr.audits[ref.id])
                .filter((a) => a && a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'informative');
            if (!ruins.length) continue;
            console.log(`\n  ${rota} — ${catId}:`);
            for (const a of ruins) console.log(`    · ${a.id}: ${a.title}`);
        }
        const shifts = lhr.audits['layout-shift-elements']?.details?.items ?? [];
        if (shifts.length) {
            console.log(`\n  ${rota} — elementos que deslocaram:`);
            for (const s of shifts) {
                console.log(`    · ${s.node?.selector ?? '?'} (score ${Number(s.score).toFixed(4)})`);
            }
        }

        if (a11yRuins.length) {
            console.log(`\n  ${rota} — falhas de acessibilidade:`);
            for (const a of a11yRuins) {
                console.log(`    · ${a.id}: ${a.title}`);
                for (const item of a.details?.items ?? []) {
                    const alvo = item.node?.selector ?? item.node?.snippet ?? '';
                    const expl = item.node?.explanation ?? '';
                    console.log(`        ${alvo}`);
                    if (expl) console.log(`          ${expl.replace(/\s+/g, ' ').slice(0, 160)}`);
                }
            }
        }
    }
} finally {
    // No Windows o chrome-launcher costuma falhar ao apagar o diretório temporário.
    // Não pode derrubar o relatório inteiro por causa disso.
    try {
        await chrome.kill();
    } catch (e) {
        console.warn(`\n(aviso: falha ao limpar o Chrome temporário — ${e.code ?? e})`);
    }
}

console.log('\nLighthouse (preset mobile)\n');
console.table(linhas);

if (falhas.length) {
    console.error('\nAbaixo do teto:\n' + falhas.map((f) => `  - ${f}`).join('\n'));
    process.exit(1);
}
console.log('\nTodas as categorias dentro do teto.');
