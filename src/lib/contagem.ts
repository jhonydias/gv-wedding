/**
 * Contagem regressiva — task 03 §4.
 *
 * Unidades: dias, horas, minutos, segundos. SEM "meses": mês não tem duração fixa,
 * e "faltam 2 meses" pode significar 59 ou 62 dias conforme o dia em que o convidado
 * abre a página. O site de referência exibe meses e sofre essa inconsistência.
 */
import { EVENTO } from '../data/event';

const ALVO = new Date(EVENTO.quando).getTime();

export interface Partes {
    dias: number;
    horas: number;
    min: number;
    seg: number;
    passou: boolean;
}

export function calcular(agora: number = Date.now()): Partes {
    const delta = ALVO - agora;
    const passou = delta < 0;
    let s = Math.floor(Math.abs(delta) / 1000);

    const dias = Math.floor(s / 86400);
    s -= dias * 86400;
    const horas = Math.floor(s / 3600);
    s -= horas * 3600;
    const min = Math.floor(s / 60);
    const seg = s - min * 60;

    return { dias, horas, min, seg, passou };
}

export function montar(raiz: HTMLElement): void {
    const campo = (u: string): HTMLElement | null =>
        raiz.querySelector<HTMLElement>(`[data-u="${u}"]`);

    const campos = {
        dias: campo('dias'),
        horas: campo('horas'),
        min: campo('min'),
        seg: campo('seg'),
    };
    const rotulo = raiz.querySelector<HTMLElement>('[data-rotulo]');
    const vivo = raiz.querySelector<HTMLElement>('[data-vivo]');

    let ultimoDia = -1;

    const tick = (): void => {
        const p = calcular();

        if (campos.dias) campos.dias.textContent = String(p.dias);
        if (campos.horas) campos.horas.textContent = String(p.horas).padStart(2, '0');
        if (campos.min) campos.min.textContent = String(p.min).padStart(2, '0');
        if (campos.seg) campos.seg.textContent = String(p.seg).padStart(2, '0');
        if (rotulo) rotulo.textContent = p.passou ? 'Casados há' : 'Faltam';

        // Leitor de tela: anunciar 1×/dia, não 1×/segundo. Um aria-live nos segundos
        // faria o leitor falar sem parar — erro comum e grave.
        if (vivo && p.dias !== ultimoDia) {
            ultimoDia = p.dias;
            vivo.textContent = p.passou
                ? `Casados há ${p.dias} dias.`
                : `Faltam ${p.dias} dias para o casamento.`;
        }
    };

    let id: number | undefined;
    const liga = (): void => {
        if (id === undefined) id = window.setInterval(tick, 1000);
    };
    const para = (): void => {
        if (id !== undefined) {
            clearInterval(id);
            id = undefined;
        }
    };

    // Aba oculta: um setInterval de 1s rodando em segundo plano é bateria gasta à toa.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            para();
        } else {
            tick();
            liga();
        }
    });

    tick();
    liga();
}
