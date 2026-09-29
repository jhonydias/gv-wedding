/**
 * Área dos noivos (task 17), contra o Code.gs real. Roda com `npm run test:backend`.
 *
 * A senha aqui é de TESTE, definida pelo próprio teste: o repositório é público e a senha
 * real dos noivos nunca entra nele.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarAmbiente } from './gas.mjs';

const SENHA = 'senha-de-teste-do-ci';

const base = () => {
    const a = criarAmbiente({
    presentes: [
        ['toalhas', 'Jogo de toalhas', 120, 'gisele', 'https://img/toalha.jpg', '', false, 1, 20],
        ['vela-aromatica', 'Vela aromática', 95, 'gisele', 'https://img/vela.jpg', '', true, 3, 30],
        ['geladeira', 'Geladeira', 2500, 'victor', '', '', true, 1, 120],
    ],
    pagamentos: [
        ['p1', 'vela-aromatica', 'A', '', 95, 'confirmado', '', ''],
        ['p2', 'vela-aromatica', 'B', '', 95, 'confirmado', '', ''],
        ['p3', 'vela-aromatica', 'C', '', 95, 'pendente', '', ''],
        ['p4', 'geladeira', 'D', '', 2500, 'cancelado', '', ''],
    ],
    });
    a.x.definirSenhaNoivos(SENHA);
    return a;
};
const cria = (a, extra) => a.post({ acao: 'criarPresente', senha: SENHA, nome: 'Cafeteira italiana', valor: 180, imagem: 'https://img/cafe.jpg', cotas: 1, categoria: 'resenha', ...extra });
const lista = (a) => a.post({ acao: 'listarPresentes', senha: SENHA }).presentes;
const linhasPresentes = (a) => a.sheets.Presentes.dados.length - 1;

test('ping responde a versão atual', () => assert.equal(base().get('ping').versao, '22.2'));

test('entrar certo / errado, sem senha no Log', () => {
    const a = base();
    assert.equal(a.post({ acao: 'entrar', senha: SENHA }).ok, true);
    const r = a.post({ acao: 'entrar', senha: 'tentativa-xyz' });
    assert.equal(r.ok, false); assert.equal(r.motivo, 'senha');
    assert.ok(!JSON.stringify(a.sheets.Log.dados).includes('tentativa-xyz'));
});

test('bloqueio após 5 erros, inclusive com a senha certa', () => {
    const a = base();
    for (let i = 0; i < 5; i++) a.post({ acao: 'entrar', senha: 'x' });
    const r = a.post({ acao: 'entrar', senha: SENHA });
    assert.equal(r.motivo, 'bloqueado');
});

test('criar sem senha não grava', () => {
    const a = base();
    assert.equal(cria(a, { senha: undefined }).ok, false);
    assert.equal(linhasPresentes(a), 3);
});

test('criar: grava, deriva id/ordem, invalida cache', () => {
    const a = base();
    a.get('catalogo'); // aquece cache
    const r = cria(a, { pedido_id: 'p-1' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.id, 'cafeteira-italiana'); assert.equal(r.faixa, 'resenha');
    assert.equal(r.publicacao, 'agendada');
    const l = a.sheets.Presentes.dados.at(-1);
    assert.equal(JSON.stringify(l), JSON.stringify(['cafeteira-italiana', 'Cafeteira italiana', 180, 'resenha', 'https://img/cafe.jpg', '', true, 1, 130, false]));
    assert.ok(a.get('catalogo').presentes.some((p) => p.id === 'cafeteira-italiana'));
});

test('categoria é a escolhida, não depende do valor', () => {
    const a = base();
    assert.equal(cria(a, { nome: 'Barato', valor: 20, categoria: 'salvador' }).faixa, 'salvador');
    assert.equal(cria(a, { nome: 'Caro', valor: 5000, categoria: ' Ruth ' }).faixa, 'ruth');
});

test('categoria fora da lista é recusada', () => {
    const a = base();
    assert.equal(cria(a, { categoria: 'casa' }).campo, 'categoria');
    assert.equal(linhasPresentes(a), 3);
});

test('criar pelo painel antigo (sem categoria) pede para atualizar', () => {
    const a = base();
    const r = cria(a, { categoria: undefined, luademel: true });
    assert.equal(r.ok, false); assert.match(r.msg, /Atualize a página/);
    assert.equal(linhasPresentes(a), 3);
});

test('slug sem acento', () => assert.equal(cria(base(), { nome: 'Açúcar & Café' }).id, 'acucar-cafe'));

test('colisão com id inativo', () => assert.equal(cria(base(), { nome: 'Toalhas' }).id, 'toalhas-2'));

test('colisão de txid', () => {
    const a = base();
    const r1 = cria(a, { nome: 'Jogo de panelas antiaderente premium' });
    const r2 = cria(a, { nome: 'Jogo de panelas antiaderente premium inox' });
    assert.notEqual(a.x.txidDe_(r1.id), a.x.txidDe_(r2.id));
    const r3 = cria(a, { nome: 'Jogo de panelas antiaderente premium' });
    assert.notEqual(a.x.txidDe_(r3.id), a.x.txidDe_(r1.id));
    assert.notEqual(a.x.txidDe_(r3.id), a.x.txidDe_(r2.id));
});

test('validações', () => {
    const a = base();
    assert.equal(cria(a, { valor: 179.9 }).campo, 'valor');
    assert.equal(cria(a, { valor: 5 }).campo, 'valor');
    assert.equal(cria(a, { nome: 'x' }).campo, 'nome');
    assert.equal(cria(a, { imagem: 'http://a/b.jpg' }).campo, 'imagem');
    assert.equal(cria(a, { cotas: 0 }).campo, 'cotas');
    assert.equal(cria(a, { descricao: 'x'.repeat(141) }).campo, 'descricao');
    assert.equal(linhasPresentes(a), 3);
});

test('link de página é recusado; rede fora vira aviso', () => {
    const a = base();
    const r = cria(a, { imagem: 'https://loja/produto/123' });
    assert.equal(r.ok, false); assert.equal(r.campo, 'imagem');
    const r2 = cria(a, { imagem: 'https://offline/a.jpg' });
    assert.equal(r2.ok, true); assert.equal(r2.avisos.length, 1);
});

test('travessão normalizado', () => {
    const a = base();
    const r = cria(a, { nome: 'Jantar — especial', descricao: 'Para nós —' });
    assert.equal(r.nome, 'Jantar: especial');
    assert.equal(a.sheets.Presentes.dados.at(-1)[5], 'Para nós');
    assert.ok(r.avisos.length >= 1);
});

test('fórmula não entra na planilha', () => {
    const a = base();
    cria(a, { nome: '=HYPERLINK("x")' });
    assert.equal(a.sheets.Presentes.dados.at(-1)[1], '=HYPERLINK("x")'); // valor, não fórmula (o mock tira o apóstrofo)
});

test('imagem repetida é aviso', () => {
    const a = base();
    const r = cria(a, { imagem: 'https://img/vela.jpg' });
    assert.equal(r.ok, true); assert.ok(r.avisos.some((x) => x.includes('Vela')));
});

test('idempotência do criar', () => {
    const a = base();
    const r1 = cria(a, { pedido_id: 'dup' }); const r2 = cria(a, { pedido_id: 'dup' });
    assert.equal(r1.id, r2.id); assert.equal(linhasPresentes(a), 4);
});

test('listar: inclui inativo, contagem sem nomes', () => {
    const a = base();
    const l = lista(a);
    assert.equal(l.length, 3);
    assert.equal(l.find((p) => p.id === 'toalhas').ativo, false);
    assert.equal(JSON.stringify(l.find((p) => p.id === 'vela-aromatica').pagamentos), JSON.stringify({ pendente: 1, confirmado: 2, cancelado: 0, recusado: 0, expirado: 0, estornado: 0, total: 3 }));
    const txt = JSON.stringify(l);
    assert.ok(!txt.includes('"A"') && !txt.includes('"D"'));
    assert.equal(a.post({ acao: 'listarPresentes' }).ok, false);
});

const edita = (a, id, mud, pedido) => {
    const p = lista(a).find((x) => x.id === id);
    return a.post({
        acao: 'editarPresente', senha: SENHA, pedido_id: pedido, id, versao: p.versao,
        nome: p.nome, valor: p.valor, categoria: p.faixa, imagem: p.imagem,
        descricao: p.descricao, cotas: p.cotas, publicar: p.ativo, ...mud,
    });
};

test('editar mantém id', () => {
    const a = base();
    const r = edita(a, 'toalhas', { nome: 'Toalhas de banho' });
    assert.equal(r.ok, true); assert.equal(r.id, 'toalhas');
    assert.equal(a.sheets.Presentes.dados[1][1], 'Toalhas de banho');
});

test('editar acha pelo id mesmo com linha apagada acima', () => {
    const a = base();
    const p = lista(a).find((x) => x.id === 'geladeira');
    a.sheets.Presentes.dados.splice(1, 1); // alguém apagou "toalhas" na planilha
    const r = a.post({ acao: 'editarPresente', senha: SENHA, id: 'geladeira', versao: p.versao, nome: 'Geladeira duplex', valor: 2500, imagem: '', cotas: 1 });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(a.sheets.Presentes.dados.find((l) => l[0] === 'geladeira')[1], 'Geladeira duplex');
    assert.equal(a.sheets.Presentes.dados.find((l) => l[0] === 'vela-aromatica')[1], 'Vela aromática');
});

test('conflito de versão', () => {
    const a = base();
    const p = lista(a).find((x) => x.id === 'toalhas');
    edita(a, 'toalhas', { nome: 'Outro nome' });
    const r = a.post({ acao: 'editarPresente', senha: SENHA, id: 'toalhas', versao: p.versao, nome: 'Meu nome', valor: 120, imagem: '', cotas: 1 });
    assert.equal(r.motivo, 'conflito'); assert.equal(r.presente.nome, 'Outro nome');
});

test('reenvio de edição não gera conflito falso', () => {
    const a = base();
    const p = lista(a).find((x) => x.id === 'toalhas');
    const corpo = { acao: 'editarPresente', senha: SENHA, pedido_id: 'e1', id: 'toalhas', versao: p.versao, nome: 'X toalhas', valor: 120, imagem: '', cotas: 1 };
    assert.equal(a.post(corpo).ok, true); assert.equal(a.post(corpo).ok, true);
});

test('cotas abaixo do pago recusadas; avisos de pendente', () => {
    const a = base();
    const r = edita(a, 'vela-aromatica', { cotas: 1 });
    assert.equal(r.campo, 'cotas'); assert.match(r.msg, /mínimo é 2/);
    const r2 = edita(a, 'vela-aromatica', { valor: 110 });
    assert.equal(r2.ok, true); assert.ok(r2.avisos.some((x) => x.includes('valor antigo')));
});

test('mudança de categoria vai para o fim', () => {
    const a = base();
    const r = edita(a, 'toalhas', { categoria: 'victor' });
    assert.equal(r.faixa, 'victor');
    assert.equal(a.sheets.Presentes.dados[1][8], 130);
});

test('mudar o valor não muda a categoria', () => {
    const a = base();
    const r = edita(a, 'toalhas', { valor: 900 });
    assert.equal(r.faixa, 'gisele');
    assert.equal(a.sheets.Presentes.dados[1][8], 20);
});

test('editar pelo painel antigo (sem categoria) mantém a categoria', () => {
    const a = base();
    const r = edita(a, 'toalhas', { categoria: undefined, luademel: true, nome: 'Toalhas novas' });
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.faixa, 'gisele');
    assert.equal(a.sheets.Presentes.dados[1][3], 'gisele');
});

test('migrarCategorias: pelo id, idempotente, sem mexer em pagamento', () => {
    const a = criarAmbiente({
        presentes: [
            ['jogo-de-cama', 'Sessão de massagem', 220, 'casa', '', '', true, '', 60],
            ['conserto-da-poltrona-que-a-ruth-comeu', 'Conserto da poltrona', 350, 'casa', '', '', true, '', 330],
            ['fora-da-lista', 'Outro', 100, 'lembranca', '', '', true, '', 400],
        ],
        pagamentos: [['p1', 'jogo-de-cama', 'A', '', 220, 'confirmado', '', '']],
    });
    const r = a.x.migrarCategorias();
    assert.match(r, /^4 célula/); assert.match(r, /não encontrados: tabua-de-servir/);
    const d = a.sheets.Presentes.dados;
    assert.deepEqual(
        [d[1][0], d[1][1], d[1][3], d[2][3], d[2][8], d[3][3]],
        ['jogo-de-cama', 'Sessão de massagem de casal pós-maratona de trio elétrico', 'salvador', 'resenha', 375, 'lembranca'],
    );
    assert.equal(a.sheets.Pagamentos.dados[1][1], 'jogo-de-cama');
    assert.match(a.x.migrarCategorias(), /^0 célula/);
    assert.equal(a.get('catalogo').presentes.find((p) => p.id === 'jogo-de-cama').faixa, 'salvador');
});

test('tirar do site', () => {
    const a = base();
    edita(a, 'vela-aromatica', { publicar: false });
    assert.ok(!a.get('catalogo').presentes.some((p) => p.id === 'vela-aromatica'));
    assert.equal(a.sheets.Pagamentos.dados.length, 5);
});

const apaga = (a, id, pedido) => a.post({ acao: 'apagarPresente', senha: SENHA, id, pedido_id: pedido });

test('apagar sem pagamento: remove e loga a linha', () => {
    const a = base();
    const r = apaga(a, 'toalhas');
    assert.equal(r.ok, true);
    assert.ok(!a.sheets.Presentes.dados.some((l) => l[0] === 'toalhas'));
    assert.ok(a.sheets.Log.dados.some((l) => l[2] === 'apagarPresente' && l[3].includes('Jogo de toalhas')));
});

test('apagar com pagamento cancelado é recusado', () => {
    const a = base();
    const r = apaga(a, 'geladeira');
    assert.equal(r.motivo, 'tem_pagamento');
    assert.ok(a.sheets.Presentes.dados.some((l) => l[0] === 'geladeira'));
});

test('apagar duas vezes', () => {
    const a = base();
    assert.equal(apaga(a, 'toalhas').ok, true); assert.equal(apaga(a, 'toalhas').ok, true);
    assert.equal(linhasPresentes(a), 2);
});

test('lock liberado depois de tudo; rsvp continua funcionando', () => {
    const a = base();
    cria(a); apaga(a, 'toalhas');
    assert.equal(a.ctx.LockService._preso(), false);
    const r = a.post({ acao: 'rsvp', nome: 'Fulano de Tal', contato: 'f@t.com', comparece: 'sim' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(a.post({ acao: 'reservar', presente_id: 'geladeira', nome: 'X' }).ok, true);
});

test('com token: dispara o deploy', () => {
    const a = base();
    a.ctx.PropertiesService.getScriptProperties().setProperty('github_token', 't');
    assert.equal(cria(a).publicacao, 'disparada');
});

test('JSON inválido no POST não quebra', () => {
    const a = base();
    const r = JSON.parse(a.x.doPost({ postData: { contents: 'lixo' } }).getContent());
    assert.equal(r.ok, false);
});


test('nome aceita até 100 letras', () => {
    const a = base();
    assert.equal(cria(a, { nome: 'x'.repeat(100) }).ok, true);
    assert.equal(cria(a, { nome: 'y'.repeat(101) }).campo, 'nome');
});
