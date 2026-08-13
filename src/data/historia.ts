/**
 * Marcos da timeline — task 04.
 *
 * REGRA: nenhum texto de exemplo entra em produção. Enquanto `HISTORIA` estiver vazio,
 * a página `/historia` avisa que o conteúdo está pendente, fica fora do menu (a flag
 * `pronto` em `nav.ts` permanece `false`) e é excluída do sitemap.
 *
 * Um "Lorem ipsum" publicado num site de casamento é pior do que a página não existir.
 */
export interface Marco {
    /** ISO 8601 — usado no atributo `datetime`. */
    data: string;
    /** Como aparece na tela — ex.: 'Abril de 2018'. */
    dataExibida: string;
    titulo: string;
    /** 2 a 4 frases, em primeira pessoa. */
    texto: string;
    /** Nome do arquivo em src/assets/fotos/. */
    foto: string;
    /** Descritivo, em português. */
    alt: string;
}

/**
 * TODO(conteúdo): preencher com Gisele e Victor. NÃO inventar datas nem narrativa.
 *
 * Perguntas para gerar o conteúdo:
 * - como se conheceram e quando
 * - a primeira viagem juntos
 * - o pedido: onde, como, quem sabia
 * - a escolha do Espaço FRA
 * - o que cada um diria sobre o outro em uma frase
 */
export const HISTORIA = [] as readonly Marco[];
