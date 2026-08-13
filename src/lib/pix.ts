/**
 * Pix — BR Code estático (EMV®QRCPS). Task 07.
 *
 * O payload é uma sequência de `ID + comprimento (2 dígitos) + valor`, fechada por um CRC16.
 * Gerado inteiramente no build, sem nenhuma dependência em runtime.
 */

const campo = (id: string, valor: string): string =>
    id + String(valor.length).padStart(2, '0') + valor;

/**
 * CRC16/CCITT-FALSE: polinômio 0x1021, inicial 0xFFFF, sem reflexão de entrada nem de saída.
 * Validado contra o vetor de teste do BCB (ver pix.test.mjs).
 */
export function crc16(s: string): string {
    let crc = 0xffff;
    for (let i = 0; i < s.length; i++) {
        crc ^= s.charCodeAt(i) << 8;
        for (let b = 0; b < 8; b++) {
            crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
        }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Remove diacríticos e limita o comprimento.
 * Os campos 59 (nome) e 60 (cidade) não aceitam acento — vários bancos falham na leitura.
 *
 * A classe da regex é o bloco de combinantes U+0300–U+036F, escrita com escapes:
 * com os caracteres literais eles ficam invisíveis no editor e se colam ao colchete
 * quando o trecho é copiado.
 */
const limpar = (s: string, max: number): string =>
    s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .slice(0, max);

export interface DadosPix {
    chave: string;
    nome: string;
    cidade: string;
    /** Em reais. Omitido gera BR Code sem valor definido. */
    valor?: number;
    /** `[A-Za-z0-9]` até 25 caracteres. Cai para `***` se ausente. */
    txid?: string;
}

export function brCode(o: DadosPix): string {
    const conta = campo('00', 'BR.GOV.BCB.PIX') + campo('01', o.chave);

    const corpo =
        campo('00', '01') + // payload format indicator
        campo('01', '11') + // estático reutilizável
        campo('26', conta) + // merchant account info
        campo('52', '0000') + // merchant category code
        campo('53', '986') + // BRL
        // Ponto decimal e sempre 2 casas. `250,00` invalida o código.
        (o.valor !== undefined ? campo('54', o.valor.toFixed(2)) : '') +
        campo('58', 'BR') +
        campo('59', limpar(o.nome, 25)) +
        campo('60', limpar(o.cidade, 15)) +
        campo('62', campo('05', o.txid ?? '***'));

    // O CRC é calculado sobre a string COM o cabeçalho '6304' já anexado.
    // Esquecer isso gera um QR que todo app recusa.
    const parcial = corpo + '6304';
    return parcial + crc16(parcial);
}

/** `txid` a partir do slug do presente: só alfanumérico, no máximo 25. */
export const txidDe = (slug: string): string =>
    ('GV' + slug.replace(/[^A-Za-z0-9]/g, '')).slice(0, 25);
