/**
 * Lista de presentes — task 07, com o catálogo vindo da planilha (task 10).
 *
 * O catálogo NÃO é escrito à mão aqui. Ele vem de `catalogo.json`, congelado por
 * `node tools/catalogo.mjs` a partir de `?acao=catalogo` do Apps Script.
 *
 * O build nunca vai à rede: se a planilha cair, o último catálogo bom continua valendo.
 * Rode o script quando o catálogo mudar e commite o JSON.
 *
 * Todo presente é uma COTA EM DINHEIRO paga por Pix. Não existe estado "comprado" no
 * dado: a disponibilidade é derivada dos pagamentos confirmados e chega em runtime
 * (`src/lib/status.ts`).
 */
import catalogo from './catalogo.json';

export type Faixa = 'lembranca' | 'casa' | 'grande' | 'luademel';

export interface Presente {
    /** Slug estável. Vira o txid do Pix e aparece no extrato dos noivos. */
    slug: string;
    nome: string;
    /** Em reais. */
    valor: number;
    faixa: Faixa;
    descricao?: string;
    /** URL de origem da imagem, como está na planilha. */
    imagem?: string;
}

/** Formato do JSON congelado — espelha o que `?acao=catalogo` devolve. */
interface ItemCatalogo {
    id: string;
    nome: string;
    valor: number;
    faixa: string;
    imagem?: string;
    descricao?: string;
    cotas?: number | null;
    ordem?: number;
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

const ehFaixa = (v: string): v is Faixa =>
    FAIXAS.some((f) => f.id === v);

export const PRESENTES: readonly Presente[] = (catalogo as ItemCatalogo[])
    .filter((p) => ehFaixa(p.faixa))
    .map((p) => ({
        slug: p.id,
        nome: p.nome,
        valor: p.valor,
        faixa: p.faixa as Faixa,
        descricao: p.descricao || undefined,
        imagem: p.imagem || undefined,
    }));

/** Formata em BRL. Nunca concatenar 'R$ ' + n. */
export const emReais = (v: number): string =>
    new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(v);
