/**
 * Telas /noivos/convidados e /noivos/recebidos (task 24), contra o Code.gs real.
 * Roda com `npm run test:backend`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarAmbiente } from './gas.mjs';

const SENHA = 'senha-de-teste-do-ci';
const DIA = 24 * 3600 * 1000;

const ambiente = (opts) => {
    const a = criarAmbiente(opts);
    a.x.definirSenhaNoivos(SENHA);
    return a;
};
const rsvp = (a, nome, contato, comparece = 'sim', extra = {}) =>
    a.post({ acao: 'rsvp', nome, contato, comparece, ...extra });
const convidados = (a, senha = SENHA) => a.post({ acao: 'listarConvidados', senha });
const recebidos = (a, senha = SENHA) => a.post({ acao: 'listarRecebidos', senha });

// ------------------------------------------------------------------ convidados

test('listarConvidados exige a senha e não vaza nada sem ela', () => {
    const a = ambiente();
    rsvp(a, 'Ana Souza', 'ana@t.com', 'sim', { recado: 'segredo do recado' });
    for (const senha of [undefined, '', 'errada']) {
        // Sem o helper: o parâmetro padrão trocaria undefined pela senha certa.
        const r = a.post({ acao: 'listarConvidados', senha });
        assert.equal(r.ok, false);
        assert.equal(r.convidados, undefined);
        assert.ok(!JSON.stringify(r).includes('ana@t.com'));
        assert.ok(!JSON.stringify(r).includes('segredo'));
    }
});

test('listarConvidados devolve quem vai e quem não vai, com contato, recado e datas', () => {
    const a = ambiente();
    assert.equal(rsvp(a, 'Ana Souza', 'ana@t.com', 'sim', { recado: 'Mal posso esperar' }).ok, true);
    a.avancar(60 * 1000);
    assert.equal(rsvp(a, 'Bruno Lima', '(91) 98888-7777', 'nao').ok, true);

    const r = convidados(a);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.convidados.length, 2);
    // Mais recente primeiro.
    const [b, an] = r.convidados;
    assert.equal(b.nome, 'Bruno Lima');
    assert.equal(b.comparece, 'nao');
    assert.equal(b.pessoas, 0);
    assert.equal(b.contato, '(91) 98888-7777');
    assert.equal(an.nome, 'Ana Souza');
    assert.equal(an.comparece, 'sim');
    assert.equal(an.pessoas, 1);
    assert.equal(an.recado, 'Mal posso esperar');
    assert.equal(an.protocolo, 'GV-0001');
    assert.equal(an.respostas, 1);
    assert.equal(an.antes, '');
    assert.match(an.criado_em, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(an.atualizado_em, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(an._linha, undefined, 'número da linha não sai');
    // Prazo vem da Config (o ambiente de teste não define rsvp_ate).
    assert.equal(r.prazo, '');
    assert.equal(r.encerrado, false);
});

test('mesma pessoa respondendo de novo depois de 24 h aparece UMA vez, com a resposta nova', () => {
    const a = ambiente();
    rsvp(a, 'Carla Dias', 'carla@t.com', 'sim');
    a.avancar(2 * DIA);
    // Mesmo nome com outra caixa e acento, mesmo e-mail com outra caixa.
    rsvp(a, 'CARLA DÍAS', 'Carla@T.com', 'nao', { recado: 'Não vou conseguir' });
    assert.equal(a.sheets.Convidados.dados.length, 3, 'o rsvp_ gravou duas linhas');

    const r = convidados(a);
    assert.equal(r.convidados.length, 1);
    const c = r.convidados[0];
    assert.equal(c.comparece, 'nao');
    assert.equal(c.respostas, 2);
    assert.equal(c.antes, 'sim');
    assert.equal(c.recado, 'Não vou conseguir');
    assert.equal(c.protocolo, 'GV-0002');
});

test('telefone com e sem máscara é a mesma pessoa; mesmo contato com outro nome não', () => {
    const a = ambiente();
    rsvp(a, 'Davi Rocha', '(91) 99999-0000', 'sim');
    a.avancar(2 * DIA);
    rsvp(a, 'Davi Rocha', '91999990000', 'sim');
    rsvp(a, 'Elisa Rocha', '91999990000', 'sim'); // casal usando o mesmo celular
    const r = convidados(a);
    assert.equal(r.convidados.length, 2);
    const davi = r.convidados.find((c) => c.nome === 'Davi Rocha');
    assert.equal(davi.respostas, 2);
    assert.equal(davi.antes, '', 'respondeu igual as duas vezes');
});

test('linha antiga com data mais nova vale mais que a linha de baixo', () => {
    const a = ambiente();
    const cab = a.sheets.Convidados.dados[0];
    const linha = (o) => cab.map((c) => o[c] ?? '');
    a.sheets.Convidados.dados.push(
        linha({ protocolo: 'GV-0001', nome: 'Fábio', contato: 'f@t.com', comparece: 'sim', total_pessoas: 1, criado_em: new Date('2026-10-05T12:00:00Z'), atualizado_em: new Date('2026-10-05T12:00:00Z') }),
        linha({ protocolo: 'GV-0002', nome: 'Fábio', contato: 'f@t.com', comparece: 'nao', total_pessoas: 0, criado_em: new Date('2026-10-01T12:00:00Z'), atualizado_em: new Date('2026-10-01T12:00:00Z') }),
    );
    const [f] = convidados(a).convidados;
    assert.equal(f.comparece, 'sim');
    assert.equal(f.protocolo, 'GV-0001');
    assert.equal(f.antes, 'nao');
    assert.equal(f.respostas, 2);
});

test('planilha editada à mão: linha em branco, "Sim" maiúsculo, data em texto, acompanhantes antigos', () => {
    const a = ambiente();
    const cab = a.sheets.Convidados.dados[0];
    const linha = (o) => cab.map((c) => o[c] ?? '');
    a.sheets.Convidados.dados.push(
        linha({ protocolo: 'GV-0001', nome: 'Gabi', contato: 'g@t.com', comparece: 'Sim', total_pessoas: 3, criado_em: '2026-09-01T10:00:00-03:00' }),
        cab.map(() => ''),
        linha({ protocolo: 'GV-0003', nome: 'Hugo', contato: 'h@t.com', comparece: 'Não', criado_em: 'data quebrada' }),
        linha({ protocolo: 'GV-0004', nome: '', contato: 'sem-nome@t.com', comparece: 'sim' }),
    );
    const r = convidados(a);
    assert.equal(r.ok, true);
    assert.equal(r.convidados.length, 2, 'linha sem nome fica de fora');
    const gabi = r.convidados.find((c) => c.nome === 'Gabi');
    assert.equal(gabi.comparece, 'sim');
    assert.equal(gabi.pessoas, 3);
    assert.equal(gabi.atualizado_em, '2026-09-01T13:00:00.000Z');
    const hugo = r.convidados.find((c) => c.nome === 'Hugo');
    assert.equal(hugo.comparece, 'nao');
    assert.equal(hugo.criado_em, '');
});

test('prazo e encerrado seguem a Config', () => {
    const aberto = ambiente({ config: [['rsvp_ate', '2099-11-16T23:59:59-03:00']] });
    let r = convidados(aberto);
    assert.equal(r.prazo, '2099-11-17T02:59:59.000Z');
    assert.equal(r.encerrado, false);

    const fechado = ambiente({ config: [['rsvp_ate', '2020-11-16T23:59:59-03:00']] });
    r = convidados(fechado);
    assert.equal(r.encerrado, true);
});

test('listarConvidados não escreve nada', () => {
    const a = ambiente();
    rsvp(a, 'Ana Souza', 'ana@t.com');
    const antes = JSON.stringify(a.sheets.Convidados.dados);
    convidados(a);
    convidados(a);
    assert.equal(JSON.stringify(a.sheets.Convidados.dados), antes);
});

// ------------------------------------------------------------------ recebidos

const P = (o) => ({ id: '', presente_id: '', nome: '', contato: '', valor: '', status: '', criado_em: '', confirmado_em: '', canal: '', expira_em: '', mp_payment_id: '', mp_status: '', mp_status_detail: '', metodo: '', parcelas: '', valor_pago: '', recado: '', atualizado_em: '', conciliado_em: '', alerta: '', ...o });
const linhaPg = (a, o) => a.x.COLUNAS.Pagamentos.map((c) => P(o)[c]);

function comPagamentos() {
    const a = ambiente({
        presentes: [
            ['vela', 'Vela aromática', 95, 'gisele', 'https://img/vela.jpg', '', true, 3, 10, false],
            ['spa', 'Spa da Ruth', 300, 'ruth', '', '', true, '', 20, false],
        ],
    });
    const add = (o) => a.sheets.Pagamentos.dados.push(linhaPg(a, o));
    add({ id: 'r1', presente_id: 'vela', nome: 'Ana', contato: 'ana@t.com', valor: 95, status: 'confirmado', canal: 'mercadopago', metodo: 'credit_card', parcelas: 3, recado: 'Felicidades!', criado_em: new Date('2026-10-01T10:00:00Z'), confirmado_em: new Date('2026-10-01T10:05:00Z') });
    add({ id: 'r2', presente_id: 'spa', nome: 'Bruno', valor: 300, status: 'confirmado', canal: 'pix_manual', criado_em: new Date('2026-10-02T10:00:00Z'), confirmado_em: new Date('2026-10-03T10:00:00Z') });
    add({ id: 'r3', presente_id: 'vela', nome: 'Carla', valor: 95, status: 'pendente', canal: 'mercadopago', expira_em: new Date(Date.now() + 600000), criado_em: new Date() });
    add({ id: 'r4', presente_id: 'vela', nome: 'Davi', valor: 95, status: 'pendente', canal: 'pix_manual', criado_em: new Date('2026-10-04T10:00:00Z') });
    add({ id: 'r5', presente_id: 'spa', nome: 'Elisa', valor: 300, status: 'estornado', canal: 'mercadopago', criado_em: new Date('2026-10-05T10:00:00Z') });
    add({ id: 'r6', presente_id: 'vela', nome: 'Fábio', valor: 95, status: 'recusado', canal: 'mercadopago', criado_em: new Date('2026-10-06T10:00:00Z') });
    add({ id: 'r7', presente_id: 'vela', nome: 'Gabi', valor: 95, status: 'expirado', canal: 'mercadopago', criado_em: new Date('2026-10-07T10:00:00Z') });
    add({ id: 'r8', presente_id: 'vela', nome: 'Hugo', valor: 9, status: 'pendente', canal: 'mercadopago', alerta: 'divergente', criado_em: new Date('2026-10-08T10:00:00Z') });
    add({ id: 'r9', presente_id: 'sumiu', nome: 'Iara', valor: 50, status: 'confirmado', canal: 'pix_manual', criado_em: new Date('2026-10-09T10:00:00Z') });
    return a;
}

test('listarRecebidos exige a senha', () => {
    const a = comPagamentos();
    const r = recebidos(a, 'errada');
    assert.equal(r.ok, false);
    assert.equal(r.recebidos, undefined);
});

test('listarRecebidos: confirmados, estornos, alertas e Pix manual a conferir; nunca checkout aberto, recusado ou expirado', () => {
    const r = recebidos(comPagamentos());
    assert.equal(r.ok, true, JSON.stringify(r));
    const nomes = r.recebidos.map((x) => x.nome).sort();
    assert.deepEqual(nomes, ['Ana', 'Bruno', 'Davi', 'Elisa', 'Hugo', 'Iara']);
});

test('listarRecebidos traz o presente com nome e foto, e a data da confirmação', () => {
    const r = recebidos(comPagamentos());
    const ana = r.recebidos.find((x) => x.nome === 'Ana');
    assert.equal(ana.presente_id, 'vela');
    assert.equal(ana.presente, 'Vela aromática');
    assert.equal(ana.imagem, 'https://img/vela.jpg');
    assert.equal(ana.valor, 95);
    assert.equal(ana.metodo, 'credit_card');
    assert.equal(ana.parcelas, 3);
    assert.equal(ana.recado, 'Felicidades!');
    assert.equal(ana.contato, 'ana@t.com');
    assert.equal(ana.quando, '2026-10-01T10:05:00.000Z', 'confirmado_em, não criado_em');
    const davi = r.recebidos.find((x) => x.nome === 'Davi');
    assert.equal(davi.status, 'pendente');
    assert.equal(davi.canal, 'pix_manual');
    // Presente apagado da planilha: mostra o id em vez de sumir.
    const iara = r.recebidos.find((x) => x.nome === 'Iara');
    assert.equal(iara.presente, 'sumiu');
    assert.equal(iara.imagem, '');
});

test('listarRecebidos vem do mais recente para o mais antigo', () => {
    const r = recebidos(comPagamentos());
    const q = r.recebidos.map((x) => x.quando);
    assert.deepEqual(q, [...q].sort().reverse());
});
