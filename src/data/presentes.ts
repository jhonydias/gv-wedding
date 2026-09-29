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

/**
 * Categoria do presente. O nome `Faixa` e a coluna `faixa` da planilha ficaram da época
 * em que ela era derivada do valor (task 17). Desde 29/09/2026 são as categorias escolhidas
 * pelos noivos no painel. Os ids moram na planilha: mudou aqui, muda no `CATEGORIAS` do
 * `scripts/Code.gs` e no `tools/catalogo.mjs`.
 */
export type Faixa = 'salvador' | 'gisele' | 'victor' | 'ruth' | 'resenha';

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
    /**
     * Quantas pessoas podem dar ESTE presente, cada uma pagando `valor`. Task 14 §1.5.
     *
     * Vinha da planilha desde a task 10 e era descartado aqui, então o card mostrava
     * "R$ 95" sem dizer que eram 3 cotas de R$ 95. Ausente ou inválido vira 1.
     */
    cotas: number;
    /**
     * Task 22 §5.4: o convidado escolhe o valor, e `valor` é o mínimo. Presente de valor
     * livre é sempre ilimitado.
     */
    valorLivre: boolean;
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
    valor_livre?: boolean;
}

/** Na ordem em que aparecem na página. */
export const FAIXAS: ReadonlyArray<{ id: Faixa; titulo: string }> = [
    { id: 'salvador', titulo: 'Lua de mel em Salvador' },
    { id: 'gisele', titulo: 'Gisele' },
    { id: 'victor', titulo: 'Victor' },
    { id: 'ruth', titulo: 'Ruth' },
    { id: 'resenha', titulo: 'Resenha, vida a dois e sobrevivência pós casamento' },
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
        cotas: Number(p.cotas) > 0 ? Number(p.cotas) : 1,
        valorLivre: p.valor_livre === true,
    }));

/** Formata em BRL. Nunca concatenar 'R$ ' + n. */
export const emReais = (v: number): string =>
    new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(v);
