// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
    site: 'https://jhonydias.github.io',

    // O site mora em jhonydias.github.io/gv-wedding/ enquanto não houver domínio próprio.
    // Ao migrar para domínio próprio: remover `base`, ajustar `site` e adicionar public/CNAME
    // NA MESMA MUDANÇA — senão todos os links internos quebram.
    base: '/gv-wedding',

    // O CSS do projeto é pequeno (tokens + base + motion). Embutir mata um round-trip
    // no caminho crítico e ajuda o LCP.
    build: { inlineStylesheets: 'always' },

    // Nenhum domínio externo de imagem: tudo é processado no build e servido daqui.
    image: { domains: [] },

    integrations: [
        sitemap({
            // /confirmar é formulário — não faz sentido indexar.
            // /historia sai enquanto não tiver conteúdo (a página já manda `noindex`).
            filter: (pagina) =>
                !pagina.includes('/confirmar') && !pagina.includes('/historia'),
        }),
    ],
});
