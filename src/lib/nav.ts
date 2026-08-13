/**
 * Comportamento da navegação — task 03 §2.
 *
 * Dois assuntos: o estado "fixa" (vidro após rolar) e o painel mobile acessível.
 */

/**
 * Um ÚNICO listener de scroll na página, com throttle por requestAnimationFrame.
 * Padrão de modo-bim/index.html:1757-1760. Um listener por componente é o que
 * trava a rolagem em celular fraco.
 */
function estadoFixa(barra: HTMLElement): void {
    let agendado = false;

    const aplicar = (): void => {
        barra.toggleAttribute('data-fixa', window.scrollY > 80);
        agendado = false;
    };

    window.addEventListener(
        'scroll',
        () => {
            if (agendado) return;
            agendado = true;
            requestAnimationFrame(aplicar);
        },
        // Sem `passive`, o browser não pode adiantar a rolagem enquanto o handler não retorna.
        { passive: true },
    );

    aplicar();
}

/**
 * Painel mobile. Requisitos de acessibilidade que a maioria dos sites de casamento erra:
 * foco preso, Esc fecha e devolve o foco ao botão, fundo `inert`, scroll travado.
 */
function painelMobile(barra: HTMLElement): void {
    const botao = barra.querySelector<HTMLButtonElement>('[data-menu-abre]');
    const painel = barra.querySelector<HTMLElement>('[data-menu-painel]');
    const conteudo = document.querySelector<HTMLElement>('#conteudo');
    if (!botao || !painel) return;

    const focaveis = (): HTMLElement[] =>
        [...painel.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')].filter(
            (el) => el.offsetParent !== null,
        );

    let aberto = false;

    const abrir = (): void => {
        aberto = true;
        botao.setAttribute('aria-expanded', 'true');
        painel.hidden = false;

        // Trava o scroll compensando a barra, para o layout não deslocar ao abrir.
        const barraLargura = window.innerWidth - document.documentElement.clientWidth;
        document.body.style.overflow = 'hidden';
        if (barraLargura > 0) document.body.style.paddingRight = `${barraLargura}px`;

        // `inert` resolve leitor de tela e Tab de uma vez só.
        conteudo?.setAttribute('inert', '');

        // Se não houver nada focável (todos os itens ainda "em breve"), o foco vai para o
        // próprio painel. Sem esse fallback ele escapa para o skip-link, ou seja, para
        // trás do painel — que é exatamente o que o `inert` deveria impedir.
        const primeiro = focaveis()[0];
        if (primeiro) {
            primeiro.focus();
        } else {
            painel.tabIndex = -1;
            painel.focus();
        }
    };

    const fechar = (devolveFoco = true): void => {
        aberto = false;
        botao.setAttribute('aria-expanded', 'false');
        painel.hidden = true;

        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
        conteudo?.removeAttribute('inert');

        if (devolveFoco) botao.focus();
    };

    botao.addEventListener('click', () => (aberto ? fechar() : abrir()));

    painel
        .querySelector<HTMLButtonElement>('[data-menu-fecha]')
        ?.addEventListener('click', () => fechar());

    painel.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            fechar();
            return;
        }
        if (e.key !== 'Tab') return;

        // Prende o foco: Tab no último volta ao primeiro, Shift+Tab no primeiro vai ao último.
        const itens = focaveis();
        if (itens.length === 0) return;
        const primeiro = itens[0]!;
        const ultimo = itens[itens.length - 1]!;

        if (e.shiftKey && document.activeElement === primeiro) {
            e.preventDefault();
            ultimo.focus();
        } else if (!e.shiftKey && document.activeElement === ultimo) {
            e.preventDefault();
            primeiro.focus();
        }
    });

    // Navegar para outra rota fecha o painel sem roubar o foco do destino.
    painel.querySelectorAll('a[href]').forEach((a) =>
        a.addEventListener('click', () => fechar(false)),
    );

    // Ao voltar para desktop com o painel aberto, desfaz o estado travado.
    window.matchMedia('(min-width: 48rem)').addEventListener('change', (e) => {
        if (e.matches && aberto) fechar(false);
    });

    fechar(false);
}

export function nav(): void {
    const barra = document.querySelector<HTMLElement>('[data-nav]');
    if (!barra) return;
    estadoFixa(barra);
    painelMobile(barra);
}
