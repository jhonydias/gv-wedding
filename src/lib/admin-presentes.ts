/**
 * Área dos noivos: criar, editar e apagar presentes. Task 17.
 * Quem deu o quê mora em /noivos/recebidos desde a task 24 (src/lib/admin-recebidos.ts).
 *
 * Só carrega em /noivos/presentes. A senha vale no servidor a cada chamada; aqui ela fica
 * em sessionStorage (fechou a aba, esqueceu) só para não ser pedida a cada ação.
 *
 * Nada de dado vindo da planilha entra por innerHTML: tudo por textContent.
 */
import type { Faixa } from '../data/presentes';

interface Pagamentos {
    pendente: number;
    confirmado: number;
    cancelado: number;
    total: number;
}

interface Item {
    id: string;
    nome: string;
    valor: number;
    faixa: string;
    imagem: string;
    descricao: string;
    cotas: number | null;
    ativo: boolean;
    /** Task 22 §5.4: o convidado escolhe o valor; `valor` é o mínimo. */
    valor_livre?: boolean;
    ordem: number;
    pagamentos: Pagamentos;
    versao: string;
}

interface Resposta {
    ok: boolean;
    msg?: string;
    motivo?: string;
    campo?: string;
    id?: string;
    nome?: string;
    faixa?: string;
    avisos?: string[];
    publicacao?: string;
    presentes?: Item[];
    presente?: Item;
}

/** A mesma chave de src/lib/noivos.ts: entrou numa tela dos noivos, as outras abrem direto. */
const CHAVE_SESSAO = 'gv-noivos';
/** POST com pré-voo de imagem e chamada ao GitHub; o cold start do Apps Script já deu 7,5 s. */
const TIMEOUT_MS = 25000;

const reais = (v: number): string =>
    new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(v);

const novoPedido = (): string =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function lerSessao(): string {
    try {
        return sessionStorage.getItem(CHAVE_SESSAO) ?? '';
    } catch {
        return '';
    }
}
function gravarSessao(v: string | null): void {
    try {
        if (v === null) sessionStorage.removeItem(CHAVE_SESSAO);
        else sessionStorage.setItem(CHAVE_SESSAO, v);
    } catch {
        /* aba anônima: a senha fica só em memória */
    }
}

export function adminPresentes(): void {
    const raiz = document.querySelector<HTMLElement>('[data-admin]');
    if (!raiz) return;
    const endpoint = raiz.dataset.endpoint ?? '';
    const FAIXAS = JSON.parse(raiz.dataset.faixas ?? '[]') as { id: Faixa; titulo: string }[];
    const tituloFaixa = (id: string): string => FAIXAS.find((f) => f.id === id)?.titulo ?? id;

    const $ = <T extends HTMLElement>(sel: string): T => raiz.querySelector<T>(sel)!;
    const formEntrar = $<HTMLFormElement>('[data-entrar]');
    const painel = $('[data-painel]');
    const lista = $('[data-lista]');
    const mensagem = $('[data-mensagem]');
    // Fica no componente Abas, fora de [data-admin].
    const botaoSair = document.querySelector<HTMLButtonElement>('[data-sair]');
    const editor = $<HTMLFormElement>('[data-editor]');
    const campo = (n: string) => editor.elements.namedItem(n) as HTMLInputElement;

    let senha = lerSessao();
    let itens: Item[] = [];
    let editando: Item | null = null;
    let pedido = novoPedido();
    let enviando = false;

    // ------------------------------------------------------------ rede

    async function chamar(corpo: Record<string, unknown>): Promise<Resposta> {
        if (!endpoint) return { ok: false, msg: 'O site está sem o endereço do servidor.' };
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
            const j = (await r.json()) as Resposta;
            if (!j.ok && j.msg === 'Ação desconhecida.') {
                return { ok: false, msg: 'O servidor ainda não foi atualizado para esta tela. Avise quem cuida do site.' };
            }
            if (!j.ok && (j.motivo === 'senha' || j.motivo === 'bloqueado')) sair(j.msg);
            return j;
        } catch {
            return { ok: false, msg: 'Não conseguimos falar com o servidor. Confira a internet e tente de novo.' };
        } finally {
            window.clearTimeout(t);
        }
    }

    // ------------------------------------------------------------ entrar / sair

    function sair(msg?: string): void {
        senha = '';
        gravarSessao(null);
        painel.hidden = true;
        editor.hidden = true;
        formEntrar.hidden = false;
        if (botaoSair) botaoSair.hidden = true;
        const erro = $('#erro-senha');
        erro.textContent = msg ?? '';
        erro.hidden = !msg;
    }

    formEntrar.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = formEntrar.elements.namedItem('senha') as HTMLInputElement;
        const botao = formEntrar.querySelector('button')!;
        senha = input.value.trim();
        if (!senha) return;
        botao.disabled = true;
        botao.textContent = 'Entrando…';
        const r = await chamar({ acao: 'entrar' });
        botao.disabled = false;
        botao.textContent = 'Entrar';
        if (!r.ok) {
            const erro = $('#erro-senha');
            erro.textContent = r.msg ?? 'Não deu certo.';
            erro.hidden = false;
            input.setAttribute('aria-invalid', 'true');
            input.focus();
            return;
        }
        input.value = '';
        input.removeAttribute('aria-invalid');
        gravarSessao(senha);
        await abrirPainel();
    });

    // ------------------------------------------------------------ lista

    function avisar(texto: string): void {
        mensagem.textContent = texto;
        mensagem.hidden = !texto;
        if (texto) mensagem.focus();
    }

    async function carregar(): Promise<boolean> {
        lista.textContent = 'Carregando os presentes…';
        const r = await chamar({ acao: 'listarPresentes' });
        if (!r.ok || !r.presentes) {
            lista.textContent = r.msg ?? 'Não conseguimos carregar a lista.';
            return false;
        }
        itens = r.presentes;
        desenharLista();
        return true;
    }

    async function abrirPainel(): Promise<void> {
        formEntrar.hidden = true;
        editor.hidden = true;
        painel.hidden = false;
        if (botaoSair) botaoSair.hidden = false;
        await carregar();
    }

    function selos(p: Item): string[] {
        const s: string[] = [p.ativo ? 'No site' : 'Fora do site'];
        if (p.pagamentos.confirmado > 0) {
            s.push(p.cotas ? `${p.pagamentos.confirmado} de ${p.cotas} dados` : `${p.pagamentos.confirmado} dados`);
        }
        if (p.pagamentos.pendente > 0) s.push(`${p.pagamentos.pendente} aguardando pagamento`);
        if (p.valor_livre) s.push('Valor livre');
        return s;
    }

    function desenharLista(): void {
        lista.textContent = '';
        if (itens.length === 0) {
            lista.textContent = 'Nenhum presente cadastrado ainda.';
            return;
        }
        for (const f of FAIXAS) {
            const daFaixa = itens.filter((p) => p.faixa === f.id);
            if (!daFaixa.length) continue;
            const grupo = document.createElement('section');
            grupo.className = 'grupo';
            const h = document.createElement('h2');
            h.textContent = `${f.titulo} (${daFaixa.length})`;
            const ul = document.createElement('ul');
            ul.className = 'itens';
            for (const p of daFaixa) ul.append(linha(p));
            grupo.append(h, ul);
            lista.append(grupo);
        }
        // Categoria desconhecida (editada à mão na planilha): não some da tela.
        const orfaos = itens.filter((p) => !FAIXAS.some((f) => f.id === p.faixa));
        if (orfaos.length) {
            const grupo = document.createElement('section');
            grupo.className = 'grupo';
            const h = document.createElement('h2');
            h.textContent = 'Sem categoria (não aparecem no site)';
            const ul = document.createElement('ul');
            ul.className = 'itens';
            for (const p of orfaos) ul.append(linha(p));
            grupo.append(h, ul);
            lista.append(grupo);
        }
    }

    function miniatura(url: string): HTMLElement {
        if (url) {
            const img = document.createElement('img');
            img.className = 'item__foto';
            img.alt = '';
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
            img.src = url;
            img.addEventListener('error', () => img.replaceWith(miniatura('')));
            return img;
        }
        const s = document.createElement('span');
        s.className = 'item__foto';
        s.innerHTML = $('[data-previa-marca]').innerHTML; // SVG da marca, estático
        return s;
    }

    function linha(p: Item): HTMLLIElement {
        const li = document.createElement('li');
        li.className = p.ativo ? 'item' : 'item item--fora';
        const abrir = document.createElement('button');
        abrir.type = 'button';
        abrir.className = 'item__abrir';
        const nome = document.createElement('span');
        nome.className = 'item__nome';
        nome.textContent = p.nome;
        const info = document.createElement('span');
        info.className = 'item__info';
        info.append(`${reais(p.valor)} `);
        for (const s of selos(p)) {
            const b = document.createElement('span');
            b.className = 'selo';
            b.textContent = s;
            info.append(b);
        }
        abrir.append(nome, info);
        abrir.setAttribute('aria-label', `Editar ${p.nome}`);
        abrir.addEventListener('click', () => abrirEditor(p));
        li.append(miniatura(p.imagem), abrir);
        return li;
    }

    $('[data-recarregar]').addEventListener('click', () => {
        avisar('');
        void carregar();
    });
    $('[data-novo]').addEventListener('click', () => abrirEditor(null));

    // ------------------------------------------------------------ editor

    function modoCotas(): string {
        return (editor.querySelector<HTMLInputElement>('[name="modo-cotas"]:checked')?.value) ?? 'um';
    }

    function lerForm() {
        const valorTxt = campo('valor').value.replace(/[^\d]/g, '');
        const modo = modoCotas();
        const nCotas = Number(campo('cotas').value.replace(/[^\d]/g, ''));
        return {
            nome: campo('nome').value.trim(),
            valor: valorTxt ? Number(valorTxt) : NaN,
            imagem: campo('imagem').value.trim(),
            descricao: campo('descricao').value.trim(),
            // Valor livre é sempre sem limite de pessoas (o servidor recusa o contrário).
            cotas: campo('valor_livre').checked ? null : modo === 'um' ? 1 : modo === 'livre' ? null : nCotas,
            categoria: campo('categoria').value,
            publicar: campo('publicar').checked,
            valor_livre: campo('valor_livre').checked,
        };
    }

    function mostrarErro(nome: string, msg: string | null): void {
        const caixa = editor.querySelector<HTMLElement>(`#erro-${nome}`);
        const input = nome === 'cotas' ? campo('cotas') : campo(nome);
        if (caixa) {
            caixa.textContent = msg ?? '';
            caixa.hidden = !msg;
        }
        if (input) {
            if (msg) input.setAttribute('aria-invalid', 'true');
            else input.removeAttribute('aria-invalid');
        }
    }

    function validar(): string | null {
        const d = lerForm();
        const erros: [string, string | null][] = [
            ['nome', d.nome.length < 2 ? 'Dê um nome ao presente.' : null],
            [
                'valor',
                !Number.isInteger(d.valor) || d.valor < 10 || d.valor > 20000
                    ? 'Use um valor em reais, sem centavos, entre R$ 10 e R$ 20.000.'
                    : null,
            ],
            ['imagem', d.imagem && !/^https:\/\/\S+$/i.test(d.imagem) ? 'O link da foto precisa começar com https://' : null],
            ['cotas', d.cotas !== null && (!Number.isInteger(d.cotas) || d.cotas < 1 || d.cotas > 50) ? 'Escolha de 1 a 50 pessoas.' : null],
            ['descricao', d.descricao.length > 140 ? 'Use no máximo 140 caracteres.' : null],
            ['categoria', FAIXAS.some((f) => f.id === d.categoria) ? null : 'Escolha em que categoria o presente aparece.'],
        ];
        // Cotas abaixo do que já foi pago: o servidor recusa; aqui só antecipa.
        if (editando && d.cotas !== null && d.cotas < editando.pagamentos.confirmado) {
            erros[3] = ['cotas', `Já tem ${editando.pagamentos.confirmado} pessoas que deram este presente. O mínimo é ${editando.pagamentos.confirmado}.`];
        }
        let primeiro: string | null = null;
        for (const [n, m] of erros) {
            mostrarErro(n, m);
            if (m && !primeiro) primeiro = n;
        }
        return primeiro;
    }

    /** Avisos que dá para calcular antes de salvar (o servidor confere de novo). */
    function avisosLocais(): string[] {
        const d = lerForm();
        const out: string[] = [];
        if (!d.imagem) out.push('Sem foto, o presente aparece com o símbolo do casamento no lugar.');
        if (editando) {
            const nova = d.categoria || editando.faixa;
            if (nova !== editando.faixa) out.push(`Vai mudar de "${tituloFaixa(editando.faixa)}" para "${tituloFaixa(nova)}".`);
            if (editando.pagamentos.pendente > 0 && d.valor !== editando.valor) {
                out.push('Tem reserva aguardando Pix com o valor antigo. Quem reservou pode pagar esse valor.');
            }
        }
        return out;
    }

    function atualizarPrevia(): void {
        const d = lerForm();
        $('[data-previa-nome]').textContent = d.nome || 'Nome do presente';
        const desc = $('[data-previa-desc]');
        desc.textContent = d.descricao;
        desc.hidden = !d.descricao;
        $('[data-previa-valor]').textContent = Number.isInteger(d.valor)
            ? (d.valor_livre ? `A partir de ${reais(d.valor)}` : reais(d.valor))
            : 'R$ 0';
        const cotas = $('[data-previa-cotas]');
        cotas.hidden = !(d.cotas && d.cotas > 1);
        cotas.textContent = d.cotas && d.cotas > 1 ? `${d.cotas} cotas disponíveis` : '';

        // Foto repetida: o erro da task 14 (a mesma foto em 20 presentes).
        const repetida = d.imagem
            ? itens.find((p) => p.imagem.trim() === d.imagem && p.id !== editando?.id)
            : undefined;
        const aviso = $('[data-aviso-imagem]');
        aviso.textContent = repetida ? `Esta foto já é usada em "${repetida.nome}".` : '';
        aviso.hidden = !repetida;
    }

    const img = $<HTMLImageElement>('[data-previa-img]');
    const marca = $('[data-previa-marca]');
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('load', () => {
        img.hidden = false;
        marca.hidden = true;
    });
    img.addEventListener('error', () => {
        img.hidden = true;
        marca.hidden = false;
    });
    function atualizarFoto(): void {
        const url = campo('imagem').value.trim();
        if (/^https:\/\/\S+$/i.test(url)) {
            if (img.getAttribute('src') !== url) img.src = url;
        } else {
            img.removeAttribute('src');
            img.hidden = true;
            marca.hidden = false;
        }
    }

    editor.addEventListener('input', (e) => {
        atualizarPrevia();
        if ((e.target as HTMLElement).getAttribute('name') === 'imagem') atualizarFoto();
        // Digitar no número de cotas escolhe a opção "Até N pessoas".
        if ((e.target as HTMLElement).getAttribute('name') === 'cotas') {
            editor.querySelector<HTMLInputElement>('[name="modo-cotas"][value="varias"]')!.checked = true;
        }
        const botao = $<HTMLButtonElement>('[data-salvar]');
        if (editando) botao.disabled = !mudou();
    });
    editor.addEventListener('change', () => {
        atualizarPrevia();
        if (editando) $<HTMLButtonElement>('[data-salvar]').disabled = !mudou();
    });

    function mudou(): boolean {
        if (!editando) return true;
        const d = lerForm();
        return (
            d.nome !== editando.nome ||
            d.valor !== editando.valor ||
            d.imagem !== editando.imagem ||
            d.descricao !== editando.descricao ||
            d.cotas !== editando.cotas ||
            d.categoria !== editando.faixa ||
            d.publicar !== editando.ativo ||
            d.valor_livre !== Boolean(editando.valor_livre)
        );
    }

    function preencher(p: Item | null): void {
        editor.reset();
        campo('nome').value = p?.nome ?? '';
        campo('valor').value = p ? String(p.valor) : '';
        campo('imagem').value = p?.imagem ?? '';
        campo('descricao').value = p?.descricao ?? '';
        // Categoria fora da lista (editada à mão na planilha) fica vazia: o select obriga a escolher.
        campo('categoria').value = FAIXAS.some((f) => f.id === p?.faixa) ? p!.faixa : '';
        campo('publicar').checked = p ? p.ativo : true;
        campo('valor_livre').checked = Boolean(p?.valor_livre);
        const modo = !p || p.cotas === 1 ? 'um' : p.cotas === null ? 'livre' : 'varias';
        editor.querySelector<HTMLInputElement>(`[name="modo-cotas"][value="${modo}"]`)!.checked = true;
        campo('cotas').value = p && p.cotas && p.cotas > 1 ? String(p.cotas) : '3';
        // Opção preenchida: abre "Mais opções" para não esconder dado.
        $<HTMLDetailsElement>('[data-mais]').open = Boolean(p && (p.descricao || !p.ativo || p.valor_livre));
        for (const n of ['nome', 'categoria', 'valor', 'imagem', 'cotas', 'descricao']) mostrarErro(n, null);
    }

    function limparRetorno(): void {
        const geral = $('[data-erro-geral]');
        geral.hidden = true;
        geral.textContent = '';
        const av = $('[data-avisos]');
        av.hidden = true;
        av.textContent = '';
    }

    function mostrarAvisos(lista: string[]): void {
        const av = $('[data-avisos]');
        av.textContent = '';
        for (const a of lista) {
            const li = document.createElement('li');
            li.textContent = a;
            av.append(li);
        }
        av.hidden = lista.length === 0;
    }

    function abrirEditor(p: Item | null): void {
        editando = p;
        pedido = novoPedido();
        preencher(p);
        limparRetorno();
        atualizarPrevia();
        atualizarFoto();
        mostrarAvisos(p ? [] : []);
        $('[data-editor-titulo]').textContent = p ? `Editar: ${p.nome}` : 'Novo presente';
        const salvar = $<HTMLButtonElement>('[data-salvar]');
        salvar.textContent = p ? 'Salvar alterações' : 'Adicionar presente';
        salvar.disabled = Boolean(p);

        const zona = $('[data-apagar-zona]');
        zona.hidden = !p;
        const bloqueado = Boolean(p && p.pagamentos.total > 0);
        $('[data-apagar-bloqueado]').hidden = !bloqueado;
        $('[data-apagar]').hidden = bloqueado;
        $('[data-apagar-confirma]').hidden = true;

        painel.hidden = true;
        editor.hidden = false;
        $('[data-editor-titulo]').focus();
        window.scrollTo({ top: editor.getBoundingClientRect().top + window.scrollY - 90 });
    }

    function voltar(texto = ''): void {
        editando = null;
        editor.hidden = true;
        painel.hidden = false;
        avisar(texto);
    }
    $('[data-cancelar]').addEventListener('click', () => voltar());

    // Sem token do GitHub, quem publica é o catalogo.yml (cron de 10 min, que o GitHub
    // costuma atrasar). Prometer menos do que isso faria o noivo achar que perdeu.
    const quando = (r: Resposta): string =>
        r.publicacao === 'disparada' ? 'em uns 3 minutos' : 'em até meia hora';

    editor.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (enviando) return;
        limparRetorno();
        const erro = validar();
        if (erro) {
            (erro === 'cotas' ? campo('cotas') : campo(erro)).focus();
            return;
        }
        const d = lerForm();
        const salvar = $<HTMLButtonElement>('[data-salvar]');
        const rotulo = salvar.textContent;
        enviando = true;
        salvar.disabled = true;
        salvar.textContent = 'Salvando…';
        mostrarAvisos(avisosLocais());

        const r = await chamar(
            editando
                ? { acao: 'editarPresente', pedido_id: pedido, id: editando.id, versao: editando.versao, ...d }
                : { acao: 'criarPresente', pedido_id: pedido, ...d },
        );
        enviando = false;
        salvar.textContent = rotulo;
        salvar.disabled = false;

        if (!r.ok) {
            if (r.motivo === 'senha' || r.motivo === 'bloqueado') return;
            if (r.motivo === 'conflito' && r.presente) {
                // Mostra a versão atual e preserva o que foi digitado, para não redigitar.
                const digitado = `${d.nome}, ${Number.isInteger(d.valor) ? reais(d.valor) : ''}`;
                itens = itens.map((p) => (p.id === r.presente!.id ? r.presente! : p));
                abrirEditor(r.presente);
                const geral = $('[data-erro-geral]');
                geral.textContent = `${r.msg} O que você tinha digitado: ${digitado}.`;
                geral.hidden = false;
                return;
            }
            if (r.motivo === 'nao_existe') {
                await carregar();
                voltar(r.msg ?? '');
                return;
            }
            if (r.campo) {
                mostrarErro(r.campo, r.msg ?? 'Confira este campo.');
                campo(r.campo)?.focus();
            } else {
                const geral = $('[data-erro-geral]');
                geral.textContent = r.msg ?? 'Não deu certo. Tente de novo.';
                geral.hidden = false;
            }
            return;
        }

        const nome = r.nome ?? d.nome;
        const texto = editando
            ? `Salvo. A mudança em "${nome}" vai aparecer no site ${quando(r)}.`
            : `Pronto! "${nome}" vai aparecer no site ${quando(r)}.`;
        const avisos = r.avisos?.length ? ` Atenção: ${r.avisos.join(' ')}` : '';
        await carregar();
        voltar(texto + avisos);
    });

    // ------------------------------------------------------------ apagar

    $('[data-apagar]').addEventListener('click', () => {
        if (!editando) return;
        $('[data-apagar-pergunta]').textContent = `Apagar "${editando.nome}" de vez?`;
        $('[data-apagar-confirma]').hidden = false;
        $('[data-apagar]').hidden = true;
        $<HTMLButtonElement>('[data-apagar-sim]').focus();
    });
    $('[data-apagar-nao]').addEventListener('click', () => {
        $('[data-apagar-confirma]').hidden = true;
        $('[data-apagar]').hidden = false;
    });
    $('[data-apagar-sim]').addEventListener('click', async () => {
        if (!editando || enviando) return;
        const sim = $<HTMLButtonElement>('[data-apagar-sim]');
        enviando = true;
        sim.disabled = true;
        sim.textContent = 'Apagando…';
        const alvo = editando;
        const r = await chamar({ acao: 'apagarPresente', pedido_id: pedido, id: alvo.id });
        enviando = false;
        sim.disabled = false;
        sim.textContent = 'Sim, apagar';
        if (!r.ok) {
            if (r.motivo === 'senha' || r.motivo === 'bloqueado') return;
            const geral = $('[data-erro-geral]');
            geral.textContent = r.msg ?? 'Não deu certo. Tente de novo.';
            geral.hidden = false;
            if (r.motivo === 'tem_pagamento') {
                $('[data-apagar-confirma]').hidden = true;
                $('[data-apagar-bloqueado]').hidden = false;
            }
            return;
        }
        await carregar();
        voltar(r.msg ?? `"${alvo.nome}" foi apagado. Vai sair do site ${quando(r)}.`);
    });

    botaoSair?.addEventListener('click', () => {
        sair();
        (formEntrar.elements.namedItem('senha') as HTMLInputElement).focus();
    });

    // ------------------------------------------------------------ início

    if (senha) void abrirPainel();
}
