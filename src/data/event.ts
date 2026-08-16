/**
 * Fonte ÚNICA dos fatos do evento.
 *
 * Nenhuma página pode ter data, hora ou endereço em texto solto. Se você está prestes a
 * digitar "31 de janeiro" num .astro, importe daqui em vez disso.
 */

export interface Local {
    nome: string;
    logradouro: string;
    bairro: string;
    cidade: string;
    uf: string;
    cep: string;
    /** Endereço de uma linha — é o que vai nos deep links de Uber/Maps (task 08). */
    endereco: string;
    /**
     * Coordenadas da entrada. Todo link de Uber, Google Maps, Waze e Apple Maps deriva
     * daqui (`src/lib/mapas.ts`), então um erro aqui manda os convidados para o lugar
     * errado no dia. Enquanto for null, os links caem para busca por endereço em texto.
     *
     * Informadas pelos noivos em 16/08/2026. Confirmar uma vez no mapa que o pino cai na
     * ENTRADA do Espaço FRA, e não no meio da quadra.
     */
    lat: number | null;
    lng: number | null;
}

export interface Evento {
    noiva: string;
    noivo: string;
    /**
     * Instante canônico, com offset explícito.
     *
     * Belém é UTC−03 o ano inteiro (sem horário de verão). O offset no literal faz o Date
     * resolver para o instante absoluto correto: um convidado em Lisboa vê o mesmo número de
     * dias no countdown que um em Belém. Sem o offset, o valor seria interpretado no fuso de
     * quem abre a página e mostraria a hora errada.
     */
    quando: string;
    local: Local;
    /**
     * Horário de término. **Decidido em 16/08/2026: não será informado.** Fica `null` de
     * propósito, e não é pendência. Nenhuma página deve inventar um horário de fim.
     */
    termino: string | null;
    /** O Espaço FRA é coberto? Respondido pelos noivos em 16/08/2026. */
    coberto: boolean | null;
    /** TODO(factual): prazo de confirmação de presença (task 06). */
    rsvpAte: string | null;
}

export const EVENTO: Evento = {
    noiva: 'Gisele Colares',
    noivo: 'Victor Santana',

    quando: '2027-01-31T19:00:00-03:00',

    local: {
        nome: 'Espaço FRA',
        logradouro: 'R. Cônego Jerônimo Pimentel, 124',
        bairro: 'Umarizal',
        cidade: 'Belém',
        uf: 'PA',
        cep: '66055-000',
        endereco: 'R. Cônego Jerônimo Pimentel, 124 - Umarizal, Belém - PA, 66055-000',
        lat: -1.443622,
        lng: -48.488787,
    },

    termino: null,
    coberto: true,
    rsvpAte: null,
};

/** Fuso do evento. Toda formatação de data/hora precisa passar por aqui. */
export const FUSO = 'America/Belem' as const;

/** O instante do casamento, já resolvido. */
export const QUANDO = new Date(EVENTO.quando);

/**
 * Data por extenso, no fuso do evento — "domingo, 31 de janeiro de 2027".
 * Sem `timeZone`, um convidado no Japão veria a data do dia seguinte.
 */
export function dataPorExtenso(): string {
    return new Intl.DateTimeFormat('pt-BR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: FUSO,
    }).format(QUANDO);
}

/** Hora no fuso do evento — "19h". */
export function horaFormatada(): string {
    const h = new Intl.DateTimeFormat('pt-BR', {
        hour: 'numeric',
        timeZone: FUSO,
    }).format(QUANDO);
    return `${h.replace(/\D/g, '')}h`;
}

/** Valor pronto para o atributo `datetime` de um <time>. */
export const DATETIME_ATTR = EVENTO.quando;
