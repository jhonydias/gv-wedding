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

const TIMEOUT_MS = 3000;

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
        if (!st || st.disponivel) continue;

        // Indisponível NÃO some da lista: quem recebeu o link de um item específico
        // precisa entender o que aconteceu, e não achar que a página quebrou.
        card.setAttribute('data-indisponivel', '');
        const botao = card.querySelector<HTMLButtonElement>('[data-presente]');
        if (botao) {
            botao.disabled = true;
            botao.textContent = 'Alguém já presenteou 💛';
        }
    }
}
