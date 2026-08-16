/**
 * Disponibilidade dos presentes, buscada em runtime — task 10 §1.
 *
 * O catálogo (nome, preço, imagem) é congelado no build. Só a disponibilidade é
 * volátil, e ela é um JSON minúsculo.
 *
 * Regra de degradação: a página já nasce COMPLETA e com tudo disponível. Se o GET
 * falhar, demorar ou vier torto, nada muda — nunca renderizar lista vazia por causa
 * de rede.
 */

/**
 * 8 s, não 3 s.
 *
 * Medido contra o endpoint real: em regime a resposta vem em ~1.3 s (mediana de 5
 * chamadas: 1046–1576 ms). Mas o Apps Script tem **cold start**, e a primeira chamada
 * depois de um tempo ocioso levou **7.5 s** — ou seja, com 3 s o primeiro visitante do
 * dia sempre cairia na degradação.
 *
 * Esperar mais não custa nada aqui: a página já renderizou completa e este fetch só
 * sobrepõe a disponibilidade. O timeout existe para não pendurar a requisição para
 * sempre, não para manter a página rápida.
 */
const TIMEOUT_MS = 8000;

interface StatusPresente {
    disponivel: boolean;
    cotasRestantes: number | null;
}

export async function aplicarStatus(): Promise<void> {
    const endpoint = import.meta.env.PUBLIC_BACKEND_URL;
    if (!endpoint) return;

    const cards = document.querySelectorAll<HTMLElement>('[data-presente-id]');
    if (cards.length === 0) return;

    let mapa: Record<string, StatusPresente>;
    try {
        const ctrl = new AbortController();
        const t = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        const r = await fetch(`${endpoint}?acao=status`, { signal: ctrl.signal });
        window.clearTimeout(t);
        const corpo = (await r.json()) as { ok?: boolean; status?: Record<string, StatusPresente> };
        if (!corpo.ok || !corpo.status) return;
        mapa = corpo.status;
    } catch {
        // Silêncio proposital: tudo segue disponível, que é o estado permissivo.
        return;
    }

    for (const card of cards) {
        const id = card.dataset.presenteId;
        if (!id) continue;
        const st = mapa[id];
        if (!st) continue;

        /*
         * Cotas restantes — task 14 §1.5.
         *
         * O backend já respondia isto desde a task 10 e a página descartava. É a
         * informação mais persuasiva da lista, e só aparece quando o servidor respondeu:
         * se o fetch falhar, a função já saiu lá em cima e o card fica com o texto
         * estático. Nunca mostrar número inventado, e nunca mostrar zero.
         */
        const cotas = card.querySelector<HTMLElement>('[data-cotas]');
        const total = Number(cotas?.dataset.total ?? 0);
        const restam = st.cotasRestantes;
        // "restam 3 de 3" não é escassez, é ruído: só troca o texto quando alguém já deu.
        if (cotas && total > 1 && restam !== null && restam > 0 && restam < total) {
            cotas.textContent = `restam ${restam} de ${total}`;
            cotas.hidden = false;
        }

        if (st.disponivel) continue;

        // Indisponível NÃO some da lista: quem recebeu o link de um item específico
        // precisa entender o que aconteceu, e não achar que a página quebrou.
        card.setAttribute('data-indisponivel', '');
        if (cotas) cotas.hidden = true;
        const botao = card.querySelector<HTMLButtonElement>('[data-presente]');
        if (botao) {
            botao.disabled = true;
            botao.textContent = 'Alguém já presenteou 💛';
        }
    }
}
