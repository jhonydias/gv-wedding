/**
 * Revelação tipográfica conforme a rolagem — inspirada nos reveals do modo-bim.
 *
 *  1. `tipografiaAnimada()` — quebra títulos em PALAVRAS e as revela escalonadas ao
 *     entrarem em cena.
 *  2. `heroScroll()` — liga a opacidade e a deriva do hero à posição da rolagem.
 *
 * Por que palavra e não letra: quebrar por caractere transforma cada letra num
 * `inline-block`, o que destrói o kerning e o entrelinhamento — visível e feio num
 * display serifado grande. Por palavra, cada bloco preserva o kerning interno.
 * O hero usa revelação por LINHA (`data-revela`), pelo mesmo motivo.
 *
 * Acessibilidade: o texto original vai para `aria-label` e os fragmentos ficam
 * `aria-hidden`, para o leitor de tela não ler pedaço por pedaço.
 */

const reduzido = (): boolean =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function fragmentar(el: HTMLElement): HTMLElement[] {
    const texto = el.textContent ?? '';
    if (!texto.trim()) return [];

    el.setAttribute('aria-label', texto.trim());

    const spans: HTMLElement[] = [];
    const nos: Node[] = [];

    for (const parte of texto.split(/(\s+)/)) {
        if (parte === '') continue;
        if (/^\s+$/.test(parte)) {
            // O espaço fica como nó de texto para a quebra de linha continuar natural.
            nos.push(document.createTextNode(parte));
            continue;
        }
        const s = document.createElement('span');
        s.className = 'frag';
        s.textContent = parte;
        s.setAttribute('aria-hidden', 'true');
        nos.push(s);
        spans.push(s);
    }

    /*
     * `replaceChildren` de uma vez, e NUNCA `textContent = ''` seguido de appends.
     * Esvaziar primeiro colapsa a altura do elemento por um quadro e empurra a página
     * inteira — o Lighthouse mediu CLS 0.142 em /historia por causa disso.
     */
    el.replaceChildren(...nos);
    return spans;
}

function observar(el: HTMLElement, spans: HTMLElement[], passo: number): void {
    const io = new IntersectionObserver(
        (entradas) => {
            for (const e of entradas) {
                if (!e.isIntersecting) continue;
                spans.forEach((s, i) => {
                    s.style.transitionDelay = `${i * passo}ms`;
                    s.classList.add('visivel');
                    // Zera o atraso depois de revelar: deixá-lo pendurado faz qualquer
                    // recálculo de estilo posterior re-animar o fragmento com delay.
                    window.setTimeout(
                        () => {
                            s.style.transitionDelay = '';
                        },
                        i * passo + 900,
                    );
                });
                io.unobserve(e.target);
            }
        },
        { rootMargin: '0px 0px -10% 0px', threshold: 0.15 },
    );
    io.observe(el);
}

export function tipografiaAnimada(): void {
    // Com movimento reduzido nem fragmenta: o texto fica intacto, sem span nenhum.
    if (reduzido()) return;

    document.querySelectorAll<HTMLElement>('[data-palavras]').forEach((el) => {
        const spans = fragmentar(el);
        if (spans.length) observar(el, spans, 70);
    });
}

/**
 * Hero ligado à rolagem: o bloco de texto some e sobe suavemente conforme desce a página.
 *
 * Um único listener com throttle por rAF — mesmo padrão da nav. Escrever um listener
 * por efeito é o que trava a rolagem em celular fraco.
 */
export function heroScroll(): void {
    const alvo = document.querySelector<HTMLElement>('[data-hero-conteudo]');
    if (!alvo || reduzido()) return;

    let agendado = false;

    const aplicar = (): void => {
        // Progresso de 0 a 1 ao longo da primeira tela.
        const p = Math.min(1, window.scrollY / (window.innerHeight * 0.75));
        alvo.style.opacity = String(1 - p);
        // Só transform: nada que recalcule layout a cada quadro.
        alvo.style.transform = `translate3d(0, ${(-p * 60).toFixed(1)}px, 0)`;
        agendado = false;
    };

    window.addEventListener(
        'scroll',
        () => {
            if (agendado) return;
            agendado = true;
            requestAnimationFrame(aplicar);
        },
        { passive: true },
    );

    aplicar();
}
