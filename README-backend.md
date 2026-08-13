# Backend — deploy e operação

Um serviço único em **Google Apps Script + Planilha** atende as três frentes do site:

| Frente | Como |
|---|---|
| **Catálogo de presentes** | `GET ?acao=catalogo` — lido no build |
| **Disponibilidade** | `GET ?acao=status` — lido no cliente, com degradação |
| **Confirmação de presença** | `POST { acao: 'rsvp' }` |
| **Reserva de presente** | `POST { acao: 'reservar' }` |
| **Campanha de e-mail** | gatilho diário |

Fonte: **`scripts/Code.gs`**. Sem servidor, sem custo, sem plano para renovar — o site precisa
funcionar até fevereiro de 2027 sem ninguém mexer.

---

## ⚠️ Antes de tudo: limpar e restringir a planilha

A planilha base é uma **cópia da planilha de produção do `wedding-web`** e contém **nome e e-mail
de convidados reais** do casamento anterior, além de nomes de quem pagou. São dados de terceiros.

1. **Apague todas as abas e dados herdados.**
2. **Restrinja o compartilhamento**: só os noivos. Remova o "qualquer pessoa com o link".
3. **Nunca** gere link público de leitura depois.

O front nunca acessa a planilha — só o Apps Script, que expõe apenas o catálogo.

---

## 1. Preparar a planilha

1. Abra a planilha → **Extensões → Apps Script**.
2. Apague o `Code.gs` padrão e cole o conteúdo de **`scripts/Code.gs`**.
3. Salve (`Ctrl+S`) e nomeie o projeto: **"GV Wedding Backend"**.
4. No dropdown de funções escolha **`configurarPlanilha`** → **▶ Executar**.
   Autorize quando pedir. Isso cria as 5 abas com cabeçalho e preenche a `Config`.

### As 5 abas

| Aba | Papel |
|---|---|
| `Presentes` | catálogo. `ativo` controla o que aparece; `cotas` quantas pessoas podem dar |
| `Pagamentos` | um registro por reserva. **Só `confirmado` consome cota** |
| `Convidados` | RSVPs, mesa, e-mails já enviados, descadastro |
| `Config` | chaves que mudam sem republicar o script |
| `Log` | rastro de tudo. Sem isso, depurar Apps Script é adivinhação |

### Não existe coluna "comprado"

Disponibilidade é **derivada** dos pagamentos `confirmado`. É correção direta de um problema real
da planilha herdada: dois presentes foram tirados do ar tendo apenas pagamento **recusado** —
o convidado escolhia, o pagamento falhava, e o presente sumia para todo mundo.

---

## 2. Preencher a `Config`

| Chave | O que é |
|---|---|
| `evento_quando` | `2027-01-31T19:00:00-03:00` — já preenchido |
| `evento_local` · `evento_endereco` | já preenchidos |
| `site_url` | URL pública do site |
| `email_noivos` | quem recebe a notificação de cada RSVP |
| `whatsapp` | contato mostrado em caso de erro |
| `rsvp_ate` | prazo de confirmação (opcional) |
| `pix_chave` | referência; o BR Code é gerado no build |
| **`modo_simulacao`** | **`TRUE` = nada é enviado de verdade** |
| `segredo_token` | gerado automaticamente. **Não troque** — invalida os links de descadastro |
| `lote_email_max` | teto de e-mails por execução (padrão 80) |

---

## 3. Testar antes de publicar

No editor, rode nesta ordem:

| Função | O que confere |
|---|---|
| `testeLeitura()` | catálogo e status saem certos |
| `testeManual()` | grava um RSVP de teste na aba `Convidados` |
| `testeCampanha()` | simula a campanha `d30` **sem enviar** |

Veja o resultado em **Execuções** (ícone de relógio) e na aba `Log`.
**Apague as linhas de teste** antes de publicar.

---

## 4. Publicar

1. **Implantar → Nova implantação**.
2. Tipo (⚙️): **App da Web**.
3. **Executar como:** `Eu` · **Quem tem acesso:** **`Qualquer pessoa`** ⚠️
4. **Implantar** e copie a URL `…/exec`.

> ⚠️ Sem "Qualquer pessoa" o front recebe **403**. É o erro nº 1 aqui.

Confira com `SUA_URL/exec?acao=ping` — deve devolver `{"ok":true,"versao":"10.0",…}`.

---

## 5. Conectar o front

**Local** — crie `.env` na raiz:

```
PUBLIC_BACKEND_URL=https://script.google.com/macros/s/AKfyc.../exec
```

**Produção** — *Settings → Secrets and variables → Actions*, secret `PUBLIC_BACKEND_URL`.
O workflow já injeta.

> Salve o `.env` como **UTF-8 sem BOM**. O Bloco de Notas e o `Out-File` do PowerShell gravam
> com BOM, e o Astro ignora a variável em silêncio.

Sem a variável: `/confirmar` mostra um aviso no lugar do formulário, e `/presentes` renderiza
tudo como disponível — o site não quebra.

### Latência do Apps Script

Medido contra o endpoint real, do browser:

| | Tempo |
|---|---|
| Em regime (5 chamadas seguidas) | 1046–1576 ms, mediana **1256 ms** |
| **Cold start** (primeira do dia / após ociosidade) | **7560 ms** |

Por isso o timeout do `?acao=status` é de **8 s**, não 3. O fetch não bloqueia a renderização —
a página já está completa quando ele sai —, então esperar mais não custa nada, e com 3 s o
primeiro visitante do dia sempre cairia na degradação.

---

## 6. Ligar a campanha de e-mail

Rode **`instalarGatilhos()`** uma vez. Cria um gatilho diário às 9h que dispara a campanha do dia.

| Chave | Quando | Conteúdo |
|---|---|---|
| `confirmacao` | na hora do RSVP | protocolo e resumo |
| `d30` | 30 dias antes | local, mapa, traje, hospedagem |
| `d7` | 7 dias antes | horário e endereço |
| `d1` | véspera | "é amanhã" e link do Uber |
| `pos` | 3 dias depois | agradecimento e galeria |

### Regras que o código garante

- **Só para quem marcou `sim`.** Quem avisou que não vai não recebe lembrete.
- **Nunca envia duas vezes.** A chave entra em `Convidados.emails_enviados` **depois** do envio,
  e todo disparo confere a lista antes. Reexecutar o gatilho não reenvia.
- **`descadastrado = TRUE`** não recebe nada além da confirmação.
- **Cota do Gmail: 100 destinatários/dia** em conta gratuita. Com ~150 convidados **uma leva não
  cabe**: o código verifica `getRemainingDailyQuota()` antes de cada envio, para com folga de 5 e
  **retoma no dia seguinte** de onde parou.
- Contato que é só celular é **pulado** (não dá para mandar e-mail).

### ⚠️ Antes do primeiro envio real

`modo_simulacao` nasce **`TRUE`**: tudo roda, tudo é logado, **nada sai**.

Só vire para `FALSE` **com autorização explícita dos noivos**. E-mail para lista de convidados é
irreversível — não existe "despublicar". Rode `testeCampanha()` em simulação, confira a aba `Log`
e só então mude.

---

## 7. Operação no dia a dia

### Congelar o catálogo — `npm run catalogo`

O catálogo **não** é buscado durante o `astro build`. Ele é congelado em
`src/data/catalogo.json`, que é **versionado**:

```
npm run catalogo     # lê ?acao=catalogo e regrava o JSON
git add src/data/catalogo.json && git commit
```

Por quê: o build não pode depender de rede. Se a planilha estiver fora do ar, ou o CI não tiver
saída para a internet, o deploy tem que continuar funcionando com o último catálogo bom.

O script valida item a item (id, nome, valor, faixa conhecida) e **descarta linha torta** com
aviso — uma célula errada na planilha não vira card quebrado. Id duplicado aborta.

**Rode este comando toda vez que mexer na aba `Presentes`.** Sem isso, o site continua mostrando
o catálogo anterior.

### Popular com dados de teste

No editor do Apps Script há **`semearPresentes()`**: insere 20 presentes fake cobrindo as quatro
faixas. É idempotente — rodar duas vezes não duplica. Para remover, **`limparPresentesFake()`**,
que apaga só o que ela inseriu.

Depois de semear, rode `npm run catalogo` para o site enxergar.

### Cadastrar presentes de verdade

Adicione linhas em `Presentes`. `id` é um slug estável (`jogo-de-jantar`) — ele vira o `txid` do
Pix e **aparece no extrato**, então **não use UUID**. `cotas = 1` para item único; vazio para
ilimitado (vaquinhas). Depois, `npm run catalogo`.

**Confirmar um pagamento:** o Pix é estático, ninguém avisa que o dinheiro caiu. Ao ver no
extrato, mude o `status` da linha em `Pagamentos` de `pendente` para `confirmado`. O presente sai
do ar em até 60 s (cache).

**Mesas:** preencha a coluna `mesa` em `Convidados` à mão.

---

## 8. Problemas comuns

| Sintoma | Causa |
|---|---|
| **403 / Forbidden** | Publicado como "Apenas eu". Refaça o passo 4 |
| **Erro de CORS** | O `Content-Type` foi trocado para `application/json`. O Apps Script não responde ao preflight `OPTIONS` — tem que ser `text/plain` |
| **Formulário não aparece** | `PUBLIC_BACKEND_URL` ausente, ou `.env` com BOM |
| **Presentes todos disponíveis** | O `GET ?acao=status` falhou. É a degradação proposital — veja a aba `Log` |
| **Mudei a planilha e o site não viu** | Cache: catálogo 5 min, status 60 s |
| **E-mail não chega** | `modo_simulacao=TRUE`, cota estourada, ou spam. Veja o `Log` |
| **Linha não aparece** | Apps Script → **Execuções** → última → detalhes |

**Editou o `Code.gs`?** Salvar não basta:
*Implantar → Gerenciar implantações → ✏️ → Versão: **Nova versão** → Implantar.*
A URL continua a mesma.

---

## 9. Pendências

- [x] ~~Apagar dados herdados~~ — feito, a planilha está limpa com as 5 abas
- [ ] **Restringir o compartilhamento** da planilha
- [ ] Preencher `email_noivos` e `whatsapp` na `Config`
- [ ] Rodar `semearPresentes()` e depois `npm run catalogo`
- [ ] **Substituir a chave Pix de teste pela real** — o `.env` tem uma chave
      `00000000-0000-4000-8000-000000000000`, que **não recebe dinheiro**
- [ ] Cadastrar os presentes reais (curadoria dos noivos)
- [ ] Criar o secret `PUBLIC_BACKEND_URL` no GitHub
- [ ] Definir `rsvp_ate`
- [ ] Rodar a campanha em simulação e conferir o `Log`
- [ ] Autorização dos noivos antes de `modo_simulacao = FALSE`
