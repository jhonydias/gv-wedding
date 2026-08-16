/**
 * Fotos do hero — task 13.
 *
 * Lista CURADA e curta, separada de `FOTOS`. O hero não é a galeria: é uma seleção de
 * quadros que aguentam recorte de tela cheia e que foram MEDIDOS contra o escurecimento
 * do hero. Nenhuma foto entra aqui sem o número da coluna `contraste`.
 *
 * ## Por que o contraste é o critério
 *
 * O `.hero__fundo::after` compõe duas camadas de escurecimento cujos valores foram
 * calculados na task 09 §3.1 contra UMA foto (`gv-02`), com pior caso de 4,85:1. O texto
 * do hero é creme sobre a foto composta, e a linha de data é pequena: exige 4,5:1.
 *
 * ## O que a medição da task 13 mostrou
 *
 * As **35** fotos foram medidas, nas três viewports de referência, amostrando os pixels
 * sob as caixas reais do texto e compondo as duas camadas analiticamente. Resultado:
 * **todas passam**, entre 4,83:1 (`gv-30-luz-dourada`) e 6,04:1 (`gv-28-noiva-porta`).
 * O scrim é mais robusto do que a spec supunha, e o contraste deixou de ser o gargalo
 * da escolha.
 *
 * Isso NÃO dispensa medir uma foto nova: `gv-02` a 50% de foco cai para 4,38:1 e reprova.
 * O enquadramento move os pixels que ficam sob o texto, então foco e contraste andam
 * juntos e são medidos no par.
 *
 * ## O gargalo real virou o PESO
 *
 * Com o contraste liberando as 35, quem restringe é o teto de 250 KB por imagem servida
 * (task 02 §6). Medido na variante de 1600w em webp q62, que é a maior servida:
 *
 * ```
 *    85 KB  gv-02-catedral-beijo        141 KB  gv-22-porta-madeira
 *   112 KB  gv-20-beijo-lanternas       145 KB  gv-24-pizzaria-testa
 *   115 KB  gv-16-beco-luzinhas         170 KB  gv-03-danca-luzes
 *   126 KB  gv-18-de-costas             183 KB  gv-32-colunata
 *   139 KB  gv-21-rua-luzes             190 KB  gv-31-joelho-mao
 *   145 KB  gv-07-caminhada-bandeirinhas 250 KB  gv-14-portal-trepadeira
 * ```
 *
 * `gv-14-portal-trepadeira` bate exatamente no teto: passa por zero de margem, e qualquer
 * reencode a derruba. **Foi descartada por isso**, não por contraste (mede 5,77:1, uma das
 * melhores). Folhagem tem detalhe de alta frequência em toda a área e é cara de comprimir.
 *
 * A qualidade do hero caiu de 72 para 62 nesta task. Fica atrás de um scrim que compõe
 * 86%/66% de oliva sobre a área do texto: o detalhe fino ali não é percebido, e o mesmo
 * q62 já é o que o lightbox usa em foto vista em tela cheia SEM scrim (task 05).
 */
export interface FotoHero {
    /** Nome do arquivo em `src/assets/fotos/`. O mesmo de `FOTOS`, sem duplicar arquivo. */
    arquivo: string;
    /**
     * `object-position` desta foto no recorte de tela cheia.
     *
     * `58%` mantém rostos e corpo dentro da faixa visível tanto no recorte vertical do
     * desktop quanto no horizontal do celular. Mudar isto obriga a remedir o `contraste`.
     */
    foco: string;
    /**
     * Pior contraste medido do texto creme sobre esta foto composta com o scrim, entre as
     * três viewports de referência. Mínimo aceito: 4,5:1 (AA para texto pequeno).
     * Medido em 16/08/2026 pelo método da task 13 §2.1.
     */
    contraste: number;
}

/**
 * A ordem é a ordem de exibição, e a primeira é a que vai no HTML inicial.
 *
 * `gv-02` continua em primeiro de propósito: é a foto cujo LCP já está medido desde a
 * task 03. Trocar a primeira obriga a remedir o LCP com uma variável a mais.
 *
 * As outras quatro foram escolhidas por variedade de cenário (rua da catedral, beco com
 * bandeirinhas, corredor de lanternas, porta de madeira, colunata) e por não repetirem par
 * quase idêntico da curadoria da task 05: `gv-11`/`gv-12`, `gv-19`/`gv-20`,
 * `gv-23`/`gv-24`/`gv-25`, `gv-28`/`gv-29`, `gv-33`/`gv-34`. Só uma de cada par entra.
 *
 * Os noivos responderam "escolha aleatoriamente" (tasks/README.md). A liberdade é na
 * escolha, não na medição: a lista sai das que passam no contraste E no peso.
 */
export const HERO: readonly FotoHero[] = [
    { arquivo: 'gv-02-catedral-beijo.jpg', foco: 'center 58%', contraste: 4.98 },
    { arquivo: 'gv-07-caminhada-bandeirinhas.jpg', foco: 'center 58%', contraste: 5.87 },
    { arquivo: 'gv-20-beijo-lanternas.jpg', foco: 'center 58%', contraste: 5.66 },
    { arquivo: 'gv-22-porta-madeira.jpg', foco: 'center 58%', contraste: 5.59 },
    { arquivo: 'gv-32-colunata.jpg', foco: 'center 58%', contraste: 5.54 },
] as const;

/**
 * Descrição acessível do hero. UMA só, na primeira foto.
 *
 * As outras vão com `alt=""` e `aria-hidden`: ninguém precisa ouvir cinco descrições de
 * plano de fundo, e a rotação não pode fazer o leitor de tela falar sozinho a cada 7 s.
 */
export const ALT_HERO =
    'Gisele e Victor se beijando numa rua do centro histórico, com a torre da catedral ao fundo';
