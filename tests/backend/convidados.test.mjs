/**
 * Linha em branco no meio de uma aba. O `lerAba_()` numerava as linhas DEPOIS de descartar
 * as vazias, e `Convidados` escreve pelo `_linha`: com uma confirmação apagada à mão, o
 * reenvio de outro convidado sobrescrevia a linha vizinha, e a campanha marcava o e-mail
 * enviado na pessoa errada.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarAmbiente } from './gas.mjs';

const rsvp = (a, nome, contato, extra = {}) =>
    a.post({ acao: 'rsvp', nome, contato, comparece: 'sim', ...extra });

/** Três confirmações e a primeira apagada à mão: linha 2 em branco, B na 3, C na 4. */
function comLinhaEmBranco() {
    const a = criarAmbiente();
    assert.equal(rsvp(a, 'Ana Primeira', 'ana@t.com').ok, true);
    assert.equal(rsvp(a, 'Bruno Segundo', 'bruno@t.com').ok, true);
    assert.equal(rsvp(a, 'Carla Terceira', 'carla@t.com').ok, true);
    const larg = a.sheets.Convidados.dados[1].length;
    a.sheets.Convidados.dados[1] = Array(larg).fill('');
    return a;
}

test('lerAba_ devolve o número REAL da linha, mesmo com linha em branco no meio', () => {
    const a = comLinhaEmBranco();
    const porNome = Object.fromEntries(a.x.lerAba_('Convidados').map((l) => [l.nome, l._linha]));
    assert.deepEqual(porNome, { 'Bruno Segundo': 3, 'Carla Terceira': 4 });
});

test('reenvio do RSVP atualiza a própria linha, não a do vizinho', () => {
    const a = comLinhaEmBranco();
    const antes = a.sheets.Convidados.dados.map((l) => l.slice());

    const r = rsvp(a, 'Carla Terceira', 'carla@t.com', { recado: 'mudei o recado' });
    assert.equal(r.ok, true);

    const d = a.sheets.Convidados.dados;
    assert.equal(d.length, antes.length, 'não cria linha nova');
    assert.deepEqual(d[1], antes[1], 'a linha em branco continua em branco');
    assert.deepEqual(d[2], antes[2], 'Bruno fica intacto');
    const cab = d[0];
    assert.equal(d[3][cab.indexOf('nome')], 'Carla Terceira');
    assert.equal(d[3][cab.indexOf('recado')], 'mudei o recado');
});

test('campanha marca o e-mail enviado em quem recebeu', () => {
    const a = comLinhaEmBranco();
    const res = a.x.enviarCampanha('d30');
    assert.equal(res.enviados, 2);
    const cab = a.sheets.Convidados.dados[0];
    const marcados = a.sheets.Convidados.dados.slice(1)
        .filter((l) => l[cab.indexOf('emails_enviados')] === 'd30')
        .map((l) => l[cab.indexOf('nome')]);
    assert.deepEqual(marcados.sort(), ['Bruno Segundo', 'Carla Terceira']);
});

test('Config: chave apagada e linha em branco no meio não atrapalham a leitura', () => {
    const a = criarAmbiente({ config: [['', ''], ['lote_email_max', '7']] });
    assert.equal(a.get('ping').ok, true);
    assert.equal(rsvp(a, 'Ana Primeira', 'ana@t.com').ok, true);
});
