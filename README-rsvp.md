# RSVP — deploy do backend

Confirmação de presença do site. Roda em **Google Apps Script + Planilha**, sem servidor e
sem custo. Escolhido para que o site continue funcionando até fev/2027 sem ninguém renovar plano,
e para que os dados fiquem com os noivos, numa planilha que eles já sabem usar.

---

## 1. Criar a planilha

1. Em <https://sheets.google.com>, crie uma planilha em branco.
2. Renomeie para **"Gisele & Victor — Confirmações"**.
3. **Não** crie a aba `Confirmacoes` à mão — o script cria no primeiro envio.

## 2. Colar o script

1. Na planilha: **Extensões → Apps Script**.
2. Apague o conteúdo padrão de `Code.gs`.
3. Cole o conteúdo de **`script/Code.gs`** deste repositório.
4. No topo, ajuste `CONFIG.EMAIL_NOIVOS` para quem deve receber as notificações.
5. Salve (`Ctrl+S`) e dê o nome **"GV Wedding RSVP"** ao projeto.

## 3. Testar antes de publicar

1. No dropdown de funções, selecione **`testeManual`** e clique em **▶ Executar**.
2. Autorize quando pedir (é seu próprio script; se aparecer aviso, "Avançado" → "Acessar projeto").
3. Volte à planilha: a aba `Confirmacoes` deve existir com uma linha de teste, e o e-mail deve
   chegar.
4. **Apague a linha de teste** antes de publicar.

## 4. Publicar como App da Web

1. **Implantar → Nova implantação**.
2. Tipo (engrenagem ⚙️): **App da Web**.
3. Preencha:
   - **Descrição**: `v1 — produção`
   - **Executar como**: `Eu`
   - **Quem tem acesso**: **`Qualquer pessoa`** ⚠️
4. **Implantar** e **copie a URL** `https://script.google.com/macros/s/AKfyc.../exec`.

> ⚠️ Sem "Qualquer pessoa" o front recebe **403**. É o erro nº 1 aqui.

## 5. Conectar o front

A URL vai numa variável de ambiente — **nunca commitada**.

**Local:** crie `.env` na raiz do projeto:

```
PUBLIC_RSVP_ENDPOINT=https://script.google.com/macros/s/AKfyc.../exec
```

**Produção (GitHub Actions):** *Settings → Secrets and variables → Actions → New secret*,
com o nome `PUBLIC_RSVP_ENDPOINT`. O workflow da task 09 já injeta no build.

Sem a variável, a página `/confirmar` mostra um aviso em vez do formulário.

> Variáveis `PUBLIC_*` do Astro **aparecem no HTML publicado** — é inerente. Elas ficam em
> secrets para não entrar no repositório, não porque sejam confidenciais em runtime. A URL do
> `/exec` é um endpoint público de qualquer forma.

## 6. Atualizar depois

**Editou o `Code.gs`?** Salvar não basta:
*Implantar → Gerenciar implantações → ✏️ → Versão: **Nova versão** → Implantar.*
A URL continua a mesma.

**Editou o front?** Commit e push — o Pages reconstrói.

---

## Como funciona

```
Browser (form)  ──POST text/plain──▶  Apps Script  ──▶  Planilha
      │                                    │
      │◀────── JSON {ok, msg, protocolo} ──┴──▶  e-mail aos noivos
```

### A pegadinha de CORS

O Apps Script **não responde ao preflight `OPTIONS`**. Se o front mandasse
`Content-Type: application/json`, o browser dispararia preflight e a requisição morreria com um
erro de CORS que *parece* problema de permissão.

Por isso o envio usa `Content-Type: text/plain;charset=utf-8` — content-type "simples", que não
gera preflight. O corpo continua sendo JSON. **Não troque esse cabeçalho.**

### Proteções implementadas

| Proteção | Onde |
|---|---|
| `LockService` em volta da escrita | evita duas confirmações simultâneas se sobrescreverem |
| Revalidação completa server-side | o cliente não é fonte de verdade |
| `total_pessoas` calculado no servidor | payload forjado não infla o buffet |
| Sanitização (remove HTML, trunca) | `sanitizar_()` |
| Rate limit: 3 envios / 5 min por contato | `rateLimitado_()` |
| Idempotência: mesmo contato+nome em 24h **atualiza** | `gravarOuAtualizar_()` |
| Honeypot `_gotcha` | responde `ok` e descarta em silêncio |
| Sem stack trace na resposta | erro real fica no log |

---

## Problemas comuns

| Sintoma | Causa |
|---|---|
| **403 / Forbidden** | Publicado como "Apenas eu". Refaça o passo 4. |
| **Erro de CORS no console** | O `Content-Type` foi trocado para `application/json`. |
| **Linha não aparece** | Apps Script → **Execuções** (ícone de relógio) → ver detalhes. |
| **E-mail não chega** | Verifique spam. Conta gratuita tem cota de 100 e-mails/dia. |
| **Formulário não aparece** | `PUBLIC_RSVP_ENDPOINT` ausente no ambiente. |

---

## Pendências

- [ ] Definir `EVENTO.rsvpAte` em `src/data/event.ts` (o usual é 30–45 dias antes,
      o que aponta para meados de dezembro de 2026)
- [ ] Definir o WhatsApp de contato mostrado no estado de erro
- [ ] Ajustar `CONFIG.EMAIL_NOIVOS`
- [ ] Manter a planilha **restrita** aos noivos — não gerar link público de leitura
