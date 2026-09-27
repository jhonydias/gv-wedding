// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
    // Domínio próprio desde a task 23. O `base` saiu na mesma mudança que criou o
    // public/CNAME: `site`, `base` e CNAME são um pacote só, mexer em um sem os outros
    // quebra o site. Sem `base`, o Astro usa '/' e o `rota()` (src/lib/url.ts) acompanha.
    site: 'https://giseleevictor.com.br',

    // O CSS do projeto é pequeno (tokens + base + motion). Embutir mata um round-trip
    // no caminho crítico e ajuda o LCP.
    build: { inlineStylesheets: 'always' },

    // Nenhum domínio externo de imagem: tudo é processado no build e servido daqui.
    image: { domains: [] },

    integrations: [
        sitemap({
            // /confirmar é formulário — não faz sentido indexar.
            // /historia sai enquanto não tiver conteúdo (a página já manda `noindex`).
            // /noivos é a área dos noivos (task 17): nem sitemap, nem robots.txt.
            filter: (pagina) =>
                !pagina.includes('/confirmar') &&
                !pagina.includes('/historia') &&
                !pagina.includes('/noivos'),
        }),
    ],
});
