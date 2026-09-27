/**
 * Modal "Presentear" — task 22 §7.1 (sobre o modal Pix da task 07).
 *
 * Duas etapas no mesmo <dialog>:
 *   1. dados (nome, contato, recado, e o valor se for valor livre) → POST checkout →
 *      redireciona para o Mercado Pago;
 *   2. Pix estático, que é o caminho quando o Mercado Pago está desligado (`pagamento` =
 *      `pix` no ?acao=status), e o plano B quando ele não responde.
 *
 * O navegador NUNCA decide que algo foi pago: ele só manda para o checkout. Quem confirma
 * é o servidor, perguntando ao Mercado Pago (task 22 §2).
 */
import { copiar } from './copiar';
import type { ModoPagamento } from './status';
import { CHAVE_ULTIMO } from './sessao-checkout';

/** Preferência + cold start do Apps Script (~8 s medido). */
const TIMEOUT_MS = 25000;
const CHAVE_TESTE = 'gv-mp-teste';

interface Resposta {
    ok: boolean;
    motivo?: string;
    campo?: string;
    msg?: string;
    ref?: string;
    init_point?: string;
    reservado?: boolean;
}

const sessao = {
    ler(chave: string): string | null {
        try {
            return sessionStorage.getItem(chave);
        } catch {
            return null;
        }
    },
    gravar(chave: string, valor: string): void {
        try {
            sessionStorage.setItem(chave, valor);
        } catch {
            /* aba anônima: segue sem */
        }
    },
};

/** Modo teste (task 22 §6.1): `?teste=<chave>` na URL fica guardado na aba. */
function chaveTeste(): string {
    const daUrl = new URLSearchParams(location.search).get('teste');
    if (daUrl) sessao.gravar(CHAVE_TESTE, daUrl);
    return daUrl ?? sessao.ler(CHAVE_TESTE) ?? '';
}

const novoPedido = (): string =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function modalPresente(statusPronto: Promise<ModoPagamento>): void {
    const dlg = document.querySelector<HTMLDialogElement>('#pix');
    if (!dlg) return;
    const endpoint = import.meta.env.PUBLIC_BACKEND_URL ?? '';
    const teste = chaveTeste();

    let modo: ModoPagamento = null;
    void statusPronto.then((m) => {
        modo = m;
    });

    const $ = <T extends HTMLElement>(sel: string): T | null => dlg.querySelector<T>(sel);
    const elNome = $('[data-pix-nome]');
    const elValor = $('[data-pix-valor]');
    const elCodigo = $('[data-pix-codigo]');
    const elQr = $('[data-pix-qr]');
    const elWhats = $<HTMLAnchorElement>('[data-pix-whatsapp]');
    const btnCopiar = $<HTMLButtonElement>('[data-copiar]');
    const btnFechar = $<HTMLButtonElement>('[data-fechar]');
    const aviso = $('[data-copiado]');
    const form = $<HTMLFormElement>('[data-etapa-dados]');
    const etapaPix = $('[data-etapa-pix]');
    const avisoPix = $('[data-pix-aviso]');
    const avisoLivre = $('[data-pix-livre]');
    const erro = $('[data-pag-erro]');
    const btnIr = $<HTMLButtonElement>('[data-ir]');
    const campoValor = $('[data-campo-valor]');
    const ajudaValor = $('[data-valor-ajuda]');

    let origem: HTMLElement | null = null;
    let pedido = novoPedido();
    let enviando = false;

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

    const input = (nome: string): HTMLInputElement | HTMLTextAreaElement | null =>
        form?.elements.namedItem(nome) as HTMLInputElement | HTMLTextAreaElement | null;

    function mostrarErro(msg: string, campo?: string): void {
        if (erro) {
            erro.textContent = msg;
            erro.hidden = !msg;
        }
        for (const n of ['nome', 'contato', 'valor']) input(n)?.removeAttribute('aria-invalid');
        if (campo) {
            const el = input(campo);
            el?.setAttribute('aria-invalid', 'true');
            el?.focus();
        }
    }

    /** Pix: o caminho com o Mercado Pago desligado, ou o plano B com aviso. */
    function mostrarPix(comoPlanoB: boolean): void {
        if (form) form.hidden = true;
        if (etapaPix) etapaPix.hidden = false;
        if (avisoPix) avisoPix.hidden = !comoPlanoB;
        if (avisoLivre) avisoLivre.hidden = !origem?.hasAttribute('data-livre');
        btnCopiar?.focus();
    }

    function mostrarDados(): void {
        if (etapaPix) etapaPix.hidden = true;
        if (form) {
            form.hidden = false;
            form.reset();
        }
        mostrarErro('');
        const livre = origem?.hasAttribute('data-livre') ?? false;
        if (campoValor) campoValor.hidden = !livre;
        if (livre && ajudaValor) ajudaValor.textContent = `A partir de R$ ${origem?.dataset.minimo ?? ''}, sem centavos.`;
        pedido = novoPedido();
        (livre ? input('valor') : input('nome'))?.focus();
    }

    /** Checkout só quando o servidor disse que está ligado, ou quando não deu para saber. */
    const usarCheckout = (): boolean =>
        endpoint !== '' && (modo === 'mercadopago' || modo === null || (modo === 'teste' && teste !== ''));

    document.querySelectorAll<HTMLElement>('[data-presente]').forEach((botao) => {
        botao.addEventListener('click', () => {
            origem = botao;
            const { nome, valor, codigo, qr, whatsapp } = botao.dataset;
            if (elNome) elNome.textContent = nome ?? '';
            if (elValor) elValor.textContent = valor ?? '';
            if (elCodigo) elCodigo.textContent = codigo ?? '';
            if (elQr) elQr.innerHTML = qr ?? '';
            if (elWhats && whatsapp) elWhats.href = whatsapp;
            if (aviso) aviso.textContent = '';

            const barra = window.innerWidth - document.documentElement.clientWidth;
            document.body.style.overflow = 'hidden';
            if (barra > 0) document.body.style.paddingRight = `${barra}px`;
            dlg.showModal();

            if (usarCheckout()) mostrarDados();
            else mostrarPix(false);
        });
    });

    form?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (enviando || !origem) return;
        const f = new FormData(form);
        const nome = String(f.get('nome') ?? '').trim();
        const livre = origem.hasAttribute('data-livre');
        const minimo = Number(origem.dataset.minimo ?? 0);
        const valorTxt = String(f.get('valor') ?? '').replace(/\D/g, '');
        const valor = valorTxt ? Number(valorTxt) : NaN;

        if (livre && (!Number.isInteger(valor) || valor < minimo || valor > 5000)) {
            mostrarErro(`Escolha um valor entre R$ ${minimo} e R$ 5.000, sem centavos.`, 'valor');
            return;
        }
        if (nome.length < 2) {
            mostrarErro('Escreva seu nome, para os noivos saberem quem deu.', 'nome');
            return;
        }

        enviando = true;
        mostrarErro('');
        if (btnIr) {
            btnIr.disabled = true;
            btnIr.textContent = 'Abrindo o pagamento…';
        }
        const corpo = {
            acao: 'checkout',
            pedido_id: pedido,
            presente_id: origem.dataset.id,
            nome,
            contato: String(f.get('contato') ?? '').trim(),
            recado: String(f.get('recado') ?? '').trim(),
            valor: livre ? valor : undefined,
            chave_teste: teste || undefined,
            _gotcha: String(f.get('_gotcha') ?? ''),
        };

        let r: Resposta;
        const ctrl = new AbortController();
        const t = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
            const resp = await fetch(endpoint, {
                method: 'POST',
                // NÃO trocar por application/json: dispara preflight, e o Apps Script não
                // responde OPTIONS (task 06 §1.1).
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(corpo),
                signal: ctrl.signal,
            });
            r = (await resp.json()) as Resposta;
        } catch {
            r = { ok: false, motivo: 'rede' };
        } finally {
            window.clearTimeout(t);
        }

        enviando = false;
        if (btnIr) {
            btnIr.disabled = false;
            btnIr.textContent = 'Ir para o pagamento';
        }

        if (r.ok && r.init_point && r.ref) {
            // Guarda para a página de retorno, caso o Mercado Pago volte sem a ref na URL.
            sessao.gravar(CHAVE_ULTIMO, JSON.stringify({ ref: r.ref, presente: origem.dataset.nome, criado: Date.now() }));
            if (btnIr) {
                btnIr.disabled = true;
                btnIr.textContent = 'Indo para o Mercado Pago…';
            }
            location.assign(r.init_point);
            return;
        }
        if (r.ok) {
            // Honeypot: o servidor finge sucesso. Ninguém de verdade chega aqui.
            encerrar();
            return;
        }
        // `indisponivel`: Mercado Pago desligado ou fora. Sem `motivo` nem `campo`: backend que
        // não conhece o checkout (anterior à task 22) ou erro inesperado. Nos dois, Pix.
        if (r.motivo === 'indisponivel' || (!r.motivo && !r.campo)) {
            // Mercado Pago desligado ou fora: Pix direto, avisando que não confirma sozinho.
            mostrarPix(true);
            return;
        }
        if (r.motivo === 'indisponivel_presente' || r.motivo === 'nao_existe') {
            mostrarErro(r.msg ?? 'Este presente não está mais disponível.');
            if (!r.reservado && origem instanceof HTMLButtonElement) {
                origem.disabled = true;
                origem.textContent = 'Presenteado 💛';
            }
            return;
        }
        if (r.motivo === 'rede') {
            mostrarErro('Não conseguimos abrir o pagamento. Tente de novo, ou use o Pix direto abaixo.');
            return;
        }
        mostrarErro(r.msg ?? 'Não deu certo. Tente de novo.', r.campo);
    });

    $('[data-pix-direto]')?.addEventListener('click', () => mostrarPix(true));

    btnCopiar?.addEventListener('click', async () => {
        const ok = await copiar(elCodigo?.textContent ?? '');
        if (!aviso) return;
        aviso.textContent = ok ? 'Código copiado!' : 'Não deu para copiar. Selecione o código e copie à mão.';
        window.setTimeout(() => {
            aviso.textContent = '';
        }, 2500);
    });

    btnFechar?.addEventListener('click', encerrar);
    dlg.addEventListener('click', (e) => {
        if (e.target === dlg) encerrar();
    });
    dlg.addEventListener('cancel', limpar);
    dlg.addEventListener('close', limpar);
}
