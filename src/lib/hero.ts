/**
 * Rotação das fotos do hero — task 13 §4.5.
 *
 * A primeira foto já está no HTML e visível. As outras vivem dentro de um `<template>`,
 * inerte, e só entram no documento quando este módulo as clona. É assim que a primeira
 * tela carrega UMA foto: a home tem 40 ms de folga no teto de LCP da task 02 §6, e uma
 * segunda imagem de tela cheia no caminho crítico gasta isso sozinha.
 */

/**
 * 7 s parado e 1,4 s de fusão.
 *
 * Abaixo de ~5 s a troca compete com a leitura dos nomes e da data e o hero fica inquieto.
 * Acima de ~10 s a maioria rola a página antes da segunda foto e o efeito não existe.
 * O 1400 tem que casar com a `transition` do `.hero__foto` no Hero.astro.
 */
const INTERVALO_MS = 7000;
const TROCA_MS = 1400;

/**
 * Espera depois do `load` antes de PEDIR a segunda foto.
 *
 * O `load` sozinho não basta, e isto foi medido: pedindo a segunda foto no próprio evento
 * de `load`, o Lighthouse mediu **LCP 3,53 s e performance 91** na home, contra 1,96 s e
 * 99 antes. A segunda foto (145 KB) saía do servidor 44 ms depois da primeira (85 KB), ou
 * seja, ANTES da pintura do LCP, e entrava no grafo de dependências do caminho crítico.
 *
 * Num servidor local o `load` acontece em dezenas de milissegundos. Numa rede real, o
 * `load` já é tarde e esta espera é irrelevante. Ela existe para o caso rápido, que é
 * justamente o que o Lighthouse simula lento.
 */
const ESPERA_LCP_MS = 2500;

/** Primeira troca: cai em ~7 s depois do `load`, somando a espera acima. */
const PRIMEIRO_INTERVALO_MS = INTERVALO_MS - ESPERA_LCP_MS;

const reduzido = (): boolean =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function heroFotos(): void {
    // Regra 3 do README das tasks: a checagem vem ANTES de instalar qualquer coisa.
    // Sem este `return`, movimento reduzido não desligaria a rotação: com as durações
    // zeradas pelo motion.css, as fotos passariam a SALTAR de uma para outra, que é pior
    // que não animar.
    if (reduzido()) return;

    const fundo = document.querySelector<HTMLElement>('[data-hero-fundo]');
    const molde = document.querySelector<HTMLTemplateElement>('[data-hero-extras]');
    if (!fundo || !molde) return;

    const primeira = fundo.querySelector<HTMLImageElement>('.hero__foto');
    const moldes = [...molde.content.querySelectorAll('img')];
    if (!primeira || moldes.length === 0) return;

    /** Índice 0 é a foto do HTML; 1..n são os clones, criados sob demanda. */
    const fotos: (HTMLImageElement | undefined)[] = [primeira];
    const total = moldes.length + 1;

    let atual = 0;
    let timer: number | undefined;
    let naTela = true;

    /**
     * Insere a foto no documento, o que dispara o download. Idempotente: chamar duas
     * vezes para o mesmo índice não cria um segundo elemento.
     */
    const preparar = (i: number): HTMLImageElement | undefined => {
        if (i === 0) return fotos[0];
        const existente = fotos[i];
        if (existente) return existente;
        const modelo = moldes[i - 1];
        if (!modelo) return undefined;
        const el = modelo.cloneNode(true) as HTMLImageElement;
        // Sai do `lazy` assim que entra no documento: a partir daqui a foto é esperada,
        // e o adiamento já foi feito pelo <template>.
        el.loading = 'eager';
        fundo.appendChild(el);
        fotos[i] = el;
        return el;
    };

    const carregada = (el: HTMLImageElement): boolean => el.complete && el.naturalWidth > 0;

    const agendar = (ms: number): void => {
        window.clearTimeout(timer);
        if (!naTela || document.hidden) return;
        timer = window.setTimeout(trocar, ms);
    };

    const trocar = (): void => {
        const proximo = (atual + 1) % total;
        const alvo = preparar(proximo);

        // Nunca mostrar quadro em branco: se a próxima ainda não baixou, adia a troca em
        // vez de trocar. Mesmo princípio do pré-carregamento das vizinhas no lightbox.
        if (!alvo || !carregada(alvo)) {
            agendar(1000);
            return;
        }

        fotos[atual]?.classList.remove('hero__foto--ativa');
        alvo.classList.add('hero__foto--ativa');
        atual = proximo;

        // Adianta a seguinte durante a fusão, para ela ter os 7 s inteiros de folga.
        preparar((atual + 1) % total);
        agendar(INTERVALO_MS + TROCA_MS);
    };

    /**
     * A segunda foto só é PEDIDA depois do `load` mais `ESPERA_LCP_MS`. Duas razões: não
     * competir com o LCP (medido, ver a constante), e não arriscar que uma foto pintada
     * mais tarde vire um candidato novo a LCP (task 13 §1.1).
     */
    const comecar = (): void => {
        window.setTimeout(() => {
            preparar(1);
            agendar(PRIMEIRO_INTERVALO_MS);
        }, ESPERA_LCP_MS);
    };

    if (document.readyState === 'complete') comecar();
    else window.addEventListener('load', comecar, { once: true });

    // Aba em segundo plano não gasta bateria trocando foto que ninguém vê. Ao voltar,
    // recomeça a contagem em vez de disparar as trocas acumuladas.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) window.clearTimeout(timer);
        else agendar(INTERVALO_MS);
    });

    // Fora da viewport, idem. O hero ocupa a primeira tela: depois que o visitante rola,
    // a rotação não tem para quem acontecer.
    const observador = new IntersectionObserver(
        (entradas) => {
            const e = entradas[0];
            if (!e) return;
            naTela = e.isIntersecting;
            if (naTela) agendar(INTERVALO_MS);
            else window.clearTimeout(timer);
        },
        { threshold: 0.15 },
    );
    const secao = fundo.closest('.hero');
    if (secao) observador.observe(secao);
}
