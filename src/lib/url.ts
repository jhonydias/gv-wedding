/**
 * Resolve um caminho interno contra o `base` do Astro.
 *
 * Por que isso existe: o site já morou em /gv-wedding/ e hoje mora na raiz do domínio
 * próprio (task 23). `href` cravado funciona num cenário e quebra no outro, e é o pior tipo
 * de bug — só aparece depois do deploy. Todo link interno tem que passar por aqui, para que
 * uma nova mudança de base seja de novo uma linha no astro.config.
 *
 *   base '/'            →  rota('/pre-wedding') = '/pre-wedding',  rota('/') = '/'
 *   base '/gv-wedding'  →  rota('/pre-wedding') = '/gv-wedding/pre-wedding'
 */
export function rota(caminho: string): string {
    const base = import.meta.env.BASE_URL; // '/' hoje; '/algum-prefixo' se voltar a ter base
    const semBarraFinal = base.endsWith('/') ? base.slice(0, -1) : base;
    const comBarraInicial = caminho.startsWith('/') ? caminho : `/${caminho}`;
    return `${semBarraFinal}${comBarraInicial}` || '/';
}

/** URL absoluta — necessária para og:image e canonical (task 09). */
export function urlAbsoluta(caminho: string, site: URL | undefined): string {
    return new URL(rota(caminho), site ?? 'https://giseleevictor.com.br').href;
}
