/**
 * Lightbox — task 05 §4.
 *
 * Usa <dialog> nativo. Ele entrega de graça, e correto, o que a fancybox do wedding-web
 * fazia errado: camada superior real, foco preso, Esc fechando, ::backdrop e inert
 * implícito no resto da página.
 */

interface ItemGaleria {
    grande: string;
    alt: string;
}

/**
 * Os itens são lidos dos próprios botões da grade (`data-grande` + o `alt` da miniatura).
 * Evita serializar um JSON com os 35 alts uma segunda vez no HTML e mantém uma única
 * fonte de verdade para o texto alternativo.
 */
function lerItens(): ItemGaleria[] {
    return [...document.querySelectorAll<HTMLElement>('[data-foto]')].map((b) => ({
        grande: b.dataset.grande ?? '',
        alt: b.querySelector('img')?.alt ?? '',
    }));
}

export function lightbox(): void {
    const dlg = document.querySelector<HTMLDialogElement>('#lightbox');
    const img = document.querySelector<HTMLImageElement>('#lightbox-img');
    const contador = document.querySelector<HTMLElement>('[data-contador]');
    const fechar = document.querySelector<HTMLButtonElement>('[data-fechar]');
    if (!dlg || !img || !contador) return;

    const itens = lerItens();
    if (itens.length === 0) return;

    let i = 0;
    let origem: HTMLElement | null = null;
    let larguraBarra = 0;

    const pintar = (): void => {
        const f = itens[i];
        if (!f) return;
        img.src = f.grande;
        img.alt = f.alt;
        contador.textContent = `${i + 1} de ${itens.length}`;

        // Pré-carrega as vizinhas: navegar não pode mostrar quadro em branco.
        for (const d of [-1, 1]) {
            const v = itens[(i + d + itens.length) % itens.length];
            if (v) new Image().src = v.grande;
        }
    };

    const ir = (d: number): void => {
        i = (i + d + itens.length) % itens.length;
        pintar();
    };

    const abrir = (indice: number, botao: HTMLElement): void => {
        i = indice;
        origem = botao;
        pintar();
        larguraBarra = window.innerWidth - document.documentElement.clientWidth;
        document.body.style.overflow = 'hidden';
        if (larguraBarra > 0) document.body.style.paddingRight = `${larguraBarra}px`;
        dlg.showModal();
        fechar?.focus();
    };

    /**
     * Restaura o scroll e devolve o foco. Idempotente de propósito.
     *
     * NÃO depender só do evento `close` do <dialog>: ele não dispara de forma
     * confiável em todo ambiente (observado aqui: `dlg.open` vai a false sem que
     * nenhum listener de `close` rode). Se a limpeza falhar, o <body> fica preso em
     * `overflow: hidden` e a página inteira para de rolar — bug severo.
     * Por isso a limpeza é chamada por TODOS os caminhos de fechamento, e o evento
     * `close` fica só como rede de segurança.
     */
    const limpar = (): void => {
        if (document.body.style.overflow !== 'hidden') return;
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
        origem?.focus();
    };

    const encerrar = (): void => {
        if (dlg.open) dlg.close();
        limpar();
    };

    document.querySelectorAll<HTMLElement>('[data-foto]').forEach((el) => {
        el.addEventListener('click', () => abrir(Number(el.dataset.foto), el));
    });

    dlg.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            ir(1);
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            ir(-1);
        }
    });

    // `cancel` é o Esc nativo do <dialog>; `close` é a rede de segurança.
    dlg.addEventListener('cancel', limpar);
    dlg.addEventListener('close', limpar);

    // Clique no backdrop fecha; clique na foto, não.
    dlg.addEventListener('click', (e) => {
        if (e.target === dlg) encerrar();
    });

    fechar?.addEventListener('click', encerrar);
    dlg.querySelectorAll<HTMLElement>('[data-dir]').forEach((b) =>
        b.addEventListener('click', () => ir(Number(b.dataset.dir))),
    );

    // Swipe no touch, com limiar de 50px. Sem biblioteca de gesto para isso.
    let x0: number | null = null;
    dlg.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse') return;
        x0 = e.clientX;
    });
    dlg.addEventListener('pointerup', (e) => {
        if (x0 === null) return;
        const dx = e.clientX - x0;
        x0 = null;
        if (Math.abs(dx) > 50) ir(dx < 0 ? 1 : -1);
    });
}
