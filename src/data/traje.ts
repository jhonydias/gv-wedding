/**
 * Traje e loja sugerida. Task 20.
 *
 * Informado pelos noivos em 26/09/2026. Mudou o desconto ou o endereço: muda aqui, e a
 * /informacoes acompanha. Regras do desconto (como usar, validade) ficam com a loja: a
 * página só manda o convidado entrar em contato.
 */

export interface Desconto {
    /** Inteiro, sem o "%". A página decide a tipografia. */
    percentual: number;
    condicao: string;
}

export interface LojaSugerida {
    nome: string;
    /** Aparece de propósito: a loja aluga vestidos, e quem procura terno não perde a viagem. */
    oferece: string;
    /** Usuário sem a arroba. A URL é montada limpa, sem o token de compartilhamento do app. */
    instagram: string;
    /**
     * Endereço da bio do Instagram da loja em 26/09/2026. Listagens antigas na internet dão
     * Tv. Benjamin Constant, 1571B; confirmar com os noivos (task 20 §6).
     */
    logradouro: string;
    cidade: string;
    uf: string;
    descontos: readonly Desconto[];
}

export const TRAJE = {
    codigo: 'Passeio completo',
} as const;

export const LOJA: LojaSugerida = {
    nome: 'Closet das 2',
    oferece: 'Aluguel de vestidos de festa',
    instagram: 'closetdas2.belem',
    logradouro: 'Av. Gentil Bittencourt, 390',
    cidade: 'Belém',
    uf: 'PA',
    descontos: [
        { percentual: 20, condicao: 'à vista' },
        { percentual: 15, condicao: 'no crédito' },
    ],
};

/** URL canônica do perfil, com a barra final (evita um redirecionamento no celular). */
export const instagramDe = (usuario: string): string => `https://www.instagram.com/${usuario}/`;
