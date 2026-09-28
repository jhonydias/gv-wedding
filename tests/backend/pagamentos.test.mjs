/**
 * Pagamento pelo Mercado Pago (task 22 §9.1), contra o Code.gs real e um Mercado Pago falso.
 * Roda com `npm run test:backend`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarAmbiente } from './gas.mjs';

const TOKEN = 'TEST-token-de-teste-do-ci';
const MIN = 60 * 1000;

const PRESENTES = [
    // id, nome, valor, faixa, imagem, descricao, ativo, cotas, ordem, valor_livre
    ['geladeira', 'Geladeira', 900, 'grande', 'https://img/geladeira.jpg', '', true, 1, 10, false],
    ['vela', 'Vela aromática', 95, 'lembranca', '', '', true, 3, 20, false],
    ['lua-de-mel', 'Cota da lua de mel', 200, 'luademel', '', '', true, '', 30, false],
    ['livre', 'Contribuição livre', 50, 'luademel', '', '', true, '', 40, true],
    ['fora', 'Fora do site', 100, 'casa', '', '', false, 1, 50, false],
];

/** Ambiente com o Mercado Pago LIGADO (modo e token), salvo se `modo` disser outra coisa. */
function base({ modo = 'mercadopago', token = TOKEN } = {}) {
    const a = criarAmbiente({ presentes: PRESENTES, config: [['pagamento_modo', modo]] });
    if (token) a.x.definirTokenMercadoPago(token, 'teste');
    return a;
}

const checkout = (a, extra = {}) =>
    a.post({ acao: 'checkout', presente_id: 'geladeira', nome: 'Tia Marta', contato: 'marta@email.com', recado: 'Felicidades!', ...extra });
const pagamento = (a, ref) => a.linhas('Pagamentos').find((l) => l.id === ref);
const status = (a) => a.get('status').status;
const webhook = (a, corpo, parametros = {}) => {
    const chave = a.ctx.PropertiesService.getScriptProperties().getProperty('segredo_webhook');
    return a.post(corpo, { acao: 'mp_webhook', chave, ...parametros });
};

// ------------------------------------------------------------------ checkout

test('checkout: reserva de 30 min e preferência com o valor DA PLANILHA', () => {
    const a = base();
    const r = checkout(a, { valor: 1 }); // valor forjado pelo cliente: ignorado
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(r.init_point, /^https:\/\/mp\.teste\//);
    const l = pagamento(a, r.ref);
    assert.equal(l.status, 'pendente');
    assert.equal(l.canal, 'mercadopago');
    assert.equal(l.valor, 900);
    const minutos = (new Date(l.expira_em) - new Date(l.criado_em)) / MIN;
    assert.equal(minutos, 30);
    const pref = a.mp.preferencias[0];
    assert.equal(pref.items[0].unit_price, 900);
    assert.equal(pref.external_reference, r.ref);
    assert.equal(pref.binary_mode, true);
    assert.equal(pref.auto_return, 'approved');
    assert.equal(pref.statement_descriptor, 'GISELEVICTOR');
    assert.deepEqual(pref.payment_methods.excluded_payment_types.map((t) => t.id), ['ticket', 'atm']);
    assert.equal(pref.back_urls.success, `https://giseleevictor.com.br/presentes/obrigado/?ref=${r.ref}`);
    assert.match(pref.notification_url, /\?acao=mp_webhook&chave=[0-9a-f]{40}$/);
    assert.match(pref.expiration_date_to, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}-03:00$/);
    assert.equal(pref.date_of_expiration, pref.expiration_date_to);
    assert.equal(pref.items[0].picture_url, 'https://img/geladeira.jpg');
});

test('checkout: modo pix, sem token, ou modo teste sem a chave → indisponível e nada gravado', () => {
    for (const a of [base({ modo: 'pix' }), base({ token: null }), base({ modo: 'teste' })]) {
        const r = checkout(a);
        assert.equal(r.motivo, 'indisponivel');
        assert.equal(a.linhas('Pagamentos').length, 0);
        assert.equal(a.mp.preferencias.length, 0);
    }
});

test('checkout: modo teste com a chave certa funciona', () => {
    const a = base({ modo: 'teste' });
    a.x.configurarMercadoPago(); // gera a chave
    const chave = a.ctx.PropertiesService.getScriptProperties().getProperty('mp_chave_teste');
    assert.equal(checkout(a, { chave_teste: chave }).ok, true);
});

test('checkout: validações', () => {
    const a = base();
    assert.equal(checkout(a, { nome: 'x' }).campo, 'nome');
    assert.equal(checkout(a, { contato: 'nao-e-contato' }).campo, 'contato');
    assert.equal(checkout(a, { presente_id: 'fora' }).motivo, 'nao_existe');
    assert.equal(checkout(a, { presente_id: 'nao-existe' }).motivo, 'nao_existe');
    assert.equal(a.linhas('Pagamentos').length, 0);
});

test('checkout: valor livre dentro do intervalo; fora dele ou com centavos, recusado', () => {
    const a = base();
    for (const v of [49, 5001, 60.5, undefined]) {
        assert.equal(checkout(a, { presente_id: 'livre', valor: v }).campo, 'valor', String(v));
    }
    const r = checkout(a, { presente_id: 'livre', valor: 300 });
    assert.equal(r.ok, true);
    assert.equal(pagamento(a, r.ref).valor, 300);
    assert.equal(a.mp.preferencias[0].items[0].unit_price, 300);
});

test('checkout: a última cota reservada bloqueia a próxima pessoa, com "reservado"', () => {
    const a = base();
    assert.equal(checkout(a).ok, true);
    const r2 = checkout(a, { nome: 'Outra pessoa' });
    assert.equal(r2.motivo, 'indisponivel_presente');
    assert.equal(r2.reservado, true);
    assert.equal(status(a).geladeira.reservado, true);
    assert.equal(status(a).geladeira.disponivel, false);
});

test('checkout: presente ilimitado nunca reserva', () => {
    const a = base();
    for (let i = 0; i < 5; i++) assert.equal(checkout(a, { presente_id: 'lua-de-mel' }).ok, true);
    assert.equal(status(a)['lua-de-mel'].disponivel, true);
});

test('checkout: falha ao criar preferência libera a reserva na hora', () => {
    const a = base();
    a.mp.falharPreferencia = true;
    const r = checkout(a);
    assert.equal(r.motivo, 'indisponivel');
    const l = a.linhas('Pagamentos')[0];
    assert.equal(l.status, 'cancelado');
    assert.equal(l.alerta, 'falha_preferencia');
    a.mp.falharPreferencia = false;
    assert.equal(checkout(a, { nome: 'Outra pessoa' }).ok, true);
});

test('checkout: mesmo pedido_id duas vezes → uma reserva, uma preferência', () => {
    const a = base();
    const r1 = checkout(a, { pedido_id: 'p-1' });
    const r2 = checkout(a, { pedido_id: 'p-1' });
    assert.equal(r1.ref, r2.ref);
    assert.equal(r1.init_point, r2.init_point);
    assert.equal(a.linhas('Pagamentos').length, 1);
    assert.equal(a.mp.preferencias.length, 1);
});

test('checkout: honeypot finge sucesso e não grava', () => {
    const a = base();
    assert.equal(checkout(a, { _gotcha: 'bot' }).ok, true);
    assert.equal(a.linhas('Pagamentos').length, 0);
});

// ------------------------------------------------------------------ webhook

test('webhook: chave errada responde 200 e não consulta a API', () => {
    const a = base();
    const r = checkout(a);
    const pg = a.mp.pagar(r.ref);
    const antes = a.mp.chamadas.length;
    assert.equal(a.post({ type: 'payment', data: { id: pg.id } }, { acao: 'mp_webhook', chave: 'errada' }).ok, true);
    assert.equal(a.mp.chamadas.length, antes);
    assert.equal(pagamento(a, r.ref).status, 'pendente');
});

test('webhook: formatos v2, query e IPN antigo confirmam', () => {
    for (const formato of ['v2', 'query', 'ipn']) {
        const a = base();
        const r = checkout(a);
        const pg = a.mp.pagar(r.ref);
        if (formato === 'v2') webhook(a, { action: 'payment.updated', type: 'payment', data: { id: pg.id } });
        if (formato === 'query') webhook(a, undefined, { type: 'payment', 'data.id': pg.id });
        if (formato === 'ipn') webhook(a, undefined, { topic: 'payment', id: pg.id });
        assert.equal(pagamento(a, r.ref).status, 'confirmado', formato);
    }
});

test('webhook: 10 vezes o mesmo → mesmo estado, confirmado_em estável, um e-mail', () => {
    const a = base();
    const r = checkout(a);
    const pg = a.mp.pagar(r.ref);
    webhook(a, { type: 'payment', data: { id: pg.id } });
    const primeiro = pagamento(a, r.ref).confirmado_em;
    a.avancar(MIN);
    for (let i = 0; i < 9; i++) webhook(a, { type: 'payment', data: { id: pg.id } });
    assert.equal(pagamento(a, r.ref).confirmado_em.getTime(), primeiro.getTime());
    assert.equal(a.emails().filter((e) => e.assunto.startsWith('Presente recebido')).length, 1);
});

test('webhook: merchant_order e pagamento de outra origem são ignorados sem erro', () => {
    const a = base();
    const pg = a.mp.pagar('ref-de-outro-sistema');
    assert.equal(webhook(a, { type: 'merchant_order', data: { id: '1' } }).ok, true);
    assert.equal(webhook(a, { type: 'payment', data: { id: pg.id } }).ok, true);
    assert.equal(a.linhas('Pagamentos').length, 0);
});

// ------------------------------------------------------------------ conciliação

test('aprovado: confirmado, status invalidado, e-mail aos noivos com recado', () => {
    const a = base();
    const r = checkout(a);
    status(a); // aquece o cache
    const pg = a.mp.pagar(r.ref, { parcelas: 3 });
    webhook(a, { type: 'payment', data: { id: pg.id } });
    const l = pagamento(a, r.ref);
    assert.equal(l.status, 'confirmado');
    assert.equal(l.metodo, 'credit_card');
    assert.equal(l.parcelas, 3);
    assert.equal(l.valor_pago, 900);
    assert.equal(status(a).geladeira.disponivel, false);
    assert.equal(status(a).geladeira.reservado, false);
    const email = a.emails().find((e) => e.assunto.startsWith('Presente recebido'));
    assert.equal(email.assunto, 'Presente recebido: Geladeira, de Tia Marta');
});

test('Pix aprovado grava metodo "pix"', () => {
    const a = base();
    const r = checkout(a);
    const pg = a.mp.pagar(r.ref, { tipo: 'bank_transfer', metodo: 'pix' });
    webhook(a, { type: 'payment', data: { id: pg.id } });
    assert.equal(pagamento(a, r.ref).metodo, 'pix');
});

test('aprovado com valor diferente: NÃO confirma, alerta divergente, e-mail [ATENÇÃO]', () => {
    const a = base();
    const r = checkout(a);
    const pg = a.mp.pagar(r.ref, { valor: 9 });
    webhook(a, { type: 'payment', data: { id: pg.id } });
    const l = pagamento(a, r.ref);
    assert.equal(l.status, 'pendente');
    assert.equal(l.alerta, 'divergente');
    assert.ok(a.emails().some((e) => e.assunto.startsWith('[ATENÇÃO]')));
});

test('aprovado em outra moeda: não confirma', () => {
    const a = base();
    const r = checkout(a);
    const pg = a.mp.pagar(r.ref, { moeda: 'USD' });
    webhook(a, { type: 'payment', data: { id: pg.id } });
    assert.equal(pagamento(a, r.ref).alerta, 'divergente');
});

test('aprovado depois de a reserva expirar e outra pessoa pagar: confirma com excedente', () => {
    const a = base();
    const r1 = checkout(a);
    a.avancar(31 * MIN); // reserva 1 expirou (sem varredura ainda)
    const r2 = checkout(a, { nome: 'Segunda pessoa' });
    assert.equal(r2.ok, true);
    webhook(a, { type: 'payment', data: { id: a.mp.pagar(r2.ref).id } });
    webhook(a, { type: 'payment', data: { id: a.mp.pagar(r1.ref).id } }); // Pix atrasado
    assert.equal(pagamento(a, r2.ref).status, 'confirmado');
    assert.equal(pagamento(a, r1.ref).status, 'confirmado');
    assert.equal(pagamento(a, r1.ref).alerta, 'excedente');
});

test('recusado: libera a reserva na hora', () => {
    const a = base();
    const r = checkout(a);
    webhook(a, { type: 'payment', data: { id: a.mp.pagar(r.ref, { status: 'rejected' }).id } });
    assert.equal(pagamento(a, r.ref).status, 'recusado');
    assert.equal(checkout(a, { nome: 'Outra pessoa' }).ok, true);
});

test('recusado e depois aprovado na mesma ref → confirmado com o id do aprovado', () => {
    const a = base();
    const r = checkout(a);
    webhook(a, { type: 'payment', data: { id: a.mp.pagar(r.ref, { status: 'rejected' }).id } });
    const ok = a.mp.pagar(r.ref, { tipo: 'bank_transfer', metodo: 'pix' });
    webhook(a, { type: 'payment', data: { id: ok.id } });
    const l = pagamento(a, r.ref);
    assert.equal(l.status, 'confirmado');
    assert.equal(String(l.mp_payment_id), ok.id);
});

test('dois aprovados na mesma ref → linha extra com alerta duplicado, uma vez só', () => {
    const a = base();
    const r = checkout(a);
    const p1 = a.mp.pagar(r.ref);
    const p2 = a.mp.pagar(r.ref);
    webhook(a, { type: 'payment', data: { id: p1.id } });
    webhook(a, { type: 'payment', data: { id: p2.id } });
    const dups = a.linhas('Pagamentos').filter((l) => l.alerta === 'duplicado');
    assert.equal(dups.length, 1);
    assert.equal(String(pagamento(a, r.ref).mp_payment_id), p1.id);
});

test('confirmado que vira refunded → estornado, e a cota volta', () => {
    const a = base();
    const r = checkout(a);
    const pg = a.mp.pagar(r.ref);
    webhook(a, { type: 'payment', data: { id: pg.id } });
    a.mp.mudar(pg.id, 'refunded');
    webhook(a, { type: 'payment', data: { id: pg.id } });
    assert.equal(pagamento(a, r.ref).status, 'estornado');
    assert.equal(status(a).geladeira.disponivel, true);
    assert.equal(checkout(a, { nome: 'Nova pessoa' }).ok, true);
});

test('id do Mercado Pago com 16 dígitos é gravado e relido como texto, sem arredondar', () => {
    const a = base();
    const r = checkout(a);
    const pg = a.mp.pagar(r.ref);
    assert.ok(Number(pg.id) > Number.MAX_SAFE_INTEGER);
    webhook(a, { type: 'payment', data: { id: pg.id } });
    assert.equal(pagamento(a, r.ref).mp_payment_id, pg.id);
});

// ------------------------------------------------------------------ página de retorno

test('pagamento: estados e nenhum dado sensível', () => {
    const a = base();
    const r = checkout(a);
    let p = a.get('pagamento', { ref: r.ref });
    assert.equal(p.estado, 'pendente');
    a.mp.pagar(r.ref);
    a.ctx.CacheService.getScriptCache().removeAll(['conc_' + r.ref]);
    p = a.get('pagamento', { ref: r.ref });
    assert.equal(p.estado, 'confirmado'); // confirmou sozinho, sem webhook (caminho B)
    assert.equal(p.presente, 'Geladeira');
    assert.equal(p.nome, 'Tia Marta');
    const txt = JSON.stringify(p);
    for (const segredo of ['marta@email.com', 'Felicidades', 'mp_payment_id', '900']) assert.ok(!txt.includes(segredo), segredo);
});

test('pagamento: 30 consultas seguidas fazem no máximo UMA chamada à API', () => {
    const a = base();
    const r = checkout(a);
    const antes = a.mp.chamadas.length;
    for (let i = 0; i < 30; i++) a.get('pagamento', { ref: r.ref });
    assert.ok(a.mp.chamadas.length - antes <= 1, String(a.mp.chamadas.length - antes));
});

test('pagamento: ref inexistente ou malformada → desconhecido', () => {
    const a = base();
    assert.equal(a.get('pagamento', { ref: '00000000-0000-4000-8000-000000000000' }).estado, 'desconhecido');
    assert.equal(a.get('pagamento', { ref: "'); DROP" }).estado, 'desconhecido');
});

// ------------------------------------------------------------------ varredura

test('varredura: confirma sem webhook nem página (caminho C)', () => {
    const a = base();
    const r = checkout(a);
    a.mp.pagar(r.ref);
    a.x.varrerPagamentos();
    assert.equal(pagamento(a, r.ref).status, 'confirmado');
});

test('varredura: reserva abandonada expira só depois de 30 + 15 min', () => {
    const a = base();
    const r = checkout(a);
    a.avancar(40 * MIN);
    a.x.varrerPagamentos();
    assert.equal(pagamento(a, r.ref).status, 'pendente');
    a.avancar(6 * MIN);
    a.x.varrerPagamentos();
    assert.equal(pagamento(a, r.ref).status, 'expirado');
    assert.equal(a.get('pagamento', { ref: r.ref }).estado, 'expirado');
});

test('varredura: Pix pago dentro da folga confirma em vez de expirar', () => {
    const a = base();
    const r = checkout(a);
    a.avancar(44 * MIN);
    a.mp.pagar(r.ref, { tipo: 'bank_transfer', metodo: 'pix' });
    a.avancar(2 * MIN);
    a.x.varrerPagamentos();
    assert.equal(pagamento(a, r.ref).status, 'confirmado');
});

test('varredura: sem token não faz nada', () => {
    const a = base({ token: null });
    a.x.varrerPagamentos();
    assert.equal(a.mp.chamadas.length, 0);
});

// ------------------------------------------------------------------ convivência

test('RSVP e Pix manual continuam funcionando; Pix manual não reserva cota', () => {
    const a = base();
    assert.equal(a.post({ acao: 'rsvp', nome: 'Fulano de Tal', contato: 'f@t.com', comparece: 'sim' }).ok, true);
    assert.equal(a.post({ acao: 'reservar', presente_id: 'geladeira', nome: 'Pix manual' }).ok, true);
    const l = a.linhas('Pagamentos')[0];
    assert.equal(l.canal, 'pix_manual');
    assert.equal(status(a).geladeira.disponivel, true);
    assert.equal(a.ctx.LockService._preso(), false);
});

test('lock sempre liberado depois de checkout, webhook, consulta e varredura', () => {
    const a = base();
    const r = checkout(a);
    webhook(a, { type: 'payment', data: { id: a.mp.pagar(r.ref).id } });
    a.get('pagamento', { ref: r.ref });
    a.x.varrerPagamentos();
    assert.equal(a.ctx.LockService._preso(), false);
});

test('esquema: colunas novas são acrescentadas à DIREITA de uma planilha antiga, sem mexer em linhas', () => {
    const a = criarAmbiente({ presentes: PRESENTES, config: [['pagamento_modo', 'mercadopago']] });
    // Simula a planilha em uso: Pagamentos só com as 8 colunas antigas e uma linha antiga.
    const antigas = ['id', 'presente_id', 'nome', 'contato', 'valor', 'status', 'criado_em', 'confirmado_em'];
    a.sheets.Pagamentos.dados = [antigas.slice(), ['old-1', 'vela', 'Antiga', '', 95, 'confirmado', 'x', 'y']];
    a.x.definirTokenMercadoPago(TOKEN, 'teste');
    assert.equal(checkout(a).ok, true);
    const cab = a.sheets.Pagamentos.dados[0];
    assert.deepEqual(cab.slice(0, 8), antigas);
    assert.ok(cab.includes('mp_payment_id') && cab.includes('expira_em'));
    assert.deepEqual(a.sheets.Pagamentos.dados[1].slice(0, 8), ['old-1', 'vela', 'Antiga', '', 95, 'confirmado', 'x', 'y']);
});

test('admin: listarRecebidos traz confirmados com recado, e exige senha', () => {
    const a = base();
    a.x.definirSenhaNoivos('senha-de-teste-do-ci');
    const r = checkout(a);
    webhook(a, { type: 'payment', data: { id: a.mp.pagar(r.ref).id } });
    assert.equal(a.post({ acao: 'listarRecebidos' }).ok, false);
    const lista = a.post({ acao: 'listarRecebidos', senha: 'senha-de-teste-do-ci' }).recebidos;
    assert.equal(lista.length, 1);
    assert.equal(lista[0].recado, 'Felicidades!');
    assert.equal(lista[0].presente, 'Geladeira');
});

test('testePreferencia devolve os campos que a API confirmou', () => {
    const a = base();
    const c = a.x.testePreferencia();
    assert.equal(c.binary_mode, true);
    assert.match(c.notification_url, /chave=\*\*\*$/);
});

// ------------------------------------------------------------------ ligar e desligar

test('ligarTesteMercadoPago: modo teste, só a varredura agendada, link e webhook no retorno', () => {
    const a = base({ modo: 'pix' });
    const msg = a.x.ligarTesteMercadoPago();
    const cfg = Object.fromEntries(a.linhas('Config').map((l) => [l.chave, l.valor]));
    assert.equal(cfg.pagamento_modo, 'teste');
    assert.deepEqual(a.ctx.ScriptApp._gatilhos(), ['varrerPagamentos']); // campanha NÃO
    const chave = a.ctx.PropertiesService.getScriptProperties().getProperty('mp_chave_teste');
    assert.ok(msg.includes('https://giseleevictor.com.br/presentes/?teste=' + chave), msg);
    assert.match(msg, /\?acao=mp_webhook&chave=[0-9a-f]{40}/);
    assert.equal(a.get('status').pagamento, 'teste');
    assert.equal(checkout(a, { chave_teste: chave }).ok, true);
    assert.equal(checkout(a).motivo, 'indisponivel'); // sem a chave, continua Pix

    a.x.ligarTesteMercadoPago(); // de novo: não duplica o gatilho
    assert.deepEqual(a.ctx.ScriptApp._gatilhos(), ['varrerPagamentos']);
});

test('ligarTesteMercadoPago sem token: recusa e não muda o modo', () => {
    const a = base({ modo: 'pix', token: null });
    assert.throws(() => a.x.ligarTesteMercadoPago(), /definirTokenMercadoPago/);
    assert.equal(a.get('status').pagamento, 'pix');
    assert.deepEqual(a.ctx.ScriptApp._gatilhos(), []);
});

test('desligarMercadoPago: volta ao Pix na hora, sem apagar token nem reservas', () => {
    const a = base({ modo: 'mercadopago' });
    const r = checkout(a);
    a.x.desligarMercadoPago();
    assert.equal(a.get('status').pagamento, 'pix');
    assert.equal(checkout(a).motivo, 'indisponivel');
    assert.equal(pagamento(a, r.ref).status, 'pendente');
    assert.ok(a.ctx.PropertiesService.getScriptProperties().getProperty('mp_access_token'));
});

test('limparTesteMercadoPago: apaga só as linhas do Mercado Pago, e nunca com token de produção', () => {
    const a = base();
    const r1 = checkout(a);
    webhook(a, { type: 'payment', data: { id: a.mp.pagar(r1.ref).id } });
    checkout(a, { presente_id: 'vela' });
    a.post({ acao: 'reservar', presente_id: 'vela', nome: 'Pix Manual' });
    const manuais = a.linhas('Pagamentos').filter((l) => l.canal !== 'mercadopago');
    assert.equal(a.linhas('Pagamentos').length - manuais.length, 2);

    assert.match(a.x.limparTesteMercadoPago(), /2 linha/);
    assert.deepEqual(a.linhas('Pagamentos'), manuais);
    assert.equal(a.get('status').status.geladeira.disponivel, true);

    const p = base();
    checkout(p);
    p.x.definirTokenMercadoPago(TOKEN, 'producao');
    assert.throws(() => p.x.limparTesteMercadoPago(), /produção/);
    assert.equal(p.linhas('Pagamentos').length, 1);
});
