/**
 * /noivos/convidados: quem confirmou presença. Task 24.
 *
 * Só leitura. Busca, filtro e ordem rodam aqui, sobre a lista que o `listarConvidados`
 * devolve (uma entrada por pessoa; ver Code.gs). Nada da planilha entra por innerHTML.
 */
import {
    baixar,
    copiarTexto,
    contatoLegivel,
    csv,
    dataHora,
    data,
    diasAte,
    el,
    elementoContato,
    hojeIso,
    iniciarArea,
    normalizar,
    type RespostaBase,
} from './noivos';

type Comparece = 'sim' | 'nao' | '';

interface Convidado {
    protocolo: string;
    nome: string;
    contato: string;
    comparece: Comparece;
    /** 1 para quem vai; mais que 1 só em resposta antiga, de quando o RSVP pedia acompanhantes. */
    pessoas: number;
    recado: string;
    restricao: string;
    criado_em: string;
    atualizado_em: string;
    respostas: number;
    /** A resposta anterior, quando a pessoa mudou de ideia. */
    antes: Comparece;
}

interface Resposta extends RespostaBase {
    convidados?: Convidado[];
    prazo?: string;
    encerrado?: boolean;
}

type Filtro = 'todos' | 'vai' | 'nao' | 'recado' | 'mudou';

const FILTROS: Record<Filtro, (c: Convidado) => boolean> = {
    todos: () => true,
    vai: (c) => c.comparece === 'sim',
    nao: (c) => c.comparece === 'nao',
    recado: (c) => c.recado.trim() !== '',
    mudou: (c) => c.antes !== '',
};

const ROTULO_FILTRO: Record<Filtro, string> = {
    todos: 'Todos',
    vai: 'Vão',
    nao: 'Não vão',
    recado: 'Com recado',
    mudou: 'Mudaram a resposta',
};

const resposta = (c: Comparece): string => (c === 'sim' ? 'Vai' : c === 'nao' ? 'Não vai' : 'Sem resposta');

export function adminConvidados(): void {
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
    const total = (nome: string): HTMLElement => $(`[data-total="${nome}"]`);

    let todos: Convidado[] = [];
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
            estado.textContent = 'Carregando as confirmações…';
        }
        const r = await area.chamar<Resposta>({ acao: 'listarConvidados' });
        carregando = false;
        botao.disabled = false;
        botao.textContent = 'Atualizar';
        if (!r.ok || !r.convidados) {
            if (r.motivo === 'senha' || r.motivo === 'bloqueado') return;
            mostrarFalha(r.msg ?? 'Não conseguimos carregar as confirmações.');
            return;
        }
        todos = r.convidados;
        resumir(r);
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

    function resumir(r: Resposta): void {
        const vao = todos.filter(FILTROS.vai);
        const pessoas = vao.reduce((s, c) => s + (c.pessoas || 1), 0);
        total('vai').textContent = String(vao.length);
        // Só quando difere: resposta antiga com acompanhantes conta mais de uma pessoa.
        const extra = total('pessoas');
        extra.textContent = `${pessoas} pessoas no total`;
        extra.hidden = pessoas === vao.length;
        total('nao').textContent = String(todos.filter(FILTROS.nao).length);
        total('todos').textContent = String(todos.length);

        const prazo = total('prazo');
        const prazoExtra = total('prazo-extra');
        if (!r.prazo) {
            prazo.textContent = 'Sem prazo';
            prazoExtra.hidden = true;
        } else {
            prazo.textContent = data(r.prazo).slice(0, 5); // "16/11"
            const dias = diasAte(r.prazo);
            prazoExtra.textContent = r.encerrado
                ? `Encerrado em ${data(r.prazo)}`
                : dias <= 0
                  ? 'Último dia para confirmar'
                  : dias === 1
                    ? 'Termina amanhã'
                    : `Faltam ${dias} dias`;
            prazoExtra.hidden = false;
        }

        // Contagem em cada filtro; "Mudaram a resposta" só aparece se alguém mudou.
        for (const f of Object.keys(FILTROS) as Filtro[]) {
            const input = barra.querySelector<HTMLInputElement>(`input[name="filtro"][value="${f}"]`);
            const span = input?.nextElementSibling;
            if (span) span.textContent = `${ROTULO_FILTRO[f]} (${todos.filter(FILTROS[f]).length})`;
        }
        const mudou = todos.some(FILTROS.mudou);
        $('[data-filtro-mudou]').hidden = !mudou;
        if (!mudou && filtroAtual() === 'mudou') marcarFiltro('todos');
    }

    // ------------------------------------------------------------ filtro, busca, ordem

    function filtroAtual(): Filtro {
        const v = barra.querySelector<HTMLInputElement>('input[name="filtro"]:checked')?.value;
        return v && v in FILTROS ? (v as Filtro) : 'todos';
    }

    function marcarFiltro(f: Filtro): void {
        const input = barra.querySelector<HTMLInputElement>(`input[name="filtro"][value="${f}"]`);
        if (input) input.checked = true;
    }

    function visiveis(): Convidado[] {
        const termos = normalizar(busca.value.trim()).split(/\s+/).filter(Boolean);
        const filtro = FILTROS[filtroAtual()];
        const lista = todos.filter((c) => {
            if (!filtro(c)) return false;
            if (!termos.length) return true;
            const alvo = normalizar(
                [c.nome, c.contato, c.contato.replace(/\D/g, ''), c.recado, c.protocolo].join(' '),
            );
            return termos.every((t) => alvo.includes(t));
        });
        const quando = (c: Convidado): string => c.atualizado_em || c.criado_em;
        switch (ordem.value) {
            case 'antigas':
                return lista.sort((a, b) => quando(a).localeCompare(quando(b)));
            case 'nome':
                return lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
            default:
                return lista.sort((a, b) => quando(b).localeCompare(quando(a)));
        }
    }

    // ------------------------------------------------------------ desenho

    function desenhar(): void {
        const vis = visiveis();
        lista.textContent = '';
        if (!todos.length) {
            estado.textContent = '';
            lista.append(el('p', 'nv-vazio', 'Ninguém confirmou presença ainda.'));
            return;
        }
        estado.textContent =
            vis.length === todos.length
                ? `${todos.length} ${todos.length === 1 ? 'pessoa respondeu' : 'pessoas responderam'}.`
                : `Mostrando ${vis.length} de ${todos.length}.`;
        if (!vis.length) {
            lista.append(el('p', 'nv-vazio', 'Ninguém encontrado com esses filtros.'));
            return;
        }
        const ul = el('ul', 'nv-lista');
        for (const c of vis) ul.append(item(c));
        lista.append(ul);
    }

    function item(c: Convidado): HTMLLIElement {
        const li = el('li', `nv-item ${c.comparece === 'sim' ? 'nv-item--vai' : c.comparece === 'nao' ? 'nv-item--nao' : ''}`);

        const topo = el('div', 'nv-item__topo');
        topo.append(
            el('h2', 'nv-item__nome', c.nome),
            el('span', `nv-selo${c.comparece === 'sim' ? ' nv-selo--vai' : ''}`, resposta(c.comparece)),
        );
        li.append(topo);

        const meta = el('p', 'nv-item__meta');
        if (c.contato) meta.append(elementoContato(c.contato));
        const quando = dataHora(c.criado_em || c.atualizado_em);
        if (quando) meta.append(el('span', '', `Respondeu em ${quando}`));
        if (c.protocolo) meta.append(el('span', '', `Confirmação ${c.protocolo}`));
        li.append(meta);

        // Atualizou depois (mais de um minuto): mostra quando.
        const t1 = new Date(c.criado_em).getTime();
        const t2 = new Date(c.atualizado_em).getTime();
        if (c.criado_em && c.atualizado_em && t2 - t1 > 60_000) {
            li.append(el('p', 'nv-nota', `Última mudança em ${dataHora(c.atualizado_em)}`));
        }
        if (c.respostas > 1) {
            const antes = c.antes
                ? `; antes tinha respondido "${resposta(c.antes).toLowerCase()}"`
                : '';
            li.append(el('p', 'nv-nota', `Respondeu ${c.respostas} vezes${antes}. Vale a resposta mais recente.`));
        }
        if (c.pessoas > 1) {
            li.append(el('p', 'nv-nota', `${c.pessoas} pessoas nesta confirmação (resposta antiga, com acompanhantes).`));
        }
        if (c.restricao.trim()) {
            li.append(el('p', 'nv-nota', `Restrição alimentar: ${c.restricao}`));
        }
        if (c.recado.trim()) {
            li.append(el('blockquote', 'nv-recado', c.recado));
        }
        return li;
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
        const vis = visiveis();
        if (!vis.length) {
            avisar('Não há ninguém na lista para baixar. Confira a busca e os filtros.');
            return;
        }
        const linhas: (string | number)[][] = [
            ['Nome', 'Resposta', 'Pessoas', 'Contato', 'Recado', 'Respondeu em', 'Última mudança', 'Confirmação', 'Respostas', 'Resposta anterior'],
            ...vis.map((c) => [
                c.nome,
                resposta(c.comparece),
                c.pessoas,
                contatoLegivel(c.contato),
                c.recado,
                dataHora(c.criado_em),
                dataHora(c.atualizado_em),
                c.protocolo,
                c.respostas,
                c.antes ? resposta(c.antes) : '',
            ]),
        ];
        baixar(`convidados-${hojeIso()}.csv`, csv(linhas));
        avisar(`Planilha com ${vis.length} ${vis.length === 1 ? 'pessoa' : 'pessoas'} baixada. Abre no Excel ou no Google Planilhas.`);
    });

    $('[data-copiar]').addEventListener('click', async () => {
        const nomes = todos
            .filter(FILTROS.vai)
            .map((c) => c.nome)
            .sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
        if (!nomes.length) {
            avisar('Ninguém confirmou que vai ainda.');
            return;
        }
        const ok = await copiarTexto(nomes.join('\n'));
        avisar(
            ok
                ? `${nomes.length} ${nomes.length === 1 ? 'nome copiado' : 'nomes copiados'}, um por linha, em ordem alfabética. É só colar.`
                : 'Não conseguimos copiar. Use "Baixar planilha" com o filtro "Vão".',
        );
    });
}
