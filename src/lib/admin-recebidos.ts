/**
 * /noivos/recebidos: presentes recebidos e quem deu. Task 24.
 *
 * Só leitura, sobre o `listarRecebidos` (ver Code.gs). O que conta no total é só o que está
 * `confirmado`, a mesma regra que tira o presente da lista no site (task 10). Estorno, alerta
 * e Pix manual por conferir vão para "Pedem atenção". Nada da planilha entra por innerHTML.
 */
import {
    baixar,
    contatoLegivel,
    csv,
    dataHora,
    el,
    elementoContato,
    hojeIso,
    iniciarArea,
    normalizar,
    reais,
    type RespostaBase,
} from './noivos';

interface Recebido {
    presente_id: string;
    presente: string;
    imagem: string;
    nome: string;
    contato: string;
    recado: string;
    valor: number;
    status: string;
    canal: string;
    metodo: string;
    parcelas: number | null;
    quando: string;
    alerta: string;
}

interface Resposta extends RespostaBase {
    recebidos?: Recebido[];
}

const METODOS: Record<string, string> = {
    credit_card: 'cartão de crédito',
    debit_card: 'cartão de débito',
    pix: 'Pix',
    bank_transfer: 'Pix',
    account_money: 'saldo do Mercado Pago',
};

/** O que fazer em cada alerta (task 22 §6.6). Mesmo texto da tela de presentes. */
const ALERTAS: Record<string, string> = {
    divergente: 'Valor pago diferente do presente. Confiram no Mercado Pago antes de considerar dado.',
    excedente: 'Dado além do limite de pessoas. Decidam entre devolver pelo painel do Mercado Pago ou aceitar.',
    duplicado: 'A pessoa pagou duas vezes. Devolvam um dos pagamentos pelo painel do Mercado Pago.',
    disputa: 'Pagamento em disputa no Mercado Pago. Respondam pelo painel dentro do prazo.',
    falha_preferencia: 'O pagamento não chegou a abrir. Nada foi cobrado.',
};

const confirmado = (x: Recebido): boolean => x.status === 'confirmado';
const pedeAtencao = (x: Recebido): boolean =>
    x.alerta !== '' || x.status === 'estornado' || (x.status === 'pendente' && x.canal !== 'mercadopago');

function como(x: Recebido): string {
    if (x.canal === 'pix_manual' || (!x.canal && !x.metodo)) return 'Pix direto';
    const m = METODOS[x.metodo] ?? (x.metodo || 'Mercado Pago');
    return x.parcelas && x.parcelas > 1 ? `${m} em ${x.parcelas}x` : m;
}

function situacao(x: Recebido): string {
    if (x.status === 'pendente') return 'Pix a conferir';
    if (x.status === 'estornado') return 'Devolvido';
    if (x.alerta) return confirmado(x) ? 'Confirmado, com alerta' : 'Com alerta';
    return confirmado(x) ? 'Confirmado' : x.status;
}

/** Texto do que fazer, para o bloco "Pedem atenção" e para a nota no item. */
function oQueFazer(x: Recebido): string {
    if (x.status === 'pendente' && x.canal !== 'mercadopago' && !x.alerta) {
        return 'Avisou que pagou por Pix. Confiram no extrato: se o dinheiro entrou, mudem o status para "confirmado" na aba Pagamentos da planilha.';
    }
    if (x.status === 'estornado') return 'Devolvido ou contestado: o dinheiro voltou para quem deu, e o presente voltou para a lista.';
    return ALERTAS[x.alerta] ?? `Atenção: ${x.alerta}.`;
}

export function adminRecebidos(): void {
    const raiz = document.querySelector<HTMLElement>('[data-noivos]');
    if (!raiz) return;
    const $ = <T extends HTMLElement>(sel: string): T => raiz.querySelector<T>(sel)!;

    const conteudo = $('[data-conteudo]');
    const barra = $<HTMLFormElement>('[data-barra]');
    const busca = $<HTMLInputElement>('[data-busca]');
    const ordem = $<HTMLSelectElement>('[data-ordem]');
    const lista = $('[data-lista]');
    const estado = $('[data-estado]');
    const mensagem = $('[data-mensagem]');
    const atencao = $('[data-atencao]');
    const atencaoLista = $('[data-atencao-lista]');
    const marca = $<HTMLTemplateElement>('[data-marca]');
    const total = (nome: string): HTMLElement => $(`[data-total="${nome}"]`);

    let todos: Recebido[] = [];
    let carregando = false;

    const area = iniciarArea({ raiz, conteudo, aoEntrar: () => carregar() });

    function avisar(texto: string): void {
        mensagem.textContent = texto;
        mensagem.hidden = !texto;
    }

    // ------------------------------------------------------------ dados

    async function carregar(): Promise<void> {
        if (carregando) return;
        carregando = true;
        const botao = $<HTMLButtonElement>('[data-atualizar]');
        botao.disabled = true;
        botao.textContent = 'Atualizando…';
        if (!todos.length) {
            lista.textContent = '';
            estado.textContent = 'Carregando os presentes…';
        }
        const r = await area.chamar<Resposta>({ acao: 'listarRecebidos' });
        carregando = false;
        botao.disabled = false;
        botao.textContent = 'Atualizar';
        if (!r.ok || !r.recebidos) {
            if (r.motivo === 'senha' || r.motivo === 'bloqueado') return;
            mostrarFalha(r.msg ?? 'Não conseguimos carregar os presentes.');
            return;
        }
        todos = r.recebidos;
        resumir();
        desenharAtencao();
        desenhar();
    }

    function mostrarFalha(texto: string): void {
        estado.textContent = '';
        lista.textContent = '';
        const p = el('p', 'nv-erro', `${texto} `);
        p.setAttribute('role', 'alert');
        const tentar = el('button', 'botao botao--fantasma', 'Tentar de novo');
        tentar.type = 'button';
        tentar.addEventListener('click', () => void carregar());
        p.append(tentar);
        lista.append(p);
    }

    function resumir(): void {
        const conf = todos.filter(confirmado);
        total('valor').textContent = reais(conf.reduce((s, x) => s + x.valor, 0));
        total('presentes').textContent = String(conf.length);
        total('pessoas').textContent = String(new Set(conf.map((x) => normalizar(x.nome.trim()))).size);
        total('atencao').textContent = String(todos.filter(pedeAtencao).length);
    }

    // ------------------------------------------------------------ peças

    function foto(url: string): HTMLElement {
        if (/^https:\/\//i.test(url)) {
            const img = el('img', 'nv-foto');
            img.alt = '';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.referrerPolicy = 'no-referrer';
            img.src = url;
            img.addEventListener('error', () => img.replaceWith(foto('')));
            return img;
        }
        // SVG da marca, estático, do <template> da página.
        return (marca.content.firstElementChild as HTMLElement).cloneNode(true) as HTMLElement;
    }

    function meta(x: Recebido, comContato = true): HTMLParagraphElement {
        const p = el('p', 'nv-item__meta');
        p.append(el('span', '', como(x)));
        const quando = dataHora(x.quando);
        if (quando) p.append(el('span', '', quando));
        if (comContato && x.contato) p.append(elementoContato(x.contato));
        return p;
    }

    /** Um presente dado, na vista "por pessoa" e no bloco de atenção. */
    function itemPessoa(x: Recebido): HTMLLIElement {
        const li = el('li', `nv-item nv-item--com-foto${pedeAtencao(x) ? ' nv-item--alerta' : ''}`);
        li.append(foto(x.imagem));
        const topo = el('div', 'nv-item__topo');
        const lado = el('span', 'nv-item__lado');
        lado.append(el('span', 'nv-item__valor', reais(x.valor)));
        topo.append(el('h3', 'nv-item__nome', x.nome || 'Sem nome'), lado);
        li.append(topo, el('p', 'nv-nota', `deu ${x.presente}`), meta(x));
        if (x.recado.trim()) li.append(el('blockquote', 'nv-recado', x.recado));
        if (pedeAtencao(x)) {
            const s = el('p', 'nv-nota nv-nota--alerta', oQueFazer(x));
            li.append(s);
        }
        return li;
    }

    // ------------------------------------------------------------ atenção

    function desenharAtencao(): void {
        const itens = todos.filter(pedeAtencao);
        atencao.hidden = itens.length === 0;
        atencaoLista.textContent = '';
        if (!itens.length) return;
        const ul = el('ul', 'nv-lista');
        for (const x of itens) {
            const li = itemPessoa(x);
            const selo = el('span', 'nv-selo nv-selo--alerta', situacao(x));
            li.querySelector('.nv-item__lado')?.prepend(selo);
            if (confirmado(x)) li.append(el('p', 'nv-nota', 'Já conta no total recebido.'));
            ul.append(li);
        }
        atencaoLista.append(ul);
    }

    // ------------------------------------------------------------ busca, ordem e vista

    function vista(): 'pessoa' | 'presente' {
        return barra.querySelector<HTMLInputElement>('input[name="vista"]:checked')?.value === 'presente'
            ? 'presente'
            : 'pessoa';
    }

    function visiveis(): Recebido[] {
        const termos = normalizar(busca.value.trim()).split(/\s+/).filter(Boolean);
        const out = todos.filter(confirmado).filter((x) => {
            if (!termos.length) return true;
            const alvo = normalizar([x.nome, x.presente, x.recado, x.contato].join(' '));
            return termos.every((t) => alvo.includes(t));
        });
        return ordenar(out);
    }

    function ordenar(itens: Recebido[]): Recebido[] {
        switch (ordem.value) {
            case 'antigos':
                return itens.sort((a, b) => a.quando.localeCompare(b.quando));
            case 'valor':
                return itens.sort((a, b) => b.valor - a.valor || b.quando.localeCompare(a.quando));
            case 'nome':
                return itens.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
            default:
                return itens.sort((a, b) => b.quando.localeCompare(a.quando));
        }
    }

    // ------------------------------------------------------------ desenho

    function desenhar(): void {
        lista.textContent = '';
        const conf = todos.filter(confirmado);
        if (!conf.length) {
            estado.textContent = '';
            lista.append(el('p', 'nv-vazio', 'Nenhum presente confirmado ainda.'));
            return;
        }
        const vis = visiveis();
        estado.textContent =
            vis.length === conf.length
                ? `${conf.length} ${conf.length === 1 ? 'presente confirmado' : 'presentes confirmados'}.`
                : `Mostrando ${vis.length} de ${conf.length} presentes.`;
        if (!vis.length) {
            lista.append(el('p', 'nv-vazio', 'Nada encontrado com essa busca.'));
            return;
        }
        if (vista() === 'pessoa') {
            const ul = el('ul', 'nv-lista');
            for (const x of vis) ul.append(itemPessoa(x));
            lista.append(ul);
            return;
        }
        desenharPorPresente(vis);
    }

    function desenharPorPresente(vis: Recebido[]): void {
        // `vis` já vem na ordem escolhida: o grupo herda a posição do primeiro item dele,
        // e dentro do grupo as pessoas seguem a mesma ordem.
        const grupos = new Map<string, Recebido[]>();
        for (const x of vis) {
            const g = grupos.get(x.presente_id);
            if (g) g.push(x);
            else grupos.set(x.presente_id, [x]);
        }
        let ordemGrupos = [...grupos.values()];
        if (ordem.value === 'valor') {
            const soma = (g: Recebido[]): number => g.reduce((s, x) => s + x.valor, 0);
            ordemGrupos = ordemGrupos.sort((a, b) => soma(b) - soma(a));
        }

        const ul = el('ul', 'nv-lista');
        for (const g of ordemGrupos) {
            const p = g[0]!;
            const soma = g.reduce((s, x) => s + x.valor, 0);
            const li = el('li', 'nv-item nv-item--com-foto nv-grupo');
            li.append(foto(p.imagem));
            const topo = el('div', 'nv-item__topo');
            topo.append(el('h3', 'nv-item__nome', p.presente), el('span', 'nv-item__valor', reais(soma)));
            li.append(topo, el('p', 'nv-nota', g.length === 1 ? 'Dado por 1 pessoa' : `Dado por ${g.length} pessoas`));

            const pessoas = el('ul', 'nv-lista');
            for (const x of g) {
                const pi = el('li', 'nv-item');
                const t = el('div', 'nv-item__topo');
                t.append(el('h4', 'nv-item__nome', x.nome || 'Sem nome'), el('span', '', reais(x.valor)));
                pi.append(t, meta(x));
                if (x.recado.trim()) pi.append(el('blockquote', 'nv-recado', x.recado));
                if (x.alerta) pi.append(el('p', 'nv-nota nv-nota--alerta', oQueFazer(x)));
                pessoas.append(pi);
            }
            li.append(pessoas);
            ul.append(li);
        }
        lista.append(ul);
    }

    // ------------------------------------------------------------ ações

    barra.addEventListener('input', () => desenhar());
    barra.addEventListener('change', () => desenhar());
    barra.addEventListener('submit', (e) => e.preventDefault());

    $('[data-atualizar]').addEventListener('click', () => {
        avisar('');
        void carregar();
    });

    $('[data-baixar]').addEventListener('click', () => {
        // Tudo que a tela mostra: os confirmados da busca e, sempre, o que pede atenção.
        const conf = visiveis();
        const extra = todos.filter((x) => pedeAtencao(x) && !confirmado(x));
        const linhas = [...conf, ...extra];
        if (!linhas.length) {
            avisar('Não há presentes para baixar. Confira a busca.');
            return;
        }
        baixar(
            `presentes-recebidos-${hojeIso()}.csv`,
            csv([
                ['Quem deu', 'Presente', 'Valor (R$)', 'Como pagou', 'Quando', 'Contato', 'Recado', 'Situação', 'Observação'],
                ...linhas.map((x) => [
                    x.nome,
                    x.presente,
                    x.valor,
                    como(x),
                    dataHora(x.quando),
                    contatoLegivel(x.contato),
                    x.recado,
                    situacao(x),
                    pedeAtencao(x) ? oQueFazer(x) : '',
                ]),
            ]),
        );
        avisar(`Planilha com ${linhas.length} ${linhas.length === 1 ? 'linha' : 'linhas'} baixada. Abre no Excel ou no Google Planilhas.`);
    });
}
