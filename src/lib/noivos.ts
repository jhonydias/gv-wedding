/**
 * Peças comuns da área dos noivos (task 24): sessão, chamada ao Apps Script, a tela de
 * senha, datas, contato e planilha CSV. Usado por /noivos/convidados e /noivos/recebidos.
 *
 * Só carrega nas páginas /noivos. A senha vale no servidor a cada chamada; aqui ela fica
 * em sessionStorage (fechou a aba, esqueceu) só para não ser pedida em cada tela. A chave
 * é a mesma de `admin-presentes.ts`: entrou numa tela, as outras abrem direto.
 *
 * Nada que vem da planilha entra por innerHTML: tudo por textContent.
 */

export const CHAVE_SESSAO = 'gv-noivos';
/** O cold start do Apps Script já foi medido em 7,5 s. */
const TIMEOUT_MS = 25000;
const FUSO = 'America/Belem';

export interface RespostaBase {
    ok: boolean;
    msg?: string;
    motivo?: string;
}

export function lerSessao(): string {
    try {
        return sessionStorage.getItem(CHAVE_SESSAO) ?? '';
    } catch {
        return '';
    }
}

export function gravarSessao(v: string | null): void {
    try {
        if (v === null) sessionStorage.removeItem(CHAVE_SESSAO);
        else sessionStorage.setItem(CHAVE_SESSAO, v);
    } catch {
        /* aba anônima: a senha fica só em memória */
    }
}

export const reais = (v: number): string =>
    new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(v);

const fmtData = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
});
const fmtHora = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });

/** "30/09/2026 às 14:20", no horário de Belém. Data vazia ou ilegível vira ''. */
export function dataHora(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${fmtData.format(d)} às ${fmtHora.format(d)}`;
}

/** "30/09/2026", no horário de Belém. */
export function data(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : fmtData.format(d);
}

/** "2026-09-30": o dia em Belém. Para o nome do arquivo baixado e para contar dias. */
export function diaIso(d: Date = new Date()): string {
    const p = Object.fromEntries(
        new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' })
            .formatToParts(d)
            .map((x) => [x.type, x.value]),
    );
    return `${p.year}-${p.month}-${p.day}`;
}

export const hojeIso = (): string => diaIso();

/** Dias de calendário (em Belém) de hoje até a data: 0 = hoje, 1 = amanhã, negativo = passou. */
export function diasAte(iso: string): number {
    const alvo = new Date(iso);
    if (Number.isNaN(alvo.getTime())) return NaN;
    return Math.round((Date.parse(diaIso(alvo)) - Date.parse(diaIso())) / 86_400_000);
}

/** Para busca: sem acento, minúsculo. "JOÃO" acha "joao". */
export function normalizar(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Link de contato: e-mail vira mailto, celular/telefone com DDD vira tel. Outro texto, nada. */
export function linkContato(contato: string): string | null {
    const c = contato.trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c)) return `mailto:${c}`;
    const dig = c.replace(/\D/g, '');
    if (dig.length === 10 || dig.length === 11) return `tel:+55${dig}`;
    return null;
}

/** Celular digitado só com números vira "(91) 99999-0000". O resto fica como foi digitado. */
export function contatoLegivel(contato: string): string {
    const c = contato.trim();
    if (!/^d{10,11}$/.test(c)) return c;
    return c.length === 11
        ? `(${c.slice(0, 2)}) ${c.slice(2, 7)}-${c.slice(7)}`
        : `(${c.slice(0, 2)}) ${c.slice(2, 6)}-${c.slice(6)}`;
}

/** Elemento de contato: link quando dá, texto quando não. */
export function elementoContato(contato: string): HTMLElement {
    const href = linkContato(contato);
    const el = document.createElement(href ? 'a' : 'span');
    el.textContent = contatoLegivel(contato);
    if (href && el instanceof HTMLAnchorElement) el.href = href;
    return el;
}

/** Atalho para criar elemento com classe e texto. */
export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    classe?: string,
    texto?: string,
): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined) e.textContent = texto;
    return e;
}

/**
 * CSV para abrir no Excel em português: `;` como separador e BOM para o acento sair certo.
 * Célula que começa com = + - @ ganha apóstrofo: senão o Excel a executa como fórmula, e
 * nome e recado foram digitados por convidados.
 */
export function csv(linhas: (string | number)[][]): string {
    const celula = (v: string | number): string => {
        let s = String(v ?? '');
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
        return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return '﻿' + linhas.map((l) => l.map(celula).join(';')).join('\r\n');
}

/**
 * Copiar para a área de transferência. Não importa `copiar.ts`: o Vite o separaria num
 * arquivo compartilhado, e a página pública /presentes ganharia uma requisição a mais.
 */
export async function copiarTexto(texto: string): Promise<boolean> {
    try {
        // Sem resposta em 3 s (permissão pendente), tenta o caminho antigo em vez de ficar mudo.
        await Promise.race([
            navigator.clipboard.writeText(texto),
            new Promise((_, falha) => window.setTimeout(() => falha(new Error('tempo')), 3000)),
        ]);
        return true;
    } catch {
        const ta = document.createElement('textarea');
        ta.value = texto;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.append(ta);
        ta.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch {
            ok = false;
        }
        ta.remove();
        return ok;
    }
}

export function baixar(nomeArquivo: string, conteudo: string, tipo = 'text/csv;charset=utf-8'): void {
    const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
    const a = document.createElement('a');
    a.href = url;
    a.download = nomeArquivo;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface Area {
    /** POST ao Apps Script com a senha. Senha recusada ou bloqueio devolvem à tela de senha. */
    chamar<T extends RespostaBase>(corpo: Record<string, unknown>): Promise<T>;
    sair(msg?: string): void;
}

/**
 * Liga a tela de senha (`Entrar.astro`) e o botão Sair (`Abas.astro`) de uma página.
 * `aoEntrar` roda quando a senha confere, e também ao abrir a página com a sessão guardada.
 */
export function iniciarArea(opcoes: {
    raiz: HTMLElement;
    conteudo: HTMLElement;
    aoEntrar: () => void | Promise<void>;
}): Area {
    const { raiz, conteudo, aoEntrar } = opcoes;
    const endpoint = raiz.dataset.endpoint ?? '';
    const form = raiz.querySelector<HTMLFormElement>('[data-entrar]')!;
    const input = form.elements.namedItem('senha') as HTMLInputElement;
    const erro = form.querySelector<HTMLElement>('[data-erro-senha]')!;
    const botao = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const botaoSair = document.querySelector<HTMLButtonElement>('[data-sair]');

    let senha = lerSessao();

    function mostrarConteudo(sim: boolean): void {
        form.hidden = sim;
        conteudo.hidden = !sim;
        if (botaoSair) botaoSair.hidden = !sim;
    }

    function sair(msg?: string): void {
        senha = '';
        gravarSessao(null);
        mostrarConteudo(false);
        erro.textContent = msg ?? '';
        erro.hidden = !msg;
        if (msg) input.setAttribute('aria-invalid', 'true');
        input.focus();
    }

    async function chamar<T extends RespostaBase>(corpo: Record<string, unknown>): Promise<T> {
        if (!endpoint) return { ok: false, msg: 'O site está sem o endereço do servidor.' } as T;
        const ctrl = new AbortController();
        const t = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
            const r = await fetch(endpoint, {
                method: 'POST',
                // NÃO trocar por application/json: dispara preflight, e o Apps Script não
                // responde OPTIONS.
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ ...corpo, senha }),
                signal: ctrl.signal,
            });
            const j = (await r.json()) as T;
            if (!j.ok && j.msg === 'Ação desconhecida.') {
                return {
                    ok: false,
                    msg: 'O servidor ainda não foi atualizado para esta tela. Avise quem cuida do site.',
                } as T;
            }
            if (!j.ok && (j.motivo === 'senha' || j.motivo === 'bloqueado')) sair(j.msg);
            return j;
        } catch {
            return { ok: false, msg: 'Não conseguimos falar com o servidor. Confira a internet e tente de novo.' } as T;
        } finally {
            window.clearTimeout(t);
        }
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const digitada = input.value.trim();
        if (!digitada) {
            erro.textContent = 'Digite a senha.';
            erro.hidden = false;
            input.setAttribute('aria-invalid', 'true');
            input.focus();
            return;
        }
        senha = digitada;
        botao.disabled = true;
        botao.textContent = 'Entrando…';
        const r = await chamar({ acao: 'entrar' });
        botao.disabled = false;
        botao.textContent = 'Entrar';
        if (!r.ok) {
            // `chamar` já voltou para a senha em caso de senha errada; aqui cobre a rede.
            senha = '';
            erro.textContent = r.msg ?? 'Não deu certo.';
            erro.hidden = false;
            input.setAttribute('aria-invalid', 'true');
            input.focus();
            return;
        }
        input.value = '';
        input.removeAttribute('aria-invalid');
        erro.hidden = true;
        gravarSessao(senha);
        mostrarConteudo(true);
        await aoEntrar();
    });

    botaoSair?.addEventListener('click', () => sair());

    if (senha) {
        mostrarConteudo(true);
        // Depois do return: `aoEntrar` costuma usar o objeto que esta função devolve, e
        // chamá-lo aqui, síncrono, o pegaria antes de existir (ReferenceError na página).
        queueMicrotask(() => void aoEntrar());
    } else {
        mostrarConteudo(false);
    }

    return { chamar, sair };
}
