import type { Faixa } from '../data/presentes';

/**
 * Faixa a partir do valor, com as fronteiras do texto de `FAIXAS` em `data/presentes.ts`
 * ("Até R$ 150", "De R$ 150 a R$ 800", "Acima de R$ 800"). Task 17: os noivos não
 * escolhem a faixa, ela é derivada. O `faixaDe_()` do `scripts/Code.gs` espelha esta
 * função; mudou aqui, muda lá.
 */
export function faixaDe(valor: number, luademel: boolean): Faixa {
    if (luademel) return 'luademel';
    if (valor <= 150) return 'lembranca';
    if (valor <= 800) return 'casa';
    return 'grande';
}
