/**
 * Modal de pagamento Pix — task 07 §3.3.
 *
 * O botão de copiar é o caminho real: quase ninguém escaneia um QR no próprio celular.
 * Ele é o elemento mais evidente do modal, não o QR.
 */

async function copiar(texto: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(texto);
        return true;
    } catch {
        // Fallback para browser antigo ou contexto sem permissão de clipboard.
        const ta = document.createElement('textarea');
        ta.value = texto;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch {
            ok = false;
        }
        document.body.removeChild(ta);
        return ok;
    }
}

export function modalPix(): void {
    const dlg = document.querySelector<HTMLDialogElement>('#pix');
    if (!dlg) return;

    const elNome = dlg.querySelector<HTMLElement>('[data-pix-nome]');
    const elValor = dlg.querySelector<HTMLElement>('[data-pix-valor]');
    const elCodigo = dlg.querySelector<HTMLElement>('[data-pix-codigo]');
    const elQr = dlg.querySelector<HTMLElement>('[data-pix-qr]');
    const elWhats = dlg.querySelector<HTMLAnchorElement>('[data-pix-whatsapp]');
    const btnCopiar = dlg.querySelector<HTMLButtonElement>('[data-copiar]');
    const btnFechar = dlg.querySelector<HTMLButtonElement>('[data-fechar]');
    const aviso = dlg.querySelector<HTMLElement>('[data-copiado]');

    let origem: HTMLElement | null = null;

    /** Idempotente, e chamada por todos os caminhos de fechamento — mesma lição da task 05:
        não depender do evento `close` para restaurar o scroll do <body>. */
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
            btnCopiar?.focus();
        });
    });

    btnCopiar?.addEventListener('click', async () => {
        const ok = await copiar(elCodigo?.textContent ?? '');
        if (!aviso) return;
        aviso.textContent = ok
            ? 'Código copiado!'
            : 'Não deu para copiar. Selecione o código e copie à mão.';
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
