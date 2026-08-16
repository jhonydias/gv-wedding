/**
 * Resolve um caminho interno contra o `base` do Astro.
 *
 * Por que isso existe: `href="/pre-wedding"` funciona em dev (onde o site é servido da raiz)
 * e quebra em produção (onde ele mora em /gv-wedding/). É o pior tipo de bug — só aparece
 * depois do deploy. Todo link interno tem que passar por aqui.
 *
 *   rota('/pre-wedding')  →  '/gv-wedding/pre-wedding'
 *   rota('/')         →  '/gv-wedding/'
 */
export function rota(caminho: string): string {
    const base = import.meta.env.BASE_URL; // '/gv-wedding' ou '/'
    const semBarraFinal = base.endsWith('/') ? base.slice(0, -1) : base;
    const comBarraInicial = caminho.startsWith('/') ? caminho : `/${caminho}`;
    return `${semBarraFinal}${comBarraInicial}` || '/';
}

/** URL absoluta — necessária para og:image e canonical (task 09). */
export function urlAbsoluta(caminho: string, site: URL | undefined): string {
    return new URL(rota(caminho), site ?? 'https://jhonydias.github.io').href;
}
