/**
 * Lista de presentes — task 07.
 *
 * Todo presente é uma COTA EM DINHEIRO paga por Pix. O card mostra o objeto (a narrativa);
 * o Pix é o mecanismo. Consequência: não existe estado "comprado" — várias pessoas podem
 * dar a mesma cota, e isso é desejável. Some o componente mais complexo do sistema, e some
 * também a pior falha da lista tradicional: dois convidados comprando o mesmo item.
 */

export type Faixa = 'lembranca' | 'casa' | 'grande' | 'luademel';

export interface Presente {
    /** Vira o txid do Pix. Só letras, números e hífen. */
    slug: string;
    nome: string;
    /** Em reais, inteiro. */
    valor: number;
    faixa: Faixa;
    descricao?: string;
}

export const FAIXAS: ReadonlyArray<{ id: Faixa; titulo: string; apoio: string }> = [
    { id: 'lembranca', titulo: 'Lembranças', apoio: 'Até R$ 150' },
    { id: 'casa', titulo: 'Para a casa', apoio: 'De R$ 150 a R$ 800' },
    { id: 'grande', titulo: 'Os grandes', apoio: 'Acima de R$ 800' },
    { id: 'luademel', titulo: 'Lua de mel', apoio: 'Cotas de viagem' },
];

/**
 * Dados do recebedor. A chave vem do ambiente e NUNCA é commitada.
 *
 * Ela aparece no HTML publicado — é inerente ao BR Code estático, equivalente a divulgar
 * um número de conta para depósito. Por isso a recomendação é usar uma chave ALEATÓRIA
 * dedicada ao casamento, que pode ser apagada depois sem mexer na conta.
 */
export const PIX = {
    chave: import.meta.env.PUBLIC_PIX_CHAVE ?? '',
    // Campos 59 e 60 do BR Code: sem acento, e no máximo 25 e 15 caracteres.
    nome: import.meta.env.PUBLIC_PIX_NOME ?? '',
    cidade: import.meta.env.PUBLIC_PIX_CIDADE ?? 'BELEM',
} as const;

/**
 * TODO(conteúdo): curar com Gisele e Victor. 18 a 30 itens é o ponto ideal —
 * menos parece pobre, mais gera paralisia de escolha.
 *
 * A lista abaixo é uma PROPOSTA de partida, com valores redondos e itens genéricos.
 * Trocar por presentes que os noivos realmente queiram antes de publicar.
 */
export const PRESENTES: readonly Presente[] = [
    { slug: 'jogo-de-taca', nome: 'Jogo de taças', valor: 90, faixa: 'lembranca' },
    { slug: 'toalhas', nome: 'Jogo de toalhas', valor: 120, faixa: 'lembranca' },
    { slug: 'panelas-pequenas', nome: 'Panelas pequenas', valor: 140, faixa: 'lembranca' },
    { slug: 'jogo-de-jantar', nome: 'Jogo de jantar', valor: 320, faixa: 'casa' },
    { slug: 'jogo-de-cama', nome: 'Jogo de cama', valor: 280, faixa: 'casa' },
    { slug: 'liquidificador', nome: 'Liquidificador', valor: 250, faixa: 'casa' },
    { slug: 'air-fryer', nome: 'Air fryer', valor: 450, faixa: 'casa' },
    { slug: 'micro-ondas', nome: 'Micro-ondas', valor: 700, faixa: 'casa' },
    { slug: 'aspirador', nome: 'Aspirador', valor: 600, faixa: 'casa' },
    { slug: 'geladeira', nome: 'Geladeira', valor: 2500, faixa: 'grande' },
    { slug: 'maquina-de-lavar', nome: 'Máquina de lavar', valor: 2200, faixa: 'grande' },
    { slug: 'sofa', nome: 'Sofá', valor: 1800, faixa: 'grande' },
    { slug: 'colchao', nome: 'Colchão', valor: 1500, faixa: 'grande' },
    { slug: 'passagem', nome: 'Cota da passagem', valor: 500, faixa: 'luademel' },
    { slug: 'hospedagem', nome: 'Cota da hospedagem', valor: 800, faixa: 'luademel' },
    { slug: 'passeio', nome: 'Um passeio a dois', valor: 300, faixa: 'luademel' },
    { slug: 'jantar-especial', nome: 'Um jantar especial', valor: 400, faixa: 'luademel' },
    { slug: 'lua-de-mel-livre', nome: 'Cota livre da lua de mel', valor: 200, faixa: 'luademel' },
] as const;

/** Formata em BRL. Nunca concatenar 'R$ ' + n. */
export const emReais = (v: number): string =>
    new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(v);
