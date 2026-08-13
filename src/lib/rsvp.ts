/**
 * RSVP — cliente. Task 06.
 *
 * O <form> tem `action` e `method` reais: sem JS o POST nativo acontece e o Apps Script
 * responde uma página de confirmação. Com JS, interceptamos e viramos fetch.
 */

const LIM = { nomeMin: 3, nomeMax: 80, restricao: 300, recado: 500 } as const;

export interface Resposta {
    ok: boolean;
    msg?: string;
    protocolo?: string;
}

/** Aceita e-mail OU celular brasileiro. O convidado escolhe como quer ser achado. */
export function contatoValido(v: string): boolean {
    const s = v.trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return true;
    const so = s.replace(/\D/g, '');
    return so.length === 10 || so.length === 11;
}

export function validarCampo(nome: string, valor: string, comparece: string | null): string | null {
    const v = valor.trim();
    switch (nome) {
        case 'nome':
            if (v.length < LIM.nomeMin) return 'Escreva seu nome completo, com pelo menos 3 letras.';
            if (v.length > LIM.nomeMax) return `Use no máximo ${LIM.nomeMax} caracteres.`;
            return null;
        case 'contato':
            if (!v) return 'Precisamos de um contato para falar com você.';
            if (!contatoValido(v))
                return 'Informe um e-mail válido, como nome@email.com, ou um celular com DDD.';
            return null;
        case 'comparece':
            if (!comparece) return 'Escolha uma das opções.';
            return null;
        case 'restricao':
            if (v.length > LIM.restricao) return `Use no máximo ${LIM.restricao} caracteres.`;
            return null;
        case 'recado':
            if (v.length > LIM.recado) return `Use no máximo ${LIM.recado} caracteres.`;
            return null;
        default:
            return null;
    }
}

function mostrarErro(form: HTMLFormElement, campo: string, msg: string | null): void {
    const el = form.querySelector<HTMLElement>(`[name="${campo}"]`);
    const alvo = el ?? form.querySelector<HTMLElement>(`[data-grupo="${campo}"]`);
    const caixa = form.querySelector<HTMLElement>(`#erro-${campo}`);
    if (!caixa) return;

    caixa.textContent = msg ?? '';
    caixa.hidden = msg === null;

    if (campo === 'comparece') {
        form.querySelectorAll<HTMLInputElement>('[name="comparece"]').forEach((r) =>
            r.setAttribute('aria-invalid', msg ? 'true' : 'false'),
        );
    } else {
        alvo?.setAttribute('aria-invalid', msg ? 'true' : 'false');
    }
}

export function rsvp(): void {
    const form = document.querySelector<HTMLFormElement>('[data-rsvp]');
    if (!form) return;

    const endpoint = form.getAttribute('action') ?? '';
    const botao = form.querySelector<HTMLButtonElement>('[data-enviar]');
    const painelOk = document.querySelector<HTMLElement>('[data-sucesso]');
    const painelErro = form.querySelector<HTMLElement>('[data-erro-geral]');
    const acompanhantesBloco = form.querySelector<HTMLElement>('[data-acompanhantes]');

    const comparece = (): string | null =>
        form.querySelector<HTMLInputElement>('[name="comparece"]:checked')?.value ?? null;

    // Acompanhantes só fazem sentido para quem vai.
    const sincronizarAcompanhantes = (): void => {
        if (!acompanhantesBloco) return;
        acompanhantesBloco.hidden = comparece() !== 'sim';
    };
    form.querySelectorAll('[name="comparece"]').forEach((r) => {
        r.addEventListener('change', () => {
            sincronizarAcompanhantes();
            mostrarErro(form, 'comparece', null);
        });
    });
    sincronizarAcompanhantes();

    // Validação no `blur`, nunca enquanto digita: erro na terceira letra do nome é ruído.
    for (const campo of ['nome', 'contato', 'restricao', 'recado']) {
        const el = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${campo}"]`);
        el?.addEventListener('blur', () =>
            mostrarErro(form, campo, validarCampo(campo, el.value, comparece())),
        );
        el?.addEventListener('input', () => {
            if (el.getAttribute('aria-invalid') === 'true') mostrarErro(form, campo, null);
        });
    }

    const definirEstado = (estado: 'ocioso' | 'enviando'): void => {
        const enviando = estado === 'enviando';
        if (botao) {
            botao.setAttribute('aria-busy', String(enviando));
            botao.textContent = enviando ? 'Enviando…' : 'Confirmar presença';
        }
        // `readonly`, não `disabled`: `disabled` tira do fluxo de foco e o leitor de
        // tela perde o contexto do formulário.
        form.querySelectorAll<HTMLInputElement>('input, textarea').forEach((el) => {
            if (el.type !== 'radio') el.readOnly = enviando;
        });
    };

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (painelErro) painelErro.hidden = true;

        const dados = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;

        // Revalida tudo e manda o foco para o primeiro erro. O botão NUNCA fica
        // desabilitado: botão inerte sem explicação é beco sem saída.
        let primeiroErro: string | null = null;
        for (const campo of ['nome', 'contato', 'comparece', 'restricao', 'recado']) {
            const msg = validarCampo(campo, dados[campo] ?? '', comparece());
            mostrarErro(form, campo, msg);
            if (msg && !primeiroErro) primeiroErro = campo;
        }
        if (primeiroErro) {
            const alvo =
                form.querySelector<HTMLElement>(`[name="${primeiroErro}"]`) ??
                form.querySelector<HTMLElement>(`[data-grupo="${primeiroErro}"]`);
            alvo?.focus();
            return;
        }

        definirEstado('enviando');
        try {
            const r = await fetch(endpoint, {
                method: 'POST',
                // NÃO trocar por application/json: dispara preflight OPTIONS, e o
                // Apps Script não responde OPTIONS. O erro parece de permissão e não é.
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(dados),
            });
            const resposta = (await r.json()) as Resposta;

            if (!resposta.ok) throw new Error(resposta.msg ?? 'Não foi possível registrar.');

            if (painelOk) {
                const prot = painelOk.querySelector<HTMLElement>('[data-protocolo]');
                if (prot) prot.textContent = resposta.protocolo ?? '—';
                const tit = painelOk.querySelector<HTMLElement>('[data-sucesso-titulo]');
                if (tit) {
                    tit.textContent =
                        comparece() === 'sim'
                            ? 'Presença confirmada!'
                            : 'Obrigado por avisar.';
                }
                const txt = painelOk.querySelector<HTMLElement>('[data-sucesso-texto]');
                if (txt) {
                    txt.textContent =
                        comparece() === 'sim'
                            ? 'A gente mal pode esperar para ver você lá.'
                            : 'Que pena que não vai dar. Você vai fazer falta.';
                }
                form.hidden = true;
                painelOk.hidden = false;
                painelOk.focus();
            }
        } catch (err) {
            // Os dados preenchidos PERMANECEM. Perder o que a pessoa digitou é o
            // pior desfecho possível.
            definirEstado('ocioso');
            if (painelErro) {
                painelErro.hidden = false;
                const detalhe = painelErro.querySelector<HTMLElement>('[data-erro-detalhe]');
                if (detalhe) {
                    detalhe.textContent =
                        err instanceof Error ? err.message : 'Não conseguimos registrar agora.';
                }
            }
        }
    });
}
